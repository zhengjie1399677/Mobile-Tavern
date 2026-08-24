import type { RuntimeProfileDefinition } from "../runtimePlugins/contracts";
import {
  AGENT_SPINE_RUNTIME_PLUGIN_ID,
  AUDIO_ASR_PROCESSOR_ID,
  MOBILE_TAVERN_CHAT_DRIVER_ID,
  OPENAI_COMPATIBLE_PROVIDER_ID,
  VIDEO_KEYFRAME_PROCESSOR_ID,
} from "../runtimePlugins/agentSpineRuntimePlugin";
import { LEGACY_RUNTIME_PLUGIN_ID } from "../runtimePlugins/legacyRuntimePlugin";
import { SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID } from "../compatibility/contracts";
import {
  BUILTIN_BASE_PROFILE_ID,
  BUILTIN_TAVERN_PROFILE_ID,
  type RuntimeProfilePreferenceState,
  type RuntimeProfileRecord,
  type RuntimeProfileResolutionDiagnostic,
} from "./contracts";

const BUILTIN_TIMESTAMP = 0;

export const builtinRuntimeProfiles: readonly RuntimeProfileRecord[] = Object.freeze([
  freezeProfile({
    id: BUILTIN_BASE_PROFILE_ID,
    name: "Base Agent",
    schemaVersion: 1,
    version: 1,
    builtin: true,
    capabilities: {
      sillyTavernCompatibility: false,
      audioAsrFallback: true,
      videoKeyframeFallback: true,
    },
    createdAt: BUILTIN_TIMESTAMP,
    updatedAt: BUILTIN_TIMESTAMP,
  }),
  freezeProfile({
    id: BUILTIN_TAVERN_PROFILE_ID,
    name: "Tavern Agent",
    schemaVersion: 1,
    version: 3,
    builtin: true,
    capabilities: {
      sillyTavernCompatibility: true,
      audioAsrFallback: true,
      videoKeyframeFallback: true,
    },
    createdAt: BUILTIN_TIMESTAMP,
    updatedAt: BUILTIN_TIMESTAMP,
  }),
]);

export interface ResolvedRuntimeProfileSelection {
  readonly profile: RuntimeProfileRecord;
  readonly definition: RuntimeProfileDefinition;
  readonly diagnostics: readonly RuntimeProfileResolutionDiagnostic[];
}

export function listRuntimeProfileRecords(
  state: RuntimeProfilePreferenceState,
): RuntimeProfileRecord[] {
  return [...builtinRuntimeProfiles, ...state.customProfiles].map(freezeProfile);
}

export function resolveRuntimeProfileSelection(
  state: RuntimeProfilePreferenceState,
  invalidStoredValue = false,
): ResolvedRuntimeProfileSelection {
  const diagnostics: RuntimeProfileResolutionDiagnostic[] = [];
  if (invalidStoredValue) {
    diagnostics.push({
      code: "PROFILE_INVALID",
      message: "运行时 Profile 配置无效，已安全回退到 Tavern Agent。",
    });
  }
  const profiles = listRuntimeProfileRecords(state);
  let profile = profiles.find((candidate) => candidate.id === state.selectedProfileId);
  if (!profile) {
    diagnostics.push({
      code: "PROFILE_NOT_FOUND",
      message: `运行时 Profile 不存在，已安全回退到 Tavern Agent：${state.selectedProfileId}`,
    });
    profile = profiles.find((candidate) => candidate.id === BUILTIN_TAVERN_PROFILE_ID)!;
  }
  return {
    profile,
    definition: buildRuntimeProfileDefinition(profile),
    diagnostics: Object.freeze(diagnostics),
  };
}

export function buildRuntimeProfileDefinition(
  profile: RuntimeProfileRecord,
): RuntimeProfileDefinition {
  const compatibility = profile.capabilities.sillyTavernCompatibility;
  const mediaProcessors = [
    ...(profile.capabilities.audioAsrFallback ? [AUDIO_ASR_PROCESSOR_ID] : []),
    ...(profile.capabilities.videoKeyframeFallback ? [VIDEO_KEYFRAME_PROCESSOR_ID] : []),
  ];
  return {
    id: profile.id,
    version: profile.version,
    plugins: [
      { id: LEGACY_RUNTIME_PLUGIN_ID, version: "1.0.0" },
      ...(compatibility
        ? [{ id: SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID, version: "1.0.0" }]
        : []),
      { id: AGENT_SPINE_RUNTIME_PLUGIN_ID, version: "1.0.0" },
    ],
    bindings: {
      "agent.driver": MOBILE_TAVERN_CHAT_DRIVER_ID,
      "llm.route": OPENAI_COMPATIBLE_PROVIDER_ID,
    },
    contributions: {
      tool: [],
      "media.processor": mediaProcessors,
      ...(compatibility ? {
        "compat.codec": ["compat.sillytavern.codec.prompt-preset"],
        "compat.prompt-section": ["compat.sillytavern.prompt.mvu-state"],
        "compat.context-source": ["compat.sillytavern.context.mvu-state"],
        "compat.transform": ["compat.sillytavern.transform.regex"],
        "compat.state-reducer": ["compat.sillytavern.state.mvu"],
        "compat.renderer": ["compat.sillytavern.renderer"],
      } : {}),
    },
  };
}

export function findRuntimeProfile(
  state: RuntimeProfilePreferenceState,
  profileId: string,
): RuntimeProfileRecord | null {
  return listRuntimeProfileRecords(state).find((profile) => profile.id === profileId) ?? null;
}

function freezeProfile(profile: RuntimeProfileRecord): RuntimeProfileRecord {
  return Object.freeze({
    ...profile,
    capabilities: Object.freeze({ ...profile.capabilities }),
  });
}
