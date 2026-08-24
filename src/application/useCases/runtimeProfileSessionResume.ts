import type { IKernel } from "../../kernel/types";
import type { ChatSession } from "../../types";
import type { IAgentRuntimeService } from "../serviceContracts";
import { KernelServices } from "../serviceContracts";
import type { IRuntimeProfileService } from "../runtimeProfiles/contracts";
import { BUILTIN_TAVERN_PROFILE_ID } from "../runtimeProfiles/contracts";
import {
  clearRuntimeProfileSessionResumeIntent,
  writeRuntimeProfileSessionResumeIntent,
} from "../../infrastructure/runtimeProfiles/runtimeProfileSessionResume";
import { canRunSessionWithProfile, getSessionRuntimeProfileId } from "./runtimeProfileSession";

export type RuntimeProfileSessionResumeResult =
  | { readonly status: "ready" }
  | { readonly status: "reload" }
  | { readonly status: "unavailable"; readonly message: string };

/** 为跨 Profile 会话跳转准备一次可恢复的应用重载。 */
export function prepareRuntimeProfileSessionResume(
  kernel: IKernel,
  session: ChatSession,
): RuntimeProfileSessionResumeResult {
  const runtime = kernel.hasService(KernelServices.AgentRuntime)
    ? kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime)
    : null;
  const activeComposition = runtime?.getCompositionSnapshot() ?? null;
  if (canRunSessionWithProfile(session, activeComposition)) return { status: "ready" };

  const targetProfileId = getSessionRuntimeProfileId(session) ?? BUILTIN_TAVERN_PROFILE_ID;
  const profiles = kernel
    .getService<IRuntimeProfileService>(KernelServices.RuntimeProfiles);
  const targetProfile = profiles.listProfiles().profiles.find((profile) =>
    profile.id === targetProfileId
    && (
      session.compositionSnapshot === undefined
      || profile.version === session.compositionSnapshot.profileVersion
    ),
  );
  if (!targetProfile) {
    return {
      status: "unavailable",
      message: `会话所需 Agent Profile 不可用：${targetProfileId} v${session.compositionSnapshot?.profileVersion ?? "legacy"}`,
    };
  }

  const intent = {
    schemaVersion: 1,
    sessionId: session.id,
    characterId: session.characterId,
    profileId: targetProfile.id,
    profileVersion: targetProfile.version,
  } as const;
  try {
    // 先可靠落下一次性意图，避免 Profile 已切换而目标会话无法在重载后恢复。
    writeRuntimeProfileSessionResumeIntent(intent);
  } catch {
    clearResumeIntentBestEffort();
    return {
      status: "unavailable",
      message: "当前环境无法保存跨 Profile 会话恢复状态，已保持现有 Agent Profile。",
    };
  }
  try {
    profiles.selectProfile(targetProfile.id);
  } catch {
    clearResumeIntentBestEffort();
    return {
      status: "unavailable",
      message: "目标 Agent Profile 无法持久化，已取消本次会话切换。",
    };
  }
  return { status: "reload" };
}

function clearResumeIntentBestEffort(): void {
  try {
    clearRuntimeProfileSessionResumeIntent();
  } catch {
    // 不再触发重载；后续读取会校验 Profile 身份并拒绝悬空意图。
  }
}
