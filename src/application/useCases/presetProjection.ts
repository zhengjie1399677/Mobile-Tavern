import type { PromptConfig, RegexScript, SamplerPreset } from "../../types";
import type { PresetBundle } from "../../domain/presets/contracts";
import {
  findDirectPresetBundleMatch,
  resolveActivePresetBundle,
  type PresetBundleActivation,
} from "./presetBundleLifecycle";
import { toPresetPromptConfig } from "./presetPromptConfig";

export interface StartupPresetSelectionInput {
  savedPresets: readonly PresetBundle[];
  storedPreset?: Partial<SamplerPreset> | undefined;
  resolvedPreset: SamplerPreset;
  storedPromptConfig: PromptConfig;
  storedPresetRegexScripts?: RegexScript[] | undefined;
  presetDefaults: SamplerPreset;
}

export interface StartupPresetSelectionResult {
  preset: SamplerPreset;
  promptConfig: PromptConfig;
  presetRegexScripts: RegexScript[];
  needsSave: boolean;
  /** 仅当存储的预设标识在预设列表中已完全失效、被迫回退到首个预设时为 `true`。 */
  fellBackFromOrphanPreset: boolean;
}

/**
 * 启动期预设选择与孤儿兜底收口：
 * - 若按 id/bundle.id/name 命中既有预设（含 `"custom"` 历史自愈），仅在必要时修复 id/name，
 *   保留存储中的 Prompt 与正则配置；
 * - 若存储预设身份已彻底丢失（孤儿预设）并回落到兜底预设，则整包投影兜底预设，
 *   防止后续保存时用孤儿 Prompt 内容覆盖兜底预设。
 */
export function resolveStartupPresetSelection(
  input: StartupPresetSelectionInput,
): StartupPresetSelectionResult {
  // 匹配已有预设时只认存储里真实声明过的 id/name，避免默认采样名称污染孤儿判定。
  const identityProbe = input.storedPreset
    ? { id: input.storedPreset.id, name: input.storedPreset.name }
    : input.resolvedPreset;
  const directMatch = input.storedPreset
    ? findDirectPresetBundleMatch(input.savedPresets, identityProbe)
    : undefined;
  const activeBundle = directMatch ?? resolveActivePresetBundle(input.savedPresets, identityProbe);
  if (!activeBundle) {
    return {
      preset: input.resolvedPreset,
      promptConfig: input.storedPromptConfig,
      presetRegexScripts: Array.isArray(input.storedPresetRegexScripts)
        ? input.storedPresetRegexScripts
        : [],
      needsSave: false,
      fellBackFromOrphanPreset: false,
    };
  }

  const isLegacyCustomId = input.storedPreset?.id === "custom";
  const hasExplicitIdentity = Boolean(
    input.storedPreset?.id?.trim() || input.storedPreset?.name?.trim(),
  );
  if (!directMatch && hasExplicitIdentity && !isLegacyCustomId) {
    const activation = projectPresetActivation(activeBundle, input.presetDefaults);
    return {
      preset: activation.preset,
      promptConfig: activation.promptConfig,
      presetRegexScripts: activation.presetRegexScripts,
      needsSave: true,
      fellBackFromOrphanPreset: true,
    };
  }

  const preset = { ...input.resolvedPreset };
  let needsSave = false;
  if (preset.id === "custom" || !input.savedPresets.some((b) => b.sampler.id === preset.id)) {
    preset.id = activeBundle.sampler.id;
    preset.name = activeBundle.sampler.name;
    needsSave = true;
  }

  // CHANGE-SAFE：预设正则字段在旧版本设置里可能缺失，仅在非数组时按活跃预设回填；空数组显式保留。
  const hasStoredRegex = Array.isArray(input.storedPresetRegexScripts);
  const presetRegexScripts = hasStoredRegex
    ? input.storedPresetRegexScripts!
    : activeBundle.regexScripts?.length
      ? [...activeBundle.regexScripts]
      : [];
  if (!hasStoredRegex && activeBundle.regexScripts?.length) {
    needsSave = true;
  }

  return {
    preset,
    promptConfig: input.storedPromptConfig,
    presetRegexScripts,
    needsSave,
    fellBackFromOrphanPreset: false,
  };
}

/**
 * 预设实体 → 运行期消费形态的唯一投影。
 *
 * 预设实体只持有传统 `promptConfig` 与采样、正则；运行期需要的完整 `PromptConfig`
 * 由这里投影：显式声明的字段整体替换，未声明字段回到运行期默认（不继承上一个预设）。
 */

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
    topA: sampler.topA ?? defaults.topA,
    seed: sampler.seed ?? defaults.seed,
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
