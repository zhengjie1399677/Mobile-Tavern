import { globalKernel } from "./Kernel";
import { createKernelLifecycleController } from "./KernelLifecycle";
import { registerCoreServices } from "./bootstrap/registerCoreServices";
import { registerDefaultPipelines } from "./bootstrap/registerDefaultPipelines";

const lifecycle = createKernelLifecycleController(globalKernel, async () => {
  await registerCoreServices(globalKernel);
  registerDefaultPipelines(globalKernel);
});

/** 启动纯内核服务与默认管线；UI 扩展由应用组合根单独注册。 */
export function initializeKernel(): Promise<void> {
  return lifecycle.initialize();
}

/** 串行化销毁，避免 StrictMode、HMR 与关闭事件相互竞争。 */
export function destroyKernel(): Promise<void> {
  return lifecycle.destroy();
}

export { globalKernel } from "./Kernel";
export { createKernel } from "./Kernel";
export { createKernelLifecycleController } from "./KernelLifecycle";
export type { KernelLifecycleController, KernelLifecycleState } from "./KernelLifecycle";
export * from "./types";
