import type { RuntimeProfileRecord, RuntimeProfileToolMount } from "../runtimeProfiles/contracts";
import type { IRuntimeProfileService } from "../runtimeProfiles/contracts";
import {
  clearRuntimeProfileAgentLaunchIntent,
  writeRuntimeProfileAgentLaunchIntent,
} from "../../infrastructure/runtimeProfiles/runtimeProfileAgentLaunch";
import { clearRuntimeProfileSessionResumeIntent } from "../../infrastructure/runtimeProfiles/runtimeProfileSessionResume";

export interface PrepareRuntimeProfileAgentLaunchOptions {
  readonly service: IRuntimeProfileService;
  readonly profile: RuntimeProfileRecord;
  readonly availableCharacterIds: readonly string[];
  readonly availablePromptPresetIds: readonly string[];
  readonly availableTools: readonly RuntimeProfileToolMount[];
}

export type RuntimeProfileAgentLaunchResult =
  | { readonly status: "reload" }
  | { readonly status: "unavailable"; readonly message: string };

/** 校验 Agent 依赖、持久化一次性启动意图并选择 Profile；调用方随后重载运行时。 */
export function prepareRuntimeProfileAgentLaunch(
  options: PrepareRuntimeProfileAgentLaunchOptions,
): RuntimeProfileAgentLaunchResult {
  const { profile, service } = options;
  const current = service.listProfiles().profiles.find((candidate) =>
    candidate.id === profile.id && candidate.version === profile.version,
  );
  if (!current) {
    return { status: "unavailable", message: "Agent Profile 已变化，请刷新后重试。" };
  }
  const characterId = current.agent?.characterId;
  if (!characterId) {
    return { status: "unavailable", message: "请先为 Agent 选择角色。" };
  }
  if (!options.availableCharacterIds.includes(characterId)) {
    return { status: "unavailable", message: `Agent 引用的角色不存在：${characterId}` };
  }
  const promptPresetId = current.agent?.promptPresetId;
  if (promptPresetId && !options.availablePromptPresetIds.includes(promptPresetId)) {
    return { status: "unavailable", message: `Agent 引用的行为预设不存在：${promptPresetId}` };
  }
  const toolError = findToolDependencyError(current.agent?.toolMounts ?? [], options.availableTools);
  if (toolError) return { status: "unavailable", message: toolError };

  try {
    clearRuntimeProfileSessionResumeIntent();
    writeRuntimeProfileAgentLaunchIntent({
      schemaVersion: 1,
      profileId: current.id,
      profileVersion: current.version,
      characterId,
    });
  } catch {
    clearLaunchIntentBestEffort();
    return {
      status: "unavailable",
      message: "当前环境无法保存 Agent 启动状态，已保持现有 Profile。",
    };
  }
  try {
    service.selectProfile(current.id);
  } catch {
    clearLaunchIntentBestEffort();
    return { status: "unavailable", message: "Agent Profile 无法持久化，已取消启动。" };
  }
  return { status: "reload" };
}

function findToolDependencyError(
  requested: readonly RuntimeProfileToolMount[],
  available: readonly RuntimeProfileToolMount[],
): string | null {
  const byName = new Map(available.map((tool) => [tool.name, tool.version]));
  for (const tool of requested) {
    if (!byName.has(tool.name)) return `Agent 引用的 Tool 不存在：${tool.name}`;
    if (tool.version && byName.get(tool.name) !== tool.version) {
      return `Agent 引用的 Tool 版本不匹配：${tool.name}（需要 ${tool.version}）`;
    }
  }
  return null;
}

function clearLaunchIntentBestEffort(): void {
  try {
    clearRuntimeProfileAgentLaunchIntent();
  } catch {
    // 未选择 Profile，不会继续触发重载。
  }
}
