import { createKernelLifecycleController } from "../../src/kernel/KernelLifecycle";
import { Kernel } from "../../src/kernel/Kernel";
import type { IKernelService } from "../../src/kernel/types";
import { assert } from "./testUtils";

export async function testKernelLifecycleAndDependencies() {
  console.log("\n--- Running Kernel Lifecycle and Dependency Contract Verification ---");

  let bootstrapCount = 0;
  let destroyCount = 0;
  const lifecycle = createKernelLifecycleController(
    { destroy: async () => { destroyCount++; } },
    async () => { bootstrapCount++; },
  );

  await Promise.all([lifecycle.initialize(), lifecycle.initialize()]);
  assert(bootstrapCount === 1, "Kernel lifecycle coalesces concurrent initialize requests");
  assert(lifecycle.getState() === "ready", "Kernel lifecycle becomes ready after bootstrap");

  // 模拟 StrictMode：首次 effect 的 cleanup 与第二次挂载交错发生。
  const strictModeSequence = [lifecycle.initialize(), lifecycle.destroy(), lifecycle.initialize()];
  await Promise.all(strictModeSequence);
  assert(destroyCount === 0, "A newer initialize request cancels a stale queued destroy request");
  assert(lifecycle.getState() === "ready", "StrictMode sequence keeps the kernel ready");

  await lifecycle.destroy();
  assert(destroyCount === 1, "Final destroy runs exactly once");
  assert(lifecycle.getState() === "idle", "Kernel lifecycle returns to idle after destroy");

  const kernel = new Kernel();
  const requiredMissing: IKernelService = {
    name: "required-missing",
    dependencies: ["not-registered"],
    init() {},
  };
  let missingDependencyRejected = false;
  try {
    await kernel.registerServiceBatch([{ name: requiredMissing.name, service: requiredMissing }]);
  } catch (error: any) {
    missingDependencyRejected = true;
    assert(error.message.includes("Missing required dependency"), "Missing required dependency produces a clear error");
  }
  assert(missingDependencyRejected, "Required missing dependencies must reject the batch");

  let optionalInitialized = false;
  const optionalMissing: IKernelService = {
    name: "optional-missing",
    optionalDependencies: ["not-installed-plugin"],
    init() { optionalInitialized = true; },
  };
  await kernel.registerServiceBatch([{ name: optionalMissing.name, service: optionalMissing }]);
  assert(optionalInitialized, "Missing optional dependencies do not block service initialization");
  await kernel.destroy();

  console.log("✔ Kernel lifecycle serialization and dependency contracts verified!");
}

/**
 * 验证 bootstrap 部分成功后失败的回滚机制（方案 A + 方案 B 叠加）：
 *  - 场景 1：registerServiceBatch 中途关键服务失败时，逆序销毁已注册服务
 *  - 场景 2：KernelLifecycle.initialize() 失败后 kernel 全量清理（兜底）
 *  - 场景 3：失败后二次 initialize 能成功（无残留冲突，StrictMode 安全性）
 */
export async function testBootstrapRollbackOnCriticalFailure() {
  console.log("\n--- Running Bootstrap Rollback on Critical Failure Verification ---");

  // === 场景 1：registerServiceBatch 中途失败时逆序回滚已注册服务（方案 A） ===
  {
    const kernel = new Kernel();
    const destroyedOrder: string[] = [];

    const healthyService: IKernelService = {
      name: "healthy-svc",
      init() {},
      destroy() { destroyedOrder.push("healthy-svc"); },
    };
    const failingService: IKernelService = {
      name: "failing-svc",
      isCritical: true,
      init() { throw new Error("init exploded"); },
      destroy() { destroyedOrder.push("failing-svc"); },
    };
    const laterService: IKernelService = {
      name: "later-svc",
      init() {},
      destroy() { destroyedOrder.push("later-svc"); },
    };

    let batchError: Error | undefined;
    try {
      await kernel.registerServiceBatch([
        { name: "healthy-svc", service: healthyService },
        { name: "failing-svc", service: failingService },
        { name: "later-svc", service: laterService },
      ]);
    } catch (err) {
      batchError = err as Error;
    }

    assert(batchError !== undefined, "Critical service init failure should reject the batch");
    assert(
      batchError!.message.includes("failing-svc"),
      `Error should mention failing service, got: ${batchError!.message}`
    );
    // healthy-svc 已成功注册，应被回滚销毁
    assert(
      destroyedOrder.includes("healthy-svc"),
      "Already-registered service should be destroyed during rollback"
    );
    // later-svc 从未注册（在 failing-svc 处就抛出），不应被销毁
    assert(
      !destroyedOrder.includes("later-svc"),
      "Never-registered service should not be destroyed"
    );
    // failing-svc 自身 init 失败，registerService 内部已 delete，回滚不含它
    assert(
      !destroyedOrder.includes("failing-svc"),
      "Failing service itself should not be in rollback (already deleted by registerService)"
    );
    // 回滚后 services Map 应为空（半初始化状态已清理）
    assert(
      kernel.hasService("healthy-svc") === false,
      "healthy-svc should be removed from services after rollback"
    );
    assert(
      kernel.hasService("failing-svc") === false,
      "failing-svc should not be in services (init failed)"
    );
    assert(
      kernel.hasService("later-svc") === false,
      "later-svc should never have been registered"
    );

    await kernel.destroy();
  }

  // === 场景 2：KernelLifecycle.initialize() 失败后 kernel 全量清理（方案 B 兜底） ===
  {
    const kernel = new Kernel();
    const lifecycle = createKernelLifecycleController(
      kernel,
      async () => {
        // 模拟 bootstrap 部分成功后失败：先注册一个服务，再抛出
        await kernel.registerService("pre-fail-svc", {
          name: "pre-fail-svc",
          init() {},
        });
        throw new Error("bootstrap later step failed");
      }
    );

    let initError: Error | undefined;
    try {
      await lifecycle.initialize();
    } catch (err) {
      initError = err as Error;
    }

    assert(initError !== undefined, "initialize should reject when bootstrap throws");
    assert(
      initError!.message.includes("bootstrap later step failed"),
      `Original error should propagate, got: ${initError!.message}`
    );
    assert(lifecycle.getState() === "idle", "Lifecycle state should return to idle after failure");
    // 方案 B 兜底：kernel.destroy() 已被调用，services 全部清空
    assert(
      kernel.hasService("pre-fail-svc") === false,
      "pre-fail-svc should be cleaned up by kernel.destroy() in catch branch"
    );

    // 关键验证：失败后 destroy() 应安全（不因残留状态崩溃）
    await lifecycle.destroy();
    assert(lifecycle.getState() === "idle", "destroy after failed initialize should be safe no-op");

    await kernel.destroy();
  }

  // === 场景 3：失败后二次 initialize 能成功（无残留冲突，StrictMode 安全性） ===
  {
    const kernel = new Kernel();
    let attempt = 0;
    const lifecycle = createKernelLifecycleController(
      kernel,
      async () => {
        attempt++;
        if (attempt === 1) {
          // 首次：注册一个服务后失败
          await kernel.registerService("retry-svc", {
            name: "retry-svc",
            init() {},
          });
          throw new Error("first attempt fails");
        }
        // 二次：正常注册同名服务
        await kernel.registerService("retry-svc", {
          name: "retry-svc",
          init() {},
        });
      }
    );

    // 首次 initialize 失败
    try {
      await lifecycle.initialize();
    } catch {
      // expected
    }
    assert(attempt === 1, "First initialize attempt should run bootstrap");
    assert(lifecycle.getState() === "idle", "State should be idle after failure");
    assert(
      kernel.hasService("retry-svc") === false,
      "No residual services after failed bootstrap (cleanup worked)"
    );

    // 二次 initialize 应能成功（无残留冲突）
    await lifecycle.initialize();
    assert(attempt === 2, "Second initialize attempt should run bootstrap again");
    assert(lifecycle.getState() === "ready", "Second initialize should succeed");
    assert(
      kernel.hasService("retry-svc") === true,
      "Service should be registered after successful retry"
    );

    await lifecycle.destroy();
    await kernel.destroy();
  }

  console.log("✔ Bootstrap rollback on critical failure verified successfully!");
}
