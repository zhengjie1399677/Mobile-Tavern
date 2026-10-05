import type { PromptConfig, SamplerPreset } from "../../types";
import type { PresetBundleV2 } from "../../domain/presets/contracts";
import type { PresetBundleActivation } from "./presetBundleLifecycle";
import { toPresetPromptConfig } from "./presetPromptConfig";

/**
 * 预设实体 v2 → 运行期消费形态的唯一投影。
 *
 * v2 里 `prompt` 快照是唯一 Prompt 权威，传统 Prompt 字段只存在于 `legacyPromptConfig`
 * 兼容块。运行期（传统 Prompt 路径与自由编排路径）仍需要一份 `PromptConfig`，因此这里
 * 提供**唯一**的投影实现：
 *
 * - 传统字段整体替换自兼容块（未声明的字段回到运行期默认，不继承上一个预设）；
 * - 运行模式与编排快照直接来自 `prompt`，不再二次解析 `promptPlan` / 废弃字段。
 *
 * 自由编排改造成工作画布后，本文件是唯一需要删除或改写的适配点，其余代码只消费 v2 实体。
 */

/** 预设拥有的运行期数据投影。 */
export interface PresetRuntimeProjection {
  sampler: PresetBundleV2["sampler"];
  promptSnapshot: PresetBundleV2["prompt"];
  /** 传统 Prompt 字段；缺省表示该预设不声明传统字段（全部回落到运行期默认）。 */
  legacyPromptConfig: PresetBundleV2["legacyPromptConfig"];
  regexScripts: PresetBundleV2["regexScripts"];
}

export function projectPresetRuntime(bundle: PresetBundleV2): PresetRuntimeProjection {
  return {
    sampler: bundle.sampler,
    promptSnapshot: bundle.prompt,
    legacyPromptConfig: bundle.legacyPromptConfig,
    regexScripts: bundle.regexScripts,
  };
}

/**
 * v2 采样参数 → 运行期完整采样参数。
 *
 * v2 允许采样数值缺省（第三方导入与历史数据长期如此），运行期处处要求完整形状，
 * 因此缺省值一律由调用方给出的默认采样补齐；`id`/`name` 以预设自身声明为准。
 */
export function projectSamplerPreset(
  sampler: PresetBundleV2["sampler"],
  defaults: SamplerPreset,
): SamplerPreset {
  return {
    id: sampler.id,
    name: sampler.name,
    temperature: sampler.temperature ?? defaults.temperature,
    topP: sampler.topP ?? defaults.topP,
    topK: sampler.topK ?? defaults.topK,
    repetitionPenalty: sampler.repetitionPenalty ?? defaults.repetitionPenalty,
    frequencyPenalty: sampler.frequencyPenalty ?? defaults.frequencyPenalty,
    presencePenalty: sampler.presencePenalty ?? defaults.presencePenalty,
    minP: sampler.minP ?? defaults.minP,
    maxTokens: sampler.maxTokens ?? defaults.maxTokens,
  };
}

/**
 * 计算激活预设包后的设置补丁。
 *
 * 与 v1 的 `resolvePresetBundleActivation` 语义逐字对应：
 * `preset` 与出厂默认合并；传统字段整体替换；`usePromptComposition`/`composition`
 * 由快照模式决定，未声明编排时保留当前设置的编排对象。
 */
export function projectPresetActivation(
  current: PromptConfig,
  bundle: PresetBundleV2,
  presetDefaults: SamplerPreset,
): PresetBundleActivation {
  const legacy = toPresetPromptConfig((bundle.legacyPromptConfig ?? {}) as PromptConfig);
  return {
    preset: projectSamplerPreset(bundle.sampler, presetDefaults),
    promptConfig: {
      ...legacy,
      composition: bundle.prompt.composition ?? current.composition,
      usePromptComposition: bundle.prompt.mode === "composition",
    },
    presetRegexScripts: [...bundle.regexScripts],
  };
}
