import type { IKernel } from "../../kernel/types";
import {
  KernelServices,
  type ICompatibilityRuntimeService,
} from "../serviceContracts";
import type {
  CompatibilityCodecDefinition,
  CompatibilityGenerationState,
  CompatibilityGenerationStateUpdate,
} from "../compatibility/contracts";

export const SILLY_TAVERN_PROMPT_PRESET_FORMAT = "sillytavern.prompt-preset";

const EMPTY_GENERATION_STATE: CompatibilityGenerationState = Object.freeze({
  isSending: false,
  streamingMessageId: null,
});

/**
 * 聊天主干只面向可选 Compatibility Host；插件未装载时保持无副作用降级。
 */
export function getCompatibilityGenerationState(
  kernel: IKernel | null,
): CompatibilityGenerationState {
  return getRenderer(kernel)?.getGenerationState() ?? EMPTY_GENERATION_STATE;
}

export function setCompatibilityGenerationState(
  kernel: IKernel | null,
  update: CompatibilityGenerationStateUpdate,
): void {
  getRenderer(kernel)?.setGenerationState(update);
}

export function getCompatibilityCodec(
  kernel: IKernel | null,
  format: string,
): CompatibilityCodecDefinition | null {
  return getCompatibilityRuntime(kernel)?.getCodec(format) ?? null;
}

function getRenderer(kernel: IKernel | null) {
  return getCompatibilityRuntime(kernel)?.getRenderer() ?? null;
}

function getCompatibilityRuntime(kernel: IKernel | null): ICompatibilityRuntimeService | null {
  if (
    !kernel
    || typeof kernel.hasService !== "function"
    || typeof kernel.getService !== "function"
    || !kernel.hasService(KernelServices.CompatibilityRuntime)
  ) {
    return null;
  }
  return kernel.getService<ICompatibilityRuntimeService>(KernelServices.CompatibilityRuntime);
}
