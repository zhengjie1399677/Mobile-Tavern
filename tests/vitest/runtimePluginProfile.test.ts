import { describe, expect, it } from "vitest";
import {
  createLegacyRuntimePlugin,
  mountRuntimeProfile,
  resolveRuntimeProfile,
  type RuntimePluginDefinition,
  type RuntimeProfileDefinition,
} from "../../src/application/runtimePlugins";
import { createEffectScope } from "../../src/kernel/EffectScope";
import { createKernel } from "../../src/kernel/Kernel";

function createProfile(
  plugins: RuntimeProfileDefinition["plugins"],
): RuntimeProfileDefinition {
  return {
    id: "test.profile",
    version: 1,
    plugins,
  };
}

function createPlugin(
  id: string,
  options: Partial<RuntimePluginDefinition> = {},
): RuntimePluginDefinition {
  return {
    id,
    version: "1.0.0",
    setup: () => undefined,
    ...options,
  };
}

describe("Runtime Plugin Profile", () => {
  it("按依赖拓扑稳定解析插件顺序", () => {
    const profile = createProfile([
      { id: "feature.consumer" },
      { id: "feature.base" },
      { id: "feature.independent" },
    ]);
    const snapshot = resolveRuntimeProfile(profile, [
      createPlugin("feature.consumer", { requires: ["feature.base"] }),
      createPlugin("feature.base"),
      createPlugin("feature.independent"),
    ]);

    expect(snapshot).toEqual({
      profileId: "test.profile",
      profileVersion: 1,
      plugins: [
        { id: "feature.base", version: "1.0.0" },
        { id: "feature.consumer", version: "1.0.0" },
        { id: "feature.independent", version: "1.0.0" },
      ],
    });
  });

  it("拒绝缺失依赖、循环依赖和版本不匹配", () => {
    expect(() => resolveRuntimeProfile(
      createProfile([{ id: "feature.consumer" }]),
      [createPlugin("feature.consumer", { requires: ["feature.base"] })],
    )).toThrow("RUNTIME_PLUGIN_DEPENDENCY_MISSING");

    expect(() => resolveRuntimeProfile(
      createProfile([{ id: "feature.left" }, { id: "feature.right" }]),
      [
        createPlugin("feature.left", { requires: ["feature.right"] }),
        createPlugin("feature.right", { requires: ["feature.left"] }),
      ],
    )).toThrow("RUNTIME_PLUGIN_DEPENDENCY_CYCLE");

    expect(() => resolveRuntimeProfile(
      createProfile([{ id: "feature.base", version: "2.0.0" }]),
      [createPlugin("feature.base")],
    )).toThrow("RUNTIME_PLUGIN_VERSION_MISMATCH");
  });

  it("快照只记录可序列化的身份信息，不泄露插件配置", async () => {
    const secretConfig = { apiKey: "must-not-enter-snapshot" };
    let receivedConfig: unknown;
    const mounted = await mountRuntimeProfile({
      kernel: createKernel(),
      profile: createProfile([{ id: "feature.secret", config: secretConfig }]),
      plugins: [createPlugin("feature.secret", {
        validateConfig(config) {
          expect(config).toBe(secretConfig);
        },
        setup(_context, config) {
          receivedConfig = config;
        },
      })],
    });

    expect(receivedConfig).toBe(secretConfig);
    expect(JSON.stringify(mounted.snapshot)).not.toContain("must-not-enter-snapshot");
    expect(mounted.snapshot.plugins).toEqual([
      { id: "feature.secret", version: "1.0.0" },
    ]);
    await mounted.dispose();
  });

  it("按依赖顺序装载，并按逆序卸载插件", async () => {
    const calls: string[] = [];
    const mounted = await mountRuntimeProfile({
      kernel: createKernel(),
      profile: createProfile([
        { id: "feature.consumer" },
        { id: "feature.base" },
      ]),
      plugins: [
        createPlugin("feature.consumer", {
          requires: ["feature.base"],
          setup: () => {
            calls.push("setup:consumer");
            return () => {
              calls.push("dispose:consumer");
            };
          },
        }),
        createPlugin("feature.base", {
          setup: () => {
            calls.push("setup:base");
            return () => {
              calls.push("dispose:base");
            };
          },
        }),
      ],
    });

    expect(calls).toEqual(["setup:base", "setup:consumer"]);
    await mounted.dispose();
    await mounted.dispose();
    expect(calls).toEqual([
      "setup:base",
      "setup:consumer",
      "dispose:consumer",
      "dispose:base",
    ]);
  });

  it("插件装载失败时回滚失败插件的局部 Effect 和已装载依赖", async () => {
    const kernel = createKernel();
    const calls: string[] = [];
    const profile = createProfile([
      { id: "feature.base" },
      { id: "feature.failed" },
    ]);
    const plugins = [
      createPlugin("feature.base", {
        setup: () => {
          calls.push("setup:base");
          return () => {
            calls.push("dispose:base");
          };
        },
      }),
      createPlugin("feature.failed", {
        requires: ["feature.base"],
        setup: ({ kernel: runtimeKernel, scope }) => {
          calls.push("setup:failed");
          scope.add(runtimeKernel.registerExtension({
            id: "temporary",
            targetPoint: "test:runtime-plugin",
            value: true,
          }));
          scope.add(() => {
            calls.push("dispose:failed");
          });
          throw new Error("setup failed");
        },
      }),
    ];

    await expect(mountRuntimeProfile({ kernel, profile, plugins }))
      .rejects.toThrow("setup failed");
    expect(calls).toEqual([
      "setup:base",
      "setup:failed",
      "dispose:failed",
      "dispose:base",
    ]);
    expect(kernel.getExtensions("test:runtime-plugin")).toEqual([]);
  });

  it("装载失败且回滚也失败时保留两类错误", async () => {
    const setupError = new Error("setup failed");
    const cleanupError = new Error("cleanup failed");
    let captured: unknown;

    try {
      await mountRuntimeProfile({
        kernel: createKernel(),
        profile: createProfile([{ id: "feature.failed" }]),
        plugins: [createPlugin("feature.failed", {
          setup: ({ scope }) => {
            scope.add(() => {
              throw cleanupError;
            });
            throw setupError;
          },
        })],
      });
    } catch (error: unknown) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(AggregateError);
    expect((captured as AggregateError).errors[0]).toBe(setupError);
    expect((captured as AggregateError).errors[1]).toMatchObject({
      name: "EffectScopeDisposeError",
    });
  });

  it("父 Scope 在异步装载期间关闭时立即回收迟到的插件 Effect", async () => {
    const parentScope = createEffectScope("test.parent-runtime");
    let finishSetup: (() => void) | undefined;
    const setupGate = new Promise<void>((resolve) => {
      finishSetup = resolve;
    });
    let disposeCalls = 0;
    const mounting = mountRuntimeProfile({
      kernel: createKernel(),
      parentScope,
      profile: createProfile([{ id: "feature.slow" }]),
      plugins: [createPlugin("feature.slow", {
        async setup() {
          await setupGate;
          return () => {
            disposeCalls += 1;
          };
        },
      })],
    });

    const parentDisposal = parentScope.dispose();
    finishSetup?.();

    await expect(mounting).rejects.toThrow("EFFECT_SCOPE_NOT_ACTIVE");
    await parentDisposal;
    expect(disposeCalls).toBe(1);
  });
});

describe("Legacy Runtime Plugin", () => {
  it("把现有服务、Pipeline 和能力登记收口到一个可逆插件", async () => {
    const calls: string[] = [];
    const plugin = createLegacyRuntimePlugin({
      registerCoreServices: async () => {
        calls.push("setup:services");
        return () => {
          calls.push("dispose:services");
        };
      },
      registerDefaultPipelines: () => {
        calls.push("setup:pipelines");
        return () => {
          calls.push("dispose:pipelines");
        };
      },
      registerRuntimeCapabilities: () => {
        calls.push("setup:capabilities");
        return () => {
          calls.push("dispose:capabilities");
        };
      },
    });
    const mounted = await mountRuntimeProfile({
      kernel: createKernel(),
      profile: createProfile([{ id: plugin.id }]),
      plugins: [plugin],
    });

    expect(calls).toEqual([
      "setup:services",
      "setup:pipelines",
      "setup:capabilities",
    ]);
    await mounted.dispose();
    expect(calls).toEqual([
      "setup:services",
      "setup:pipelines",
      "setup:capabilities",
      "dispose:capabilities",
      "dispose:pipelines",
      "dispose:services",
    ]);
  });
});
