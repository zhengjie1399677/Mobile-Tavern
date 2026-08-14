/**
 * 应用运行时组合根。
 *
 * 这里负责把 Mobile Tavern 的应用服务和默认 Pipeline 装配到通用 Kernel。
 * Kernel 本身不知道角色、Prompt、记忆、数据库或任何其他业务服务。
 */
import { globalKernel } from "../kernel/Kernel";
import { createKernelLifecycleController } from "../kernel/KernelLifecycle";
import { bindRuntimeKernel } from "../kernel/runtimeKernel";
import { configureKernelValidators } from "../kernel/validation";
import { registerCoreServices } from "./bootstrap/registerCoreServices";
import { registerDefaultPipelines } from "./bootstrap/registerDefaultPipelines";
import { registerRuntimeCapabilities } from "./bootstrap/capabilityRegistry";
import {
  validateMessage,
  validateService,
  validateServiceRetrieval,
} from "./serviceSchemas";

bindRuntimeKernel(globalKernel);
configureKernelValidators({
  validateMessage,
  validateService,
  validateServiceRetrieval,
});

const lifecycle = createKernelLifecycleController(globalKernel, async () => {
  await registerCoreServices(globalKernel);
  registerDefaultPipelines(globalKernel);
  registerRuntimeCapabilities(globalKernel);
});

export function initializeApplicationRuntime(): Promise<void> {
  return lifecycle.initialize();
}

export function destroyApplicationRuntime(): Promise<void> {
  return lifecycle.destroy();
}
