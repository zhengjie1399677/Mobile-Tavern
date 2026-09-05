import type { ChatSession } from "../../types";
import type { AgentCompositionSnapshot } from "../../domain/agents/contracts";
import type { IKernel } from "../../kernel/types";
import {
  KernelServices,
  type IAgentRuntimeService,
  type IToolPluginRuntimeService,
} from "../serviceContracts";
import { BUILTIN_TAVERN_PROFILE_ID } from "../runtimeProfiles/contracts";

/** 旧会话创建于 Profile 功能之前，必须继续按 Tavern Agent 解释以保持行为兼容。 */
export function getSessionRuntimeProfileId(session: ChatSession | null): string | null {
  if (!session) return null;
  return session.compositionSnapshot?.profileId ?? BUILTIN_TAVERN_PROFILE_ID;
}

export function canRunSessionWithProfile(
  session: ChatSession | null,
  activeProfile: (Pick<AgentCompositionSnapshot, "profileId" | "profileVersion">
    & Partial<Pick<AgentCompositionSnapshot, "pluginVersions">>) | null,
): boolean {
  const sessionProfileId = getSessionRuntimeProfileId(session);
  // 隔离测试或尚未装载 Agent Spine 的降级环境没有组合快照，此时保持旧调用可用。
  if (activeProfile === null || sessionProfileId === null) return true;
  if (activeProfile.profileId !== sessionProfileId) return false;
  if (session?.compositionSnapshot === undefined) return true;
  if (session.compositionSnapshot.profileVersion !== activeProfile.profileVersion) return false;
  const frozenToolVersions = Object.entries(session.compositionSnapshot.pluginVersions)
    .filter(([pluginId]) => pluginId.startsWith("tool-plugin/"));
  return frozenToolVersions.length === 0 || frozenToolVersions.every(([pluginId, version]) =>
    activeProfile.pluginVersions?.[pluginId] === version);
}

/** 读取当前运行时组合，并附加当前可用 Tool Plugin 的版本快照。 */
export function getActiveAgentCompositionSnapshot(kernel: IKernel): AgentCompositionSnapshot | null {
  let base: AgentCompositionSnapshot | null;
  try {
    base = kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime)
      .getCompositionSnapshot();
  } catch {
    return null;
  }
  if (!base || typeof kernel.hasService !== "function" || !kernel.hasService(KernelServices.ToolConnectors)) {
    return base;
  }
  const tools = kernel.getService<IToolPluginRuntimeService>(KernelServices.ToolConnectors);
  return typeof tools.extendComposition === "function" ? tools.extendComposition(base) : base;
}
