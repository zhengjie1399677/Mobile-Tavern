import type {
  PromptConfig,
  PromptPresetPlanSource,
  RegexScript,
  SamplerPreset,
  SavedPresetBundle,
  UserSettings,
} from "../../types";
import type { RuntimeProfileRecord } from "../runtimeProfiles/contracts";
import {
  applyPresetCompositionToPromptConfig,
  applyPresetPromptConfig,
  createPromptPresetPlan,
  resolvePromptPresetPlan,
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
): SavedPresetBundle {
  return {
    id: identity.id,
    ...(identity.isBuiltin ? { isBuiltin: true } : {}),
    preset: { ...selection.preset },
    promptConfig: toPresetPromptConfig(selection.promptConfig),
    promptPlan: createPromptPresetPlan(selection.promptConfig, identity.planSource ?? "native"),
    presetRegexScripts: [...(selection.presetRegexScripts ?? [])],
  };
}

/**
 * 判断当前设置与预设快照是否一致。
 *
 * 只比较预设明确拥有的字段：激活时未声明字段会回到运行时默认（不再继承当前预设），
 * 因此这些字段不计入脏状态，避免旧预设一加载就显示"未保存"。
 */
export function isPresetBundleInSync(
  bundle: SavedPresetBundle,
  selection: PresetBundleSelection,
  presetDefaults?: SamplerPreset,
): boolean {
  const plan = resolvePromptPresetPlan(bundle);
  const liveMode = selection.promptConfig.usePromptComposition ? "composition" : "legacy";
  if (liveMode !== plan.mode) return false;
  if (liveMode === "composition" && !isDeepEqual(selection.promptConfig.composition, plan.composition)) {
    return false;
  }

  const livePromptConfig = toPresetPromptConfig(selection.promptConfig) as unknown as Record<string, unknown>;
  if (!hasOwnedKeysEqual(livePromptConfig, bundle.promptConfig as unknown as Record<string, unknown>)) {
    return false;
  }

  const livePreset = presetDefaults ? { ...presetDefaults, ...selection.preset } : selection.preset;
  const storedPreset = presetDefaults ? { ...presetDefaults, ...bundle.preset } : bundle.preset;
  if (!hasOwnedKeysEqual(
    livePreset as unknown as Record<string, unknown>,
    storedPreset as unknown as Record<string, unknown>,
  )) {
    return false;
  }

  return isDeepEqual(selection.presetRegexScripts ?? [], bundle.presetRegexScripts ?? []);
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
  return stableSerialize(left) === stableSerialize(right);
}

/** 键序无关且忽略 undefined 的稳定序列化，用于快照比对。 */
function stableSerialize(value: unknown): string {
  return JSON.stringify(normalizeForCompare(value));
}

function normalizeForCompare(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForCompare);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item === undefined) continue;
      normalized[key] = normalizeForCompare(item);
    }
    return normalized;
  }
  return value;
}
