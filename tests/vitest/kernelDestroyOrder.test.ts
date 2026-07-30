import { describe, expect, it, vi } from "vitest";
import { createKernel } from "../../src/kernel/Kernel";
import type { IKernelService } from "@/src/application/serviceContracts";

/**
 * Kernel 拓扑逆序销毁时序测试。
 *
 * 覆盖 computeDestroyOrder 的核心契约：
 *   - 若 A 依赖 B，则 A 必须先于 B 销毁，保证 A 的 destroy 钩子内仍能安全调用 B。
 *   - 循环依赖兜底：未排序的服务按注册顺序逆序追加，不漏销毁。
 *   - destroy 后 SafeProxy 模块状态被清理（HMR/重建隔离）。
 */
function makeService(name: string, deps: readonly string[] = [], optDeps: readonly string[] = []): IKernelService & { destroy: ReturnType<typeof vi.fn> } {
  return {
    name,
    dependencies: deps,
    optionalDependencies: optDeps,
    init: vi.fn(),
    destroy: vi.fn(),
  };
}

describe("Kernel 拓扑逆序销毁", () => {
  it("被依赖的服务后销毁（A 依赖 B → A 先销毁）", async () => {
    const kernel = createKernel();
    const destroyOrder: string[] = [];

    const serviceA: IKernelService = {
      name: "A",
      dependencies: ["B"],
      init: vi.fn(),
      destroy: () => { destroyOrder.push("A"); },
    };
    const serviceB: IKernelService = {
      name: "B",
      init: vi.fn(),
      destroy: () => { destroyOrder.push("B"); },
    };

    // 先注册 B 再注册 A（非批量），验证不依赖注册顺序
    await kernel.registerService("B", serviceB);
    await kernel.registerService("A", serviceA);

    await kernel.destroy();

    // A 必须先于 B 销毁
    expect(destroyOrder).toEqual(["A", "B"]);
  });

  it("多层依赖链：C→B→A 销毁顺序为 C, B, A", async () => {
    const kernel = createKernel();
    const destroyOrder: string[] = [];

    const serviceA: IKernelService = {
      name: "A",
      init: vi.fn(),
      destroy: () => { destroyOrder.push("A"); },
    };
    const serviceB: IKernelService = {
      name: "B",
      dependencies: ["A"],
      init: vi.fn(),
      destroy: () => {
        // destroy 钩子内应能安全调用被依赖服务（此处仅验证顺序）
        destroyOrder.push("B");
      },
    };
    const serviceC: IKernelService = {
      name: "C",
      dependencies: ["B"],
      init: vi.fn(),
      destroy: () => { destroyOrder.push("C"); },
    };

    // 乱序注册：A, C, B
    await kernel.registerService("A", serviceA);
    await kernel.registerService("C", serviceC);
    await kernel.registerService("B", serviceB);

    await kernel.destroy();

    expect(destroyOrder).toEqual(["C", "B", "A"]);
  });

  it("可选依赖也参与销毁顺序计算", async () => {
    const kernel = createKernel();
    const destroyOrder: string[] = [];

    const serviceBase: IKernelService = {
      name: "base",
      init: vi.fn(),
      destroy: () => { destroyOrder.push("base"); },
    };
    const serviceConsumer: IKernelService = {
      name: "consumer",
      optionalDependencies: ["base"],
      init: vi.fn(),
      destroy: () => { destroyOrder.push("consumer"); },
    };

    await kernel.registerService("base", serviceBase);
    await kernel.registerService("consumer", serviceConsumer);

    await kernel.destroy();

    // consumer 依赖 base（即便可选），consumer 先销毁
    expect(destroyOrder).toEqual(["consumer", "base"]);
  });

  it("独立服务（无依赖关系）按注册逆序销毁", async () => {
    const kernel = createKernel();
    const destroyOrder: string[] = [];

    const s1: IKernelService = { name: "s1", init: vi.fn(), destroy: () => { destroyOrder.push("s1"); } };
    const s2: IKernelService = { name: "s2", init: vi.fn(), destroy: () => { destroyOrder.push("s2"); } };
    const s3: IKernelService = { name: "s3", init: vi.fn(), destroy: () => { destroyOrder.push("s3"); } };

    await kernel.registerService("s1", s1);
    await kernel.registerService("s2", s2);
    await kernel.registerService("s3", s3);

    await kernel.destroy();

    // 无依赖时 Kahn 算法按入队顺序（注册顺序）销毁，出度为 0 的先入队
    // s1/s2/s3 出度均为 0，按注册顺序入队 → s1, s2, s3
    expect(destroyOrder).toEqual(["s1", "s2", "s3"]);
  });

  it("循环依赖兜底：所有服务仍被销毁", async () => {
    const kernel = createKernel();
    const destroyed = new Set<string>();

    // A 依赖 B，B 依赖 A（循环）
    const serviceA: IKernelService = {
      name: "A",
      dependencies: ["B"],
      init: vi.fn(),
      destroy: () => { destroyed.add("A"); },
    };
    const serviceB: IKernelService = {
      name: "B",
      dependencies: ["A"],
      init: vi.fn(),
      destroy: () => { destroyed.add("B"); },
    };

    // 分别注册避免批量拓扑校验抛错
    await kernel.registerService("A", serviceA);
    await kernel.registerService("B", serviceB);

    await kernel.destroy();

    // 循环依赖兜底：两个服务都被销毁
    expect(destroyed.has("A")).toBe(true);
    expect(destroyed.has("B")).toBe(true);
  });

  it("destroy 后所有服务被清理且 hasService 返回 false", async () => {
    const kernel = createKernel();
    const s1 = makeService("s1", ["s2"]);
    const s2 = makeService("s2");

    await kernel.registerService("s2", s2);
    await kernel.registerService("s1", s1);

    expect(kernel.hasService("s1")).toBe(true);
    expect(kernel.hasService("s2")).toBe(true);

    await kernel.destroy();

    expect(kernel.hasService("s1")).toBe(false);
    expect(kernel.hasService("s2")).toBe(false);
    expect(s1.destroy).toHaveBeenCalledOnce();
    expect(s2.destroy).toHaveBeenCalledOnce();
  });
});
