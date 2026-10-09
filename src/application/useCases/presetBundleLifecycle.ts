import type {
  PromptConfig,
  RegexScript,
  SamplerPreset,
  UserSettings,
} from "../../types";
import { PRESET_BUNDLE_SCHEMA_VERSION, type PresetBundle } from "../../domain/presets/contracts";
import type { RuntimeProfileRecord } from "../runtimeProfiles/contracts";
import {
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

/** 当前设置中属于预设包的字段。 */
export type PresetBundleSelection = Pick<
  UserSettings,
  "preset" | "promptConfig" | "presetRegexScripts"
>;

export interface PresetBundleIdentity {
  id: string;
  isBuiltin?: boolean;
}

export interface PresetBundleReferenceSummary {
  count: number;
  profileNames: string[];
}

/**
 * 权威定位活跃预设包。
 * 1. 优先按 sampler.id 匹配（标准运行形态）
 * 2. 其次按 bundle.id 匹配（防 ID 错位）
 * 3. 再次按名称匹配（兼容采样参数被赋予 "custom" 或历史脏数据）
 * 4. 兜底回落至首个预设
 */
export function resolveActivePresetBundle(
  savedPresets: readonly PresetBundle[] | undefined,
  preset: Pick<SamplerPreset, "id" | "name"> | undefined,
): PresetBundle | undefined {
  if (!savedPresets || savedPresets.length === 0) return undefined;
  if (!preset) return savedPresets[0];

  return (
    savedPresets.find((b) => b.sampler.id === preset.id) ??
    savedPresets.find((b) => b.id === preset.id) ??
    savedPresets.find((b) => b.sampler.name === preset.name) ??
    savedPresets[0]
  );
}

/** 用当前设置生成可持久化的预设快照（与切换时的激活规则保持镜像关系）。 */
export function buildPresetBundleSnapshot(
  selection: PresetBundleSelection,
  identity: PresetBundleIdentity,
): PresetBundle {
  return {
    schemaVersion: PRESET_BUNDLE_SCHEMA_VERSION,
    id: identity.id,
    ...(identity.isBuiltin ? { isBuiltin: true } : {}),
    sampler: { ...selection.preset },
    promptConfig: toPresetPromptConfig(selection.promptConfig),
    regexScripts: [...(selection.presetRegexScripts ?? [])],
  };
}

/**
 * 预设未声明时必须按运行期默认解读的 Prompt 开关（未声明即启用）。
 *
 * `PromptService` 用 `!== false` 判定主提示词与规则提示词（见 `sillytavern_compat.md` 第 4 节），
 * 因此这两个字段"预设未声明"在请求里的实际取值是启用。脏检查必须同口径，否则
 * "用户改了、但预设表达不了该字段"会被判成已同步：界面不给未保存标记、保存按钮不可点，
 * 切换预设时改动被静默还原。
 */
const PROMPT_FLAGS_DEFAULT_ON: readonly string[] = ["useMainPrompt", "useJailbreak"];

/**
 * 判断当前设置与预设快照是否一致。
 *
 * 只比较预设明确拥有的字段：激活时未声明字段会回到运行时默认（不再继承当前预设），
 * 因此这些字段不计入脏状态，避免旧预设一加载就显示"未保存"。唯一的例外是
 * `PROMPT_FLAGS_DEFAULT_ON`：它们"未声明即启用"有明确的运行期语义，两侧都按同一口径折算。
 */
export function isPresetBundleInSync(
  bundle: PresetBundle,
  selection: PresetBundleSelection,
  presetDefaults?: SamplerPreset,
): boolean {
  const livePromptConfig = toPresetPromptConfig(selection.promptConfig) as unknown as Record<string, unknown>;
  const storedPromptConfig = (bundle.promptConfig ?? {}) as unknown as Record<string, unknown>;
  if (!hasOwnedKeysEqual(livePromptConfig, storedPromptConfig)) {
    return false;
  }
  if (!areDefaultOnPromptFlagsEqual(livePromptConfig, storedPromptConfig)) {
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

/** 未声明即启用的开关比较：两侧都按 `!== false` 折算，与请求组装保持同一口径。 */
function areDefaultOnPromptFlagsEqual(
  live: Record<string, unknown>,
  stored: Record<string, unknown>,
): boolean {
  return PROMPT_FLAGS_DEFAULT_ON.every(
    (key) => (live[key] !== false) === (stored[key] !== false),
  );
}

function isDeepEqual(left: unknown, right: unknown): boolean {
  return stableSerializePresetSnapshot(left) === stableSerializePresetSnapshot(right);
}
