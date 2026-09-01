import {
  AGENT_PROFILE_BUNDLE_KIND,
  AGENT_PROFILE_BUNDLE_SCHEMA_VERSION,
  type AgentProfileBundleV1,
  type AgentProfileResourceReference,
} from "../runtimeProfiles/agentProfileBundle";
import type { RuntimeProfileRecord } from "../runtimeProfiles/contracts";
import {
  CHARACTER_READ_TOOL_NAME,
  SESSION_BRANCH_TOOL_NAME,
} from "../tools/builtinAgentTools";

export interface PrepareAgentProfileBundleExportOptions {
  readonly profile: RuntimeProfileRecord;
  readonly character?: AgentProfileResourceReference;
  readonly promptPreset?: AgentProfileResourceReference;
  readonly exportedAt?: number;
}

export interface PreparedAgentProfileBundleExport {
  readonly data: AgentProfileBundleV1;
  readonly fileName: string;
}

/** 构建可移植 Agent/Profile 小型粘合文件；只挑选公开字段，不复制任意附加配置。 */
export function prepareAgentProfileBundleExport(
  options: PrepareAgentProfileBundleExportOptions,
): PreparedAgentProfileBundleExport {
  const { profile } = options;
  assertMatchingReference("CHARACTER", profile.agent?.characterId, options.character);
  assertMatchingReference("PROMPT_PRESET", profile.agent?.promptPresetId, options.promptPreset);
  const tools = profile.agent?.toolMounts ?? [
    { name: CHARACTER_READ_TOOL_NAME, version: "1.0.0" },
    { name: SESSION_BRANCH_TOOL_NAME, version: "1.0.0" },
  ];
  const data: AgentProfileBundleV1 = {
    kind: AGENT_PROFILE_BUNDLE_KIND,
    schemaVersion: AGENT_PROFILE_BUNDLE_SCHEMA_VERSION,
    exportedAt: options.exportedAt ?? Date.now(),
    profile: {
      name: profile.name,
      source: { id: profile.id, version: profile.version },
      capabilities: { ...profile.capabilities },
      character: options.character ? { ...options.character } : undefined,
      tools: tools.map((tool) => ({ ...tool })),
      behavior: {
        promptPreset: options.promptPreset ? { ...options.promptPreset } : undefined,
        sampling: profile.agent?.sampling ? { ...profile.agent.sampling } : undefined,
      },
    },
  };
  return {
    data,
    fileName: `${sanitizeFileName(profile.name)}.agent-profile.json`,
  };
}

function assertMatchingReference(
  kind: "CHARACTER" | "PROMPT_PRESET",
  expectedId: string | undefined,
  reference: AgentProfileResourceReference | undefined,
): void {
  if (!expectedId && !reference) return;
  if (!expectedId || reference?.id !== expectedId) {
    throw new Error(`AGENT_PROFILE_${kind}_REFERENCE_MISMATCH`);
  }
}

function sanitizeFileName(name: string): string {
  const normalized = name.trim().replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
  return normalized || "agent-profile";
}
