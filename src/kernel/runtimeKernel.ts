import type { IKernel } from "./types";

let runtimeKernel: IKernel | null = null;

/** 仅由应用组合根绑定运行时 Kernel；业务模块不得直接导入全局单例。 */
export function bindRuntimeKernel(kernel: IKernel): void {
  if (runtimeKernel && runtimeKernel !== kernel) {
    throw new Error("RUNTIME_KERNEL_ALREADY_BOUND");
  }
  runtimeKernel = kernel;
}

export function getRuntimeKernel(): IKernel | null {
  return runtimeKernel;
}
