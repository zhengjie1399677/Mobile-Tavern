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
