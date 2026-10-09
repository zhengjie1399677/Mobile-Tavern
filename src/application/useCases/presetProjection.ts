import type { PromptConfig, SamplerPreset } from "../../types";
import type { PresetBundle } from "../../domain/presets/contracts";
import type { PresetBundleActivation } from "./presetBundleLifecycle";
import { toPresetPromptConfig } from "./presetPromptConfig";

/**
 * 预设实体 → 运行期消费形态的唯一投影。
 *
 * 预设实体只持有传统 `promptConfig` 与采样、正则；运行期需要的完整 `PromptConfig`
 * 由这里投影：显式声明的字段整体替换，未声明字段回到运行期默认（不继承上一个预设）。
 */

/** 预设拥有的运行期数据投影。 */
export interface PresetRuntimeProjection {
  sampler: PresetBundle["sampler"];
  promptConfig: PresetBundle["promptConfig"];
  regexScripts: PresetBundle["regexScripts"];
}

export function projectPresetRuntime(bundle: PresetBundle): PresetRuntimeProjection {
  return {
    sampler: bundle.sampler,
    promptConfig: bundle.promptConfig,
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
  sampler: PresetBundle["sampler"],
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
 * 计算激活预设包后的设置补丁：`preset` 与出厂默认合并，Prompt 字段整体替换。
 */
export function projectPresetActivation(
  bundle: PresetBundle,
  presetDefaults: SamplerPreset,
): PresetBundleActivation {
  return {
    preset: projectSamplerPreset(bundle.sampler, presetDefaults),
    promptConfig: toPresetPromptConfig((bundle.promptConfig ?? {}) as PromptConfig),
    presetRegexScripts: [...bundle.regexScripts],
  };
}
