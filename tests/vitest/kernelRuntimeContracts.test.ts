import { describe, expect, it, vi } from "vitest";
import { registerDefaultPipelines } from "../../src/application/bootstrap/registerDefaultPipelines";
import {
  bisonModeMiddleware,
  mvuScriptMiddleware,
  tableMemoryMiddleware,
} from "../../src/application/pipeline";
import { createKernel } from "../../src/kernel/Kernel";
import type { Middleware } from "../../src/kernel/types";

describe("Kernel 运行时失败与重启契约", () => {
  it("必选依赖初始化失败时拒绝启动依赖者并回滚批次", async () => {
    const kernel = createKernel();
    const consumerInit = vi.fn();

    await expect(kernel.registerServiceBatch([
      {
        name: "failed-base",
        service: {
          name: "failed-base",
          init() {
            throw new Error("base init failed");
          },
        },
      },
      {
        name: "consumer",
        service: {
          name: "consumer",
          dependencies: ["failed-base"],
          init: consumerInit,
        },
      },
    ])).rejects.toThrow("Required dependencies failed to initialize");

    expect(consumerInit).not.toHaveBeenCalled();
    expect(kernel.hasService("failed-base")).toBe(false);
    expect(kernel.hasService("consumer")).toBe(false);
  });

  it("服务批次 disposer 按依赖逆序释放且不会误删同名替代项", async () => {
    const kernel = createKernel();
    const destroyOrder: string[] = [];
    const disposeBatch = await kernel.registerServiceBatch([
      {
        name: "base",
        service: {
          name: "base",
          init() {},
          destroy() {
            destroyOrder.push("base");
          },
        },
      },
      {
        name: "consumer",
        service: {
          name: "consumer",
          dependencies: ["base"],
          init() {},
          destroy() {
            destroyOrder.push("consumer");
          },
        },
      },
    ]);

    const replacement = { name: "consumer", init: vi.fn() };
    await kernel.registerService("consumer", replacement);
    await disposeBatch();

    expect(destroyOrder).toEqual(["consumer", "base"]);
    expect(kernel.getService("consumer")).toBe(replacement);
    await kernel.destroy();
  });

  it("Kernel 销毁后可以重新注册并装配默认 Pipeline", async () => {
    const kernel = createKernel();
    const disposeInitial = registerDefaultPipelines(kernel);
    expect(kernel.getPipeline("output").list()).toHaveLength(3);

    await kernel.destroy();
    await disposeInitial();

    const disposeRestarted = registerDefaultPipelines(kernel);
    const output = kernel.getPipeline("output");
    expect(output.list()).toHaveLength(3);
    expect(output.matches([
      tableMemoryMiddleware,
      mvuScriptMiddleware,
      bisonModeMiddleware,
    ])).toBe(true);

    await disposeRestarted();
    expect(output.list()).toHaveLength(0);
  });

  it("旧订阅 disposer 只移除自己的注册身份", async () => {
    const kernel = createKernel();
    const handler = vi.fn();
    const disposeOld = kernel.subscribe("runtime:event", handler, 10);
    const disposeCurrent = kernel.subscribe("runtime:event", handler, 5);

    disposeOld();
    await kernel.publish({ topic: "runtime:event", payload: null });
    expect(handler).toHaveBeenCalledOnce();

    disposeCurrent();
    await kernel.publish({ topic: "runtime:event", payload: null });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("中间件数量相同但注册身份不同不能命中标准快速路径", () => {
    const kernel = createKernel();
    const output = kernel.getPipeline<Record<string, unknown>>("output");
    const customMiddleware: Middleware<Record<string, unknown>> = async (_context, next) => {
      await next();
    };

    output.use(tableMemoryMiddleware as unknown as Middleware<Record<string, unknown>>, 100);
    output.use(mvuScriptMiddleware as unknown as Middleware<Record<string, unknown>>, 90);
    output.use(customMiddleware, 80);

    expect(output.list()).toHaveLength(3);
    expect(output.matches([
      tableMemoryMiddleware as unknown as Middleware<Record<string, unknown>>,
      mvuScriptMiddleware as unknown as Middleware<Record<string, unknown>>,
      bisonModeMiddleware as unknown as Middleware<Record<string, unknown>>,
    ])).toBe(false);
  });

  it("只有 interrupt() 能受控终止，预置字段不能绕过管道", async () => {
    const kernel = createKernel();
    const pipeline = kernel.registerPipeline<{ isInterrupted?: boolean; calls: string[] }>(
      "interrupt-identity",
    );
    pipeline.use(async (context, next) => {
      context.calls.push("first");
      await next();
    }, 10);
    pipeline.use((context, _next, interrupt) => {
      context.calls.push("interrupt");
      interrupt();
    });

    const context = { isInterrupted: true, calls: [] as string[] };
    await pipeline.execute(context);
    expect(context.calls).toEqual(["first", "interrupt"]);
    expect(context.isInterrupted).toBe(true);
  });

  it("冻结 context 时 interrupt() 仍能终止执行", async () => {
    const kernel = createKernel();
    const pipeline = kernel.registerPipeline<Readonly<{ value: number }>>("frozen-interrupt");
    const later = vi.fn();
    pipeline.use((_context, _next, interrupt) => {
      interrupt();
    }, 10);
    pipeline.use(async (_context, next) => {
      later();
      await next();
    });

    await expect(pipeline.execute(Object.freeze({ value: 1 }))).resolves.toBeUndefined();
    expect(later).not.toHaveBeenCalled();
  });

  it("中间件漏写 await 时仍等待 next() 完成", async () => {
    const pipeline = createKernel().registerPipeline<{ completed: boolean }>("await-next-contract");
    let releaseDownstream: (() => void) | undefined;
    const downstreamGate = new Promise<void>((resolve) => {
      releaseDownstream = resolve;
    });

    pipeline.use(async (_context, next) => {
      void next();
    });
    pipeline.use(async (context, next) => {
      await downstreamGate;
      context.completed = true;
      await next();
    });

    const context = { completed: false };
    let settled = false;
    const execution = pipeline.execute(context).then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    releaseDownstream?.();
    await execution;

    expect(context.completed).toBe(true);
  });
});
