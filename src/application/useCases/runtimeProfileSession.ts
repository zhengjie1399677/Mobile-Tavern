import type { ChatSession } from "../../types";
import type { AgentCompositionSnapshot } from "../../domain/agents/contracts";
import { BUILTIN_TAVERN_PROFILE_ID } from "../runtimeProfiles/contracts";

/** 旧会话创建于 Profile 功能之前，必须继续按 Tavern Agent 解释以保持行为兼容。 */
export function getSessionRuntimeProfileId(session: ChatSession | null): string | null {
  if (!session) return null;
  return session.compositionSnapshot?.profileId ?? BUILTIN_TAVERN_PROFILE_ID;
}

export function canRunSessionWithProfile(
  session: ChatSession | null,
  activeProfile: Pick<AgentCompositionSnapshot, "profileId" | "profileVersion"> | null,
): boolean {
  const sessionProfileId = getSessionRuntimeProfileId(session);
  // 隔离测试或尚未装载 Agent Spine 的降级环境没有组合快照，此时保持旧调用可用。
  if (activeProfile === null || sessionProfileId === null) return true;
  if (activeProfile.profileId !== sessionProfileId) return false;
  return session?.compositionSnapshot === undefined
    || session.compositionSnapshot.profileVersion === activeProfile.profileVersion;
}
