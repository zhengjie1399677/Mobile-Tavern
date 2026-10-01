import type { AgentCompositionSnapshot } from "../../domain/agents/contracts";
import type { SamplerPreset, UserSettings } from "../../types";
import { readAgentSettingsFromComposition } from "../runtimeProfiles/agentSettings";
import type { RuntimeProfileSamplingSettings } from "../runtimeProfiles/contracts";
import { projectPresetActivation } from "./presetProjection";

/**
 * 将会话创建时冻结的 Agent 行为引用解析为本次请求设置。
 * 旧会话没有 Agent 决策时返回原设置；引用已丢失时 fail-closed，避免静默换行为。
 *
 * 预设实体的消费一律经唯一投影 `projectPresetActivation`，不直接读 v1 字段。
 */
export function resolveAgentSessionSettings(
  settings: UserSettings,
  snapshot: AgentCompositionSnapshot | undefined,
): UserSettings {
  const agent = readAgentSettingsFromComposition(snapshot);
  if (!agent) return settings;

  const promptPreset = agent.promptPresetId
    ? settings.savedPresets?.find((candidate) => candidate.id === agent.promptPresetId)
    : undefined;
  if (agent.promptPresetId && !promptPreset) {
    throw new Error(`AGENT_PROMPT_PRESET_NOT_FOUND: ${agent.promptPresetId}`);
  }

  const promptConfig = promptPreset
    ? projectPresetActivation(settings.promptConfig, promptPreset, settings.preset).promptConfig
    : settings.promptConfig;
  const preset = applySampling(
    promptPreset ? { ...settings.preset, ...promptPreset.sampler } : settings.preset,
    agent.sampling,
  );

  return {
    ...settings,
    preset,
    promptConfig,
    presetRegexScripts: promptPreset?.regexScripts ?? settings.presetRegexScripts,
  };
}

function applySampling(
  preset: SamplerPreset,
  sampling: RuntimeProfileSamplingSettings | undefined,
): SamplerPreset {
  return sampling ? { ...preset, ...sampling } : preset;
}
