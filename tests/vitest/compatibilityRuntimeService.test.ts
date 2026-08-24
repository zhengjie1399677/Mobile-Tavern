import { describe, expect, it, vi } from "vitest";
import { createKernel } from "../../src/kernel/Kernel";
import { CompatibilityRuntimeService } from "../../src/application/services/CompatibilityRuntimeService";
import {
  SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID,
  type CompatibilityRendererDefinition,
} from "../../src/application/compatibility/contracts";
import {
  mountRuntimeProfile,
  sillyTavernCompatibilityRuntimePlugin,
  type RuntimePluginDefinition,
  type RuntimeProfileDefinition,
} from "../../src/application/runtimePlugins";
import { listRuntimeCapabilities } from "../../src/application/bootstrap/capabilityRegistry";
import type { ChatSession } from "../../src/types";

describe("CompatibilityRuntimeService", () => {
  it("base 状态没有生态语义且所有贡献都可撤销", async () => {
    const service = new CompatibilityRuntimeService();
    await service.init(createKernel());
    expect(service.isEnabled()).toBe(false);
    expect(service.transformText({ text: "原文", character: null, mode: "store" })).toBe("原文");
    expect(service.initializeState(null)).toEqual({});

    const cleanBridge = vi.fn();
    const renderer = createRenderer(cleanBridge);
    const disposeTransform = service.registerTransform({
      id: "compat.test.transform",
      version: "1.0.0",
      transform: ({ text }) => `${text}-转换`,
    });
    const disposeRenderer = service.registerRenderer(renderer);

    expect(service.isEnabled()).toBe(true);
    expect(service.transformText({ text: "原文", character: null, mode: "store" }))
      .toBe("原文-转换");
    expect(service.getRenderer()?.id).toBe(renderer.id);
    expect(service.getCodec("missing")).toBeNull();

    await disposeRenderer();
    await disposeTransform();
    expect(cleanBridge).toHaveBeenCalledOnce();
    expect(service.getDiagnostics()).toMatchObject({ transforms: [], renderers: [] });
    expect(service.isEnabled()).toBe(false);
    await service.destroy();
  });

  it("Renderer 初始化失败时原子回滚注册", async () => {
    const service = new CompatibilityRuntimeService();
    await service.init(createKernel());
    const renderer = {
      ...createRenderer(vi.fn()),
      initializeGlobals() {
        throw new Error("renderer init failed");
      },
    };

    expect(() => service.registerRenderer(renderer)).toThrow("renderer init failed");
    expect(service.getDiagnostics().renderers).toEqual([]);
    expect(service.isEnabled()).toBe(false);
    await service.destroy();
  });

  it("Tavern Profile 可关闭并在同一 Host 上重新装载，base Profile 不注册兼容能力", async () => {
    const kernel = createKernel();
    const service = new CompatibilityRuntimeService();
    const disposeService = await kernel.registerService(service.name, service);
    const corePlugin: RuntimePluginDefinition = {
      id: "mobile-tavern.legacy-runtime",
      version: "1.0.0",
      setup: () => undefined,
    };
    const baseProfile: RuntimeProfileDefinition = {
      id: "test.base",
      version: 1,
      plugins: [{ id: corePlugin.id, version: corePlugin.version }],
    };
    const tavernProfile: RuntimeProfileDefinition = {
      id: "test.tavern",
      version: 1,
      plugins: [
        { id: corePlugin.id, version: corePlugin.version },
        {
          id: SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID,
          version: sillyTavernCompatibilityRuntimePlugin.version,
        },
      ],
    };
    const catalog = [corePlugin, sillyTavernCompatibilityRuntimePlugin];

    const base = await mountRuntimeProfile({ kernel, profile: baseProfile, plugins: catalog });
    expect(service.isEnabled()).toBe(false);
    expect(listRuntimeCapabilities(kernel).some((item) => item.id === "compat.sillytavern"))
      .toBe(false);
    await base.dispose();

    const first = await mountRuntimeProfile({ kernel, profile: tavernProfile, plugins: catalog });
    expect(service.getDiagnostics()).toEqual({
      codecs: ["compat.sillytavern.codec.prompt-preset"],
      promptSections: ["compat.sillytavern.prompt.mvu-state"],
      contextSources: ["compat.sillytavern.context.mvu-state"],
      transforms: ["compat.sillytavern.transform.regex"],
      stateReducers: ["compat.sillytavern.state.mvu"],
      renderers: ["compat.sillytavern.renderer"],
    });
    expect(listRuntimeCapabilities(kernel).some((item) => item.id === "compat.sillytavern"))
      .toBe(true);
    const mountedRenderer = service.getRenderer();
    mountedRenderer?.setGenerationState({
      isSending: true,
      streamingMessageId: "msg-streaming",
    });
    expect(mountedRenderer?.getGenerationState()).toEqual({
      isSending: true,
      streamingMessageId: "msg-streaming",
    });

    expect(service.readContextSources(createSession({ variables: { legacy: true } }))).toEqual({
      "compat.sillytavern.context.mvu-state": { legacy: true },
    });
    expect(service.readContextSources(createSession({
      variables: { legacy: true },
      runtimePluginState: {
        [SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID]: { namespaced: true },
      },
    }))).toEqual({
      "compat.sillytavern.context.mvu-state": { namespaced: true },
    });
    await first.dispose();
    expect(mountedRenderer?.getGenerationState()).toEqual({
      isSending: false,
      streamingMessageId: null,
    });
    expect(service.isEnabled()).toBe(false);

    const reloaded = await mountRuntimeProfile({ kernel, profile: tavernProfile, plugins: catalog });
    expect(service.isEnabled()).toBe(true);
    await reloaded.dispose();
    await disposeService();
  });
});

function createSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "session-compatibility",
    characterId: "character-compatibility",
    title: "兼容测试",
    createdAt: 1,
    messages: [],
    summaries: [],
    ...overrides,
  };
}

function createRenderer(cleanBridge: () => void): CompatibilityRendererDefinition {
  return {
    id: "compat.test.renderer",
    version: "1.0.0",
    initializeGlobals: () => undefined,
    areRuntimeLibrariesReady: () => true,
    hasCardScripts: () => false,
    listBackgroundScripts: () => [],
    createScriptIframeSrcDoc: (content) => content,
    createMessageIframeSrcDoc: (content) => content,
    initializeBridge: () => undefined,
    updateBridge: () => undefined,
    getBridgeParams: () => null,
    getGenerationState: () => ({ isSending: false, streamingMessageId: null }),
    setGenerationState: () => undefined,
    cleanBridge,
  };
}
