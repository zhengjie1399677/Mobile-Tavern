import type { PresetPromptConfig, PromptConfig } from "../../types";

/** 从完整设置中提取预设可拥有的传统 Prompt 字段。 */
export function toPresetPromptConfig(config: PromptConfig): PresetPromptConfig {
  const {
    composition: _composition,
    usePromptComposition: _usePromptComposition,
    ...presetPromptConfig
  } = config;
  return presetPromptConfig;
}

/**
 * 应用预设字段并保留当前自由编排状态。
 * 旧预设包即使携带历史遗留字段，也会在提取阶段被安全忽略。
 */
export function applyPresetPromptConfig(
  current: PromptConfig,
  stored: PresetPromptConfig,
): PromptConfig {
  return {
    ...current,
    ...toPresetPromptConfig(stored as PromptConfig),
    composition: current.composition,
    usePromptComposition: current.usePromptComposition,
  };
}
