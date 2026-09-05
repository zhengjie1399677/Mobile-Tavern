import { DEFAULT_PROMPT_CONFIG, DEFAULT_SETTINGS } from "../../defaults/settings";
import type { AgentCompositionSnapshot } from "../../domain/agents/contracts";
import type { SamplerPreset, UserSettings } from "../../types";
import { readAgentSettingsFromComposition } from "../runtimeProfiles/agentSettings";
import type { RuntimeProfileSamplingSettings } from "../runtimeProfiles/contracts";
import {
  applyPresetCompositionToPromptConfig,
  applyPresetPromptConfig,
} from "./presetPromptConfig";

/**
 * 将会话创建时冻结的 Agent 行为引用解析为本次请求设置。
 * 旧会话没有 Agent 决策时返回原设置；引用已丢失时 fail-closed，避免静默换行为。
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
    ? applyPresetCompositionToPromptConfig(
        applyPresetPromptConfig(DEFAULT_PROMPT_CONFIG, promptPreset.promptConfig),
        promptPreset,
      )
    : settings.promptConfig;
  const preset = applySampling(
    promptPreset ? { ...DEFAULT_SETTINGS.preset, ...promptPreset.preset } : settings.preset,
    agent.sampling,
  );

  return {
    ...settings,
    preset,
    promptConfig,
    presetRegexScripts: promptPreset ? promptPreset.presetRegexScripts ?? [] : settings.presetRegexScripts,
  };
}

function applySampling(
  preset: SamplerPreset,
  sampling: RuntimeProfileSamplingSettings | undefined,
): SamplerPreset {
  return sampling ? { ...preset, ...sampling } : preset;
}
