import type { AgentTurnExecutionContext } from "../../domain/agents/contracts";
import { KernelServices, type IAgentRuntimeService, type IKernel } from "../serviceContracts";

export const MOBILE_TAVERN_CHAT_DRIVER_VERSION = "1.1.0";

/**
 * Built-in chat driver (`mobile-tavern.chat.driver`) execution seam.
 *
 * Records driver orchestration metadata in the Agent Journal (provider route,
 * tool capability availability, model skip / continuation flags) before running
 * the caller's turn coordinator. Keeping driver orchestration in the Application
 * layer avoids putting chat semantics inside Kernel while letting both normal
 * send and reroll run through one tracked driver lifecycle.
 */
export async function runMobileTavernChatDriver(
  kernel: IKernel,
  context: AgentTurnExecutionContext,
): Promise<void> {
  let runtime: IAgentRuntimeService | null = null;
  if (typeof kernel.hasService !== "function" || kernel.hasService(KernelServices.AgentRuntime)) {
    try {
      runtime = kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime);
    } catch {
      runtime = null;
    }
  }
  const availableTools = typeof runtime?.listTools === "function" ? runtime.listTools() : [];
  const activeComposition = typeof runtime?.getCompositionSnapshot === "function"
    ? runtime.getCompositionSnapshot()
    : null;

  await context.recordDecision("driver.orchestration", {
    driverId: context.driverId,
    driverVersion: MOBILE_TAVERN_CHAT_DRIVER_VERSION,
    providerId: context.providerId,
    profileId: activeComposition?.profileId ?? null,
    profileVersion: activeComposition?.profileVersion ?? null,
    skipModel: Boolean(context.input.skipModel),
    continuation: Boolean(context.input.continuation),
    supportsTools: context.provider.capabilities.supportsTools,
    supportsStreaming: context.provider.capabilities.supportsStreaming,
    registeredToolCount: availableTools.length,
  });

  await context.executeLegacy();
}

