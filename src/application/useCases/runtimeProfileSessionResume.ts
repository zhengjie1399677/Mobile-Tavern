import type { IKernel } from "../../kernel/types";
import type { ChatSession } from "../../types";
import { KernelServices } from "../serviceContracts";
import type { IRuntimeProfileService } from "../runtimeProfiles/contracts";
import { BUILTIN_TAVERN_PROFILE_ID } from "../runtimeProfiles/contracts";
import { clearRuntimeProfileSessionResumeIntent, writeRuntimeProfileSessionResumeIntent } from "../../infrastructure/runtimeProfiles/runtimeProfileSessionResume";
import { canRunSessionWithProfile, getActiveAgentCompositionSnapshot, getSessionRuntimeProfileId } from "./runtimeProfileSession";

export type RuntimeProfileSessionResumeResult =
  | { readonly status: "ready" }
  | { readonly status: "reload" }
  | { readonly status: "unavailable"; readonly message: string };

/** 为跨 Profile 会话跳转准备一次可恢复的应用重载。 */
export function prepareRuntimeProfileSessionResume(
  kernel: IKernel,
  session: ChatSession,
): RuntimeProfileSessionResumeResult {
  const activeComposition = getActiveAgentCompositionSnapshot(kernel);
  if (canRunSessionWithProfile(session, activeComposition)) return { status: "ready" };

  const targetProfileId = getSessionRuntimeProfileId(session) ?? BUILTIN_TAVERN_PROFILE_ID;
  if (
    activeComposition?.profileId === targetProfileId
    && activeComposition.profileVersion === session.compositionSnapshot?.profileVersion
  ) {
    return {
      status: "unavailable",
      message: "会话冻结的 Tool Plugin 版本与当前运行时不一致，请恢复对应版本后重试。",
    };
  }
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
