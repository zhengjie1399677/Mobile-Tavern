import type { IKernel } from "../../kernel/types";
import type { ChatSession } from "../../types";
import type { IAgentRuntimeService } from "../serviceContracts";
import { KernelServices } from "../serviceContracts";
import type { IRuntimeProfileService } from "../runtimeProfiles/contracts";
import { BUILTIN_TAVERN_PROFILE_ID } from "../runtimeProfiles/contracts";
import {
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

  profiles.selectProfile(targetProfile.id);
  writeRuntimeProfileSessionResumeIntent({
    schemaVersion: 1,
    sessionId: session.id,
    characterId: session.characterId,
    profileId: targetProfile.id,
    profileVersion: targetProfile.version,
  });
  return { status: "reload" };
}
