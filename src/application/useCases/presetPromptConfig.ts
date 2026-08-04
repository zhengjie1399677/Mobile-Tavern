import type { PresetPromptConfig, PromptConfig, SavedPresetBundle } from "../../types";

/** 从完整设置中提取预设可拥有的传统 Prompt 字段。 */
export function toPresetPromptConfig(config: PromptConfig): PresetPromptConfig {
  const {
    composition: _composition,
    usePromptComposition: _usePromptComposition,
    ...presetPromptConfig
  } = config;
  return presetPromptConfig;
}

/** 应用预设字段并保留当前自由编排状态。 */
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

/**
 * 应用预设携带的提示词编排（规划）。
 *
 * 规划属于预设：预设包显式声明 usePromptComposition 时，加载预设整体切换
 * 自由编排及其编排快照；旧预设包（字段缺省）保持当前自由编排状态不变，
 * 仅由 applyPresetPromptConfig 应用传统 Prompt 字段，保证向后兼容。
 */
export function applyPresetCompositionToPromptConfig(
  current: PromptConfig,
  bundle: Pick<SavedPresetBundle, "composition" | "usePromptComposition">,
): PromptConfig {
  if (bundle.usePromptComposition === undefined) return current;
  return {
    ...current,
    usePromptComposition: bundle.usePromptComposition,
    composition: bundle.usePromptComposition && bundle.composition
      ? bundle.composition
      : current.composition,
  };
}
