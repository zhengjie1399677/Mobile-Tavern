import { describe, expect, it } from "vitest";
import { createKernel } from "../../src/kernel/Kernel";
import {
  EffectScopeDisposeError,
  createEffectScope,
} from "../../src/kernel/EffectScope";

describe("EffectScope", () => {
  it("按注册逆序释放 Effect，并保证重复释放不会再次执行", async () => {
    const scope = createEffectScope("test.root");
    const calls: string[] = [];

    scope.add(() => {
      calls.push("first");
    });
    scope.add(async () => {
      await Promise.resolve();
      calls.push("second");
    });

    await scope.dispose();
    await scope.dispose();

    expect(calls).toEqual(["second", "first"]);
    expect(scope.state).toBe("disposed");
  });

  it("提前释放的 Effect 不会在 Scope 销毁时重复执行", async () => {
    const scope = createEffectScope("test.early-release");
    let calls = 0;
    const release = scope.add(() => {
      calls += 1;
    });

    await release();
    await release();
    await scope.dispose();

    expect(calls).toBe(1);
  });

  it("整体释放会等待已经开始的提前异步释放", async () => {
    const scope = createEffectScope("test.concurrent-release");
    let finishRelease: (() => void) | undefined;
    const releaseGate = new Promise<void>((resolve) => {
      finishRelease = resolve;
    });
    let effectFinished = false;
    const release = scope.add(async () => {
      await releaseGate;
      effectFinished = true;
    });

    const earlyRelease = release();
    let scopeFinished = false;
    const scopeRelease = scope.dispose().then(() => {
      scopeFinished = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(scopeFinished).toBe(false);
    expect(scope.state).toBe("disposing");

    finishRelease?.();
    await Promise.all([earlyRelease, scopeRelease]);
    expect(effectFinished).toBe(true);
    expect(scope.state).toBe("disposed");
  });

  it("父 Scope 释放时按 Effect 顺序释放子 Scope", async () => {
    const parent = createEffectScope("test.parent");
    const calls: string[] = [];

    parent.add(() => {
      calls.push("before-child");
    });
    const child = parent.fork("test.child");
    child.add(() => {
      calls.push("child");
    });
    parent.add(() => {
      calls.push("after-child");
    });

    await parent.dispose();

    expect(calls).toEqual(["after-child", "child", "before-child"]);
    expect(child.state).toBe("disposed");
  });

  it("单个 Effect 失败后继续释放其余 Effect，并聚合错误", async () => {
    const scope = createEffectScope("test.failure");
    const calls: string[] = [];

    scope.add(() => {
      calls.push("survived");
    });
    scope.add(() => {
      calls.push("failed");
      throw new Error("dispose failed");
    });

    let captured: unknown;
    try {
      await scope.dispose();
    } catch (error: unknown) {
      captured = error;
    }

    expect(calls).toEqual(["failed", "survived"]);
    expect(captured).toBeInstanceOf(EffectScopeDisposeError);
    expect((captured as EffectScopeDisposeError).errors).toHaveLength(1);
    expect(scope.state).toBe("disposed");
  });

  it("拒绝向已开始释放的 Scope 注册新 Effect", async () => {
    const scope = createEffectScope("test.closed");
    await scope.dispose();

    expect(() => scope.add(() => undefined)).toThrow("EFFECT_SCOPE_NOT_ACTIVE");
    expect(() => scope.fork("test.late-child")).toThrow("EFFECT_SCOPE_NOT_ACTIVE");
  });
});

describe("Kernel extension disposer", () => {
  it("注销扩展时不会误删同 ID 的后注册替代项", () => {
    const kernel = createKernel();
    const disposeOld = kernel.registerExtension({
      id: "replaceable",
      targetPoint: "test:extension",
      value: "old",
    });
    const disposeCurrent = kernel.registerExtension({
      id: "replaceable",
      targetPoint: "test:extension",
      value: "current",
    });

    disposeOld();
    expect(kernel.getExtensions<string>("test:extension").map((entry) => entry.value)).toEqual(["current"]);

    disposeCurrent();
    disposeCurrent();
    expect(kernel.getExtensions("test:extension")).toEqual([]);
  });

  it("可由 EffectScope 统一回收扩展注册", async () => {
    const kernel = createKernel();
    const scope = createEffectScope("test.extension-scope");

    scope.add(kernel.registerExtension({
      id: "scoped",
      targetPoint: "test:extension",
      value: { enabled: true },
    }));
    expect(kernel.getExtensions("test:extension")).toHaveLength(1);

    await scope.dispose();

    expect(kernel.getExtensions("test:extension")).toEqual([]);
  });

  it("Kernel 销毁后遗留 extension disposer 仍然安全幂等", async () => {
    const kernel = createKernel();
    const dispose = kernel.registerExtension({
      id: "destroyed",
      targetPoint: "test:extension",
      value: true,
    });

    await kernel.destroy();

    expect(() => dispose()).not.toThrow();
    expect(() => dispose()).not.toThrow();
  });
});
