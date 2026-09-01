import { parseAgentProfileBundle } from "../runtimeProfiles/agentProfileBundle";
import type {
  RuntimeProfileAgentSettings,
  RuntimeProfileRecord,
  RuntimeProfileToolMount,
} from "../runtimeProfiles/contracts";

export type AgentProfileImportDiagnosticCode =
  | "PROFILE_ID_REGENERATED"
  | "CHARACTER_NOT_FOUND"
  | "TOOL_NOT_FOUND"
  | "TOOL_VERSION_MISMATCH"
  | "PROMPT_PRESET_NOT_FOUND";

export interface AgentProfileImportDiagnostic {
  readonly code: AgentProfileImportDiagnosticCode;
  readonly message: string;
  readonly referenceId?: string;
}

export interface PrepareAgentProfileBundleImportOptions {
  readonly input: unknown;
  readonly createProfileId?: () => string;
  readonly now?: number;
  readonly existingProfileIds?: readonly string[];
  readonly availableCharacterIds?: readonly string[];
  readonly availablePromptPresetIds?: readonly string[];
  readonly availableTools?: readonly RuntimeProfileToolMount[];
}

export interface PreparedAgentProfileBundleImport {
  readonly profile: RuntimeProfileRecord;
  readonly diagnostics: readonly AgentProfileImportDiagnostic[];
}

/** 校验外部 Bundle 并生成尚未持久化的新 Profile；缺失依赖保留引用并返回诊断。 */
export function prepareAgentProfileBundleImport(
  options: PrepareAgentProfileBundleImportOptions,
): PreparedAgentProfileBundleImport {
  const bundle = parseAgentProfileBundle(options.input);
  const now = options.now ?? Date.now();
  const id = (options.createProfileId ?? createImportedProfileId)();
  const diagnostics: AgentProfileImportDiagnostic[] = [];
  const existingIds = new Set(options.existingProfileIds ?? []);
  if (existingIds.has(id)) throw new Error(`RUNTIME_PROFILE_ALREADY_EXISTS: ${id}`);
  if (existingIds.has(bundle.profile.source.id)) {
    diagnostics.push({
      code: "PROFILE_ID_REGENERATED",
      message: "来源 Profile ID 已存在，已为导入副本生成新 ID。",
      referenceId: bundle.profile.source.id,
    });
  }

  const characterId = bundle.profile.character?.id;
  if (
    characterId
    && options.availableCharacterIds
    && !options.availableCharacterIds.includes(characterId)
  ) {
    diagnostics.push({
      code: "CHARACTER_NOT_FOUND",
      message: `引用角色尚未安装：${bundle.profile.character?.name ?? characterId}`,
      referenceId: characterId,
    });
  }

  appendToolDiagnostics(bundle.profile.tools, options.availableTools, diagnostics);

  const promptPresetId = bundle.profile.behavior.promptPreset?.id;
  if (
    promptPresetId
    && options.availablePromptPresetIds
    && !options.availablePromptPresetIds.includes(promptPresetId)
  ) {
    diagnostics.push({
      code: "PROMPT_PRESET_NOT_FOUND",
      message: `引用行为预设尚未安装：${bundle.profile.behavior.promptPreset?.name ?? promptPresetId}`,
      referenceId: promptPresetId,
    });
  }

  const agent: RuntimeProfileAgentSettings = {
    characterId,
    toolMounts: bundle.profile.tools.map((tool) => ({ ...tool })),
    promptPresetId,
    sampling: bundle.profile.behavior.sampling
      ? { ...bundle.profile.behavior.sampling }
      : undefined,
  };
  return {
    profile: {
      id,
      name: bundle.profile.name,
      schemaVersion: 1,
      version: 1,
      builtin: false,
      capabilities: { ...bundle.profile.capabilities },
      agent,
      createdAt: now,
      updatedAt: now,
    },
    diagnostics,
  };
}

function appendToolDiagnostics(
  requested: readonly RuntimeProfileToolMount[],
  available: readonly RuntimeProfileToolMount[] | undefined,
  diagnostics: AgentProfileImportDiagnostic[],
): void {
  if (!available) return;
  const byName = new Map(available.map((tool) => [tool.name, tool]));
  requested.forEach((tool) => {
    const installed = byName.get(tool.name);
    if (!installed) {
      diagnostics.push({
        code: "TOOL_NOT_FOUND",
        message: `引用 Tool 尚未安装：${tool.name}`,
        referenceId: tool.name,
      });
      return;
    }
    if (tool.version && installed.version !== tool.version) {
      diagnostics.push({
        code: "TOOL_VERSION_MISMATCH",
        message: `Tool 版本不匹配：${tool.name}（需要 ${tool.version}）`,
        referenceId: tool.name,
      });
    }
  });
}

function createImportedProfileId(): string {
  const randomPart = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "")
    : Math.random().toString(36).slice(2);
  return `user.profile.${Date.now().toString(36)}.${randomPart}`;
}
