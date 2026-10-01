import type {
  PromptConfig,
  PromptPresetPlanSource,
  RegexScript,
  SamplerPreset,
  SavedPresetBundle,
  UserSettings,
} from "../../types";
import { PRESET_BUNDLE_SCHEMA_VERSION, type PresetBundleV2 } from "../../domain/presets/contracts";
import { toPromptSnapshotV2 } from "../../domain/presets/promptSnapshot";
import type { RuntimeProfileRecord } from "../runtimeProfiles/contracts";
import {
  applyPresetCompositionToPromptConfig,
  applyPresetPromptConfig,
  createPromptPresetPlan,
  resolvePromptPresetPlan,
  stableSerializePresetSnapshot,
  toPresetPromptConfig,
} from "./presetPromptConfig";

/**
 * 预设包生命周期用例。
 *
 * 预设切换、另存、删除回退和"保存修改到当前预设"必须共用同一套快照与激活规则，
 * 否则任何一条路径漏字段都会造成"预设整体切换"退化（历史上单删就漏掉了预设正则）。
 * 本文件无 IO、无 React 状态，便于在边界测试中锁定契约。
 */

/** 激活预设包后需要写回设置的字段。 */
export interface PresetBundleActivation {
  preset: SamplerPreset;
  promptConfig: PromptConfig;
  presetRegexScripts: RegexScript[];
}

/** 预设包中可参与激活的部分；旧数据缺少 promptPlan 时由 resolvePromptPresetPlan 兜底。 */
export type PresetBundleSource = Pick<
  SavedPresetBundle,
  "preset" | "promptConfig" | "promptPlan" | "composition" | "usePromptComposition" | "presetRegexScripts"
>;

/** 当前设置中属于预设包的字段。 */
export type PresetBundleSelection = Pick<
  UserSettings,
  "preset" | "promptConfig" | "presetRegexScripts"
>;

export interface PresetBundleIdentity {
  id: string;
  isBuiltin?: boolean;
  /** 保留原预设的来源标记；新建副本时由调用方显式指定。 */
  planSource?: PromptPresetPlanSource;
}

export interface PresetBundleReferenceSummary {
  count: number;
  profileNames: string[];
}

export const BUILTIN_PRESET_BUNDLE_ID = "bundle_mobile_tavern_basic";
export const BUILTIN_SAMPLER_PRESET_ID = "preset_mobile_tavern_basic";

/** 判定预设是否为出厂内置预设（只读保护、启动重建）。 */
export function isBuiltinBundle(bundle: PresetBundleV2 | undefined): boolean {
  if (!bundle) return false;
  return Boolean(bundle.isBuiltin)
    || bundle.id === BUILTIN_PRESET_BUNDLE_ID
    || bundle.sampler.id === BUILTIN_SAMPLER_PRESET_ID;
}

/**
 * 权威定位活跃预设包。
 * 1. 优先按 sampler.id 匹配（标准运行形态）
 * 2. 其次按 bundle.id 匹配（防 ID 错位）
 * 3. 再次按名称匹配（兼容采样参数被赋予 "custom" 或历史脏数据）
 * 4. 兜底回落至内置预设或首个预设
 */
export function resolveActivePresetBundle(
  savedPresets: readonly PresetBundleV2[] | undefined,
  preset: Pick<SamplerPreset, "id" | "name"> | undefined,
): PresetBundleV2 | undefined {
  if (!savedPresets || savedPresets.length === 0) return undefined;
  if (!preset) return savedPresets.find((b) => isBuiltinBundle(b)) ?? savedPresets[0];

  return (
    savedPresets.find((b) => b.sampler.id === preset.id) ??
    savedPresets.find((b) => b.id === preset.id) ??
    savedPresets.find((b) => b.sampler.name === preset.name) ??
    savedPresets.find((b) => isBuiltinBundle(b)) ??
    savedPresets[0]
  );
}

/** 计算激活预设包后的设置补丁；所有切换入口都必须经由此函数。 */
export function resolvePresetBundleActivation(
  currentPromptConfig: PromptConfig,
  bundle: PresetBundleSource,
  presetDefaults: SamplerPreset,
): PresetBundleActivation {
  return {
    preset: { ...presetDefaults, ...bundle.preset },
    promptConfig: applyPresetCompositionToPromptConfig(
      applyPresetPromptConfig(currentPromptConfig, bundle.promptConfig),
      bundle,
    ),
    presetRegexScripts: Array.isArray(bundle.presetRegexScripts)
      ? bundle.presetRegexScripts
      : [],
  };
}

/** 用当前设置生成可持久化的预设快照（与切换时的激活规则保持镜像关系）。 */
export function buildPresetBundleSnapshot(
  selection: PresetBundleSelection,
  identity: PresetBundleIdentity,
): PresetBundleV2 {
  const plan = createPromptPresetPlan(selection.promptConfig, identity.planSource ?? "native");
  return {
    schemaVersion: PRESET_BUNDLE_SCHEMA_VERSION,
    id: identity.id,
    ...(identity.isBuiltin ? { isBuiltin: true } : {}),
    sampler: { ...selection.preset },
    // 唯一 Prompt 权威：模式与编排快照来自当前设置；传统字段只进只读兼容块。
    prompt: toPromptSnapshotV2({
      mode: plan.mode,
      source: plan.source,
      composition: plan.composition,
    }),
    legacyPromptConfig: toPresetPromptConfig(selection.promptConfig),
    regexScripts: [...(selection.presetRegexScripts ?? [])],
  };
}

/**
 * 判断当前设置与预设快照是否一致。
 *
 * 只比较预设明确拥有的字段：激活时未声明字段会回到运行时默认（不再继承当前预设），
 * 因此这些字段不计入脏状态，避免旧预设一加载就显示"未保存"。
 */
export function isPresetBundleInSync(
  bundle: PresetBundleV2,
  selection: PresetBundleSelection,
  presetDefaults?: SamplerPreset,
): boolean {
  const liveMode = selection.promptConfig.usePromptComposition ? "composition" : "legacy";
  if (liveMode !== bundle.prompt.mode) return false;
  if (liveMode === "composition" && !isDeepEqual(selection.promptConfig.composition, bundle.prompt.composition)) {
    return false;
  }

  const livePromptConfig = toPresetPromptConfig(selection.promptConfig) as unknown as Record<string, unknown>;
  const storedLegacy = (bundle.legacyPromptConfig ?? {}) as unknown as Record<string, unknown>;
  if (!hasOwnedKeysEqual(livePromptConfig, storedLegacy)) {
    return false;
  }

  const livePreset = presetDefaults ? { ...presetDefaults, ...selection.preset } : selection.preset;
  const storedPreset = presetDefaults ? { ...presetDefaults, ...bundle.sampler } : bundle.sampler;
  if (!hasOwnedKeysEqual(
    livePreset as unknown as Record<string, unknown>,
    storedPreset as unknown as Record<string, unknown>,
  )) {
    return false;
  }

  return isDeepEqual(selection.presetRegexScripts ?? [], bundle.regexScripts ?? []);
}

/** 汇总引用指定预设包的 Runtime Profile，供删除前提示使用。 */
export function collectPresetBundleReferences(
  bundleId: string,
  profiles: readonly RuntimeProfileRecord[],
): PresetBundleReferenceSummary {
  const profileNames = profiles
    .filter((profile) => profile.agent?.promptPresetId === bundleId)
    .map((profile) => profile.name || profile.id);
  return { count: profileNames.length, profileNames };
}

function hasOwnedKeysEqual(
  live: Record<string, unknown>,
  stored: Record<string, unknown>,
): boolean {
  return Object.keys(stored).every((key) => isDeepEqual(live[key], stored[key]));
}

function isDeepEqual(left: unknown, right: unknown): boolean {
  return stableSerializePresetSnapshot(left) === stableSerializePresetSnapshot(right);
}
