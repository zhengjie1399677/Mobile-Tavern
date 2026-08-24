/**
 * Kernel 公共入口。
 *
 * 这里只导出容器、生命周期、Pipeline、消息总线和通用运行时契约。
 * 应用服务及其装配入口位于 src/application/，Kernel 不启动任何业务。
 */
export { globalKernel } from "./Kernel";
export { createKernel } from "./Kernel";
export { createKernelLifecycleController } from "./KernelLifecycle";
export {
  EffectScope,
  EffectScopeDisposeError,
  createEffectScope,
} from "./EffectScope";
export { bindRuntimeKernel, getRuntimeKernel } from "./runtimeKernel";
export type { KernelLifecycleController, KernelLifecycleState } from "./KernelLifecycle";
export * from "./types";
