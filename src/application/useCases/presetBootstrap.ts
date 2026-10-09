import type {
  MemoryConfig,
  PromptConfig,
} from "../../types";
import type { PresetBundle } from "../../domain/presets/contracts";
import { ensureUniquePromptBlockIds } from "../../domain/prompts/promptBlockIdentity";
import { stableSerializePresetSnapshot, toPresetPromptConfig } from "./presetPromptConfig";

/**
 * 启动期预设引导用例。
 *
 * 原先这些职责散落在 `useSettingsLoader` 的 420 行 useEffect 里：外部静态文件的收口、
 * 自带预设初始化、旧键迁移，以及活跃 Prompt 配置的最终形状。它们混在 Hook 中既无法测试，
 * 也让"错了就静默改用户提示词"成为可能。
 *
 * 边界：
 * - 只处理预设拥有的数据：`saved_presets_bundle` 列表与活跃 Prompt 配置。
 *   人设、API、记忆、主题、世界书等非预设字段仍由调用方合并。
 * - 无 IO、无 React、不读环境；外部文件的 `fetch` 由组合根负责，本用例只消费收口结果。
 * - 不再有任何出厂内容迁移或字符串启发式：所有预设（含出厂自带预设）一律原样保留
 *   （`COMPAT-DATA`），启动引导只做形状归一化。
 */

/**
 * 出厂内容修订标记。
 *
 * 历史上用于"内置预设出厂内容一次性覆盖"；该迁移已按要求移除（所有预设一律原样保留）。
 * 现在只承担一件事：标记落后的旧数据在启动时归一化写回一次，之后不再重复写库。
 */
export const CURRENT_PRESET_FACTORY_REVISION = 2;

/** 旧版本注入的遗留预设 id，启动时必须清除。 */
export const LEGACY_FORMAT_PRESET_ID = "bundle_format_preservation";

/**
 * `/default_presets.json` 的收口结果。
 *
 * M1 保持与旧实现一致的宽松合并（未知键随展开透传）；字段级 Zod 校验与未知键丢弃
 * 属于后续预设实体 v2 的收口范围。
 */
export interface ExternalPresetDefaults {
  promptConfig?: Partial<PromptConfig> | undefined;
  /** 该字段不属于预设；由调用方合并到记忆设置。 */
  memory?: Partial<MemoryConfig> | undefined;
  basicPresetBundlePromptConfig?: Partial<PromptConfig> | undefined;
}

/** 出厂常量；由组合根注入，避免 application 反向依赖 hooks 下的默认值。 */
export interface PresetBootstrapFactoryDefaults {
  /** `DEFAULT_PROMPT_CONFIG`：存在外部静态文件时的 Prompt 基底。 */
  promptConfig: PromptConfig;
  /** `DEFAULT_SETTINGS.promptConfig`：全新安装时的 Prompt 基底（含编排开关默认值）。 */
  settingsPromptConfig: PromptConfig;
  /** `DEFAULT_TABLE_MEMORY_PROMPT`：内置预设的记忆表提示词自愈内容。 */
  tableMemoryPrompt: string;
}

/** 用例需要读取的设置字段；`UserSettings` 天然满足。 */
export interface PresetBootstrapStoredSettings {
  preset?: { id?: string } | undefined;
  promptConfig?: PromptConfig | undefined;
  savedPresets?: PresetBundle[] | undefined;
  /** 出厂内容修订标记；缺失表示旧数据，需要一次兜底识别。 */
  presetFactoryRevision?: number | undefined;
}

export interface PresetBootstrapInput {
  /** 已存储的设置主记录；`null` 表示全新安装。 */
  storedSettings: PresetBootstrapStoredSettings | null;
  /** `saved_presets_bundle` 中的列表；`null` 表示该键尚不存在（旧数据）。 */
  storedPresets: PresetBundle[] | null;
  /** 外部静态文件收口结果；`null` 表示未触发拉取或拉取失败。 */
  externalDefaults: ExternalPresetDefaults | null;
  /** 编译期内置预设（未被外部文件覆盖）。 */
  compiledBuiltin: PresetBundle;
  factory: PresetBootstrapFactoryDefaults;
}

export type PresetBootstrapDiagnosticCode =
  | "external-defaults-applied"
  | "legacy-saved-presets-key-migrated"
  | "legacy-format-preset-removed"
  | "builtin-preset-rebuilt";

export interface PresetBootstrapDiagnostic {
  code: PresetBootstrapDiagnosticCode;
  detail?: string;
}

export interface PresetBootstrapResult {
  /** 生效的内置预设（已合并外部文件的 `basicPresetBundle.promptConfig`）。 */
  builtin: PresetBundle;
  /** 写入 `UserSettings.savedPresets` 的权威列表。 */
  savedPresets: PresetBundle[];
  /** 写入 `UserSettings.promptConfig` 的活跃 Prompt 配置。 */
  promptConfig: PromptConfig;
  /** 需要写回 `saved_presets_bundle`。 */
  presetsDirty: boolean;
  /** 需要写回设置主记录（不含 `savedPresets`）。 */
  settingsDirty: boolean;
  /** 写回设置主记录的出厂内容修订标记。 */
  presetFactoryRevision: number;
  diagnostics: readonly PresetBootstrapDiagnostic[];
}

export interface ResolvedBuiltinPreset {
  bundle: PresetBundle;
  /** 是否应用了外部静态文件的 `basicPresetBundle.promptConfig`。 */
  externalPromptConfigApplied: boolean;
}

/** 把 `/default_presets.json` 的原始 JSON 收口为类型化对象；非对象一律视为无效。 */
export function readExternalPresetDefaults(raw: unknown): ExternalPresetDefaults | null {
  if (!isRecord(raw)) return null;
  const basicPresetBundle = isRecord(raw.basicPresetBundle) ? raw.basicPresetBundle : undefined;
  return {
    promptConfig: readConfigPatch(raw.promptConfig),
    memory: readConfigPatch<MemoryConfig>(raw.memory),
    basicPresetBundlePromptConfig: readConfigPatch(basicPresetBundle?.promptConfig),
  };
}

/** 自带预设重建：外部静态文件只允许覆盖传统 Prompt 字段。 */
export function resolveBuiltinPreset(
  compiledBuiltin: PresetBundle,
  externalDefaults: ExternalPresetDefaults | null,
): ResolvedBuiltinPreset {
  const patch = externalDefaults?.basicPresetBundlePromptConfig;
  if (!patch) return { bundle: compiledBuiltin, externalPromptConfigApplied: false };
  return {
    bundle: {
      ...compiledBuiltin,
      // 外部静态文件只修补自带预设的传统 Prompt 字段；`prompt` 快照是 v2 的唯一权威，
      // 不允许被外部文件间接改写（与 v1 时代 `toPresetPromptConfig` 会剥掉编排字段一致）。
      promptConfig: toPresetPromptConfig({
        ...(compiledBuiltin.promptConfig ?? {}),
        ...patch,
      } as PromptConfig),
    },
    externalPromptConfigApplied: true,
  };
}

/**
 * 计算启动期的预设引导结果。
 *
 * 数据结果是权威的：`savedPresets` / `promptConfig` 直接写入设置状态。脏标记只用于
 * 判断是否需要落库，因此第二次启动必须是"无写入"（幂等）。
 */
export function resolvePresetBootstrap(input: PresetBootstrapInput): PresetBootstrapResult {
  const diagnostics: PresetBootstrapDiagnostic[] = [];
  const report = (code: PresetBootstrapDiagnosticCode, detail?: string): void => {
    diagnostics.push(detail === undefined ? { code } : { code, detail });
  };

  const resolvedBuiltin = resolveBuiltinPreset(input.compiledBuiltin, input.externalDefaults);
  if (resolvedBuiltin.externalPromptConfigApplied) {
    report("external-defaults-applied", "basicPresetBundle.promptConfig");
  }

  if (input.storedSettings === null) {
    return resolveFreshInstall(input, resolvedBuiltin.bundle, diagnostics, report);
  }
  return resolveStoredSettings(input, resolvedBuiltin.bundle, diagnostics, report);
}

/** 全新安装：直接以出厂常量 + 外部静态文件建立第一份预设列表与活跃 Prompt。 */
function resolveFreshInstall(
  input: PresetBootstrapInput,
  builtin: PresetBundle,
  diagnostics: PresetBootstrapDiagnostic[],
  report: (code: PresetBootstrapDiagnosticCode, detail?: string) => void,
): PresetBootstrapResult {
  const external = input.externalDefaults;
  const promptConfig = external
    ? ({
        ...input.factory.settingsPromptConfig,
        ...(external.promptConfig ?? {}),
        ...(external.basicPresetBundlePromptConfig ? (builtin.promptConfig ?? {}) : {}),
      } as PromptConfig)
    : input.factory.settingsPromptConfig;

  if (external) report("external-defaults-applied", "promptConfig");

  return {
    builtin,
    savedPresets: [builtin],
    promptConfig,
    // 首次运行必须落库：设置主记录与 saved_presets_bundle 都还没有内容。
    presetsDirty: true,
    settingsDirty: true,
    presetFactoryRevision: CURRENT_PRESET_FACTORY_REVISION,
    diagnostics,
  };
}

/** 已存在设置记录：旧键迁移、自带预设初始化与活跃 Prompt 的最终形状。 */
function resolveStoredSettings(
  input: PresetBootstrapInput,
  builtin: PresetBundle,
  diagnostics: PresetBootstrapDiagnostic[],
  report: (code: PresetBootstrapDiagnosticCode, detail?: string) => void,
): PresetBootstrapResult {
  const stored = input.storedSettings as PresetBootstrapStoredSettings;
  const builtinEntry = builtin;
  const builtinBundleId = builtinEntry.id;
  const hasCurrentFactoryRevision = stored.presetFactoryRevision === CURRENT_PRESET_FACTORY_REVISION;
  const factoryRevisionStale = !hasCurrentFactoryRevision;
  if (input.externalDefaults) report("external-defaults-applied", "promptConfig");

  // ── 预设列表 ────────────────────────────────────────────────────────────────
  const storedList: PresetBundle[] = input.storedPresets ?? stored.savedPresets ?? [];
  let presetsDirty = false;

  // 旧键迁移：saved_presets_bundle 尚未建立时，从设置主记录的 savedPresets 继承。
  if (!input.storedPresets && stored.savedPresets && stored.savedPresets.length > 0) {
    presetsDirty = true;
    report("legacy-saved-presets-key-migrated", `count=${stored.savedPresets.length}`);
  }

  // v2 实体的 `regexScripts` 由领域迁移保证是数组（缺失即补空），此处不再重复归一化。
  let list = storedList;

  const withoutLegacyEntry = list.filter((bundle) => bundle.id !== LEGACY_FORMAT_PRESET_ID);
  if (withoutLegacyEntry.length !== list.length) {
    report("legacy-format-preset-removed", LEGACY_FORMAT_PRESET_ID);
    list = withoutLegacyEntry;
  }

  // 默认预设完全降级为普通预设：和导入预设唯一的区别只是出厂时"自带"（仅在列表为空时初始化塞入）。
  // 绝不能在启动时强行覆盖用户的修改，也不能在用户删除后重新加回。
  const rebuiltPresets = list.length === 0 ? [builtinEntry] : list;
  if (!isSamePresetList(rebuiltPresets, storedList)) {
    report("builtin-preset-rebuilt", builtinBundleId);
    presetsDirty = true;
  }

  // ── 活跃 Prompt 配置 ────────────────────────────────────────────────────────
  const storedPromptConfig = stored.promptConfig;
  const working: Partial<PromptConfig> = { ...(storedPromptConfig ?? {}) };

  const defaultPromptConfig: Partial<PromptConfig> = input.externalDefaults
    ? { ...input.factory.promptConfig, ...(input.externalDefaults.promptConfig ?? {}) }
    : (builtinEntry.promptConfig ?? {});

  const promptConfig = {
    ...defaultPromptConfig,
    ...working,
    mainPrompt: working.mainPrompt ?? "",
    useMainPrompt: working.useMainPrompt ?? Boolean(working.mainPrompt && working.mainPrompt.trim().length > 0),
    // 身份归一：重复 identifier 的条目必须各自可寻址，否则改名/开关/删除会互相牵连。
    customPrompts: ensureUniquePromptBlockIds(working.customPrompts ?? []),
    sectionHeaders: {
      ...defaultPromptConfig.sectionHeaders,
      ...(working.sectionHeaders ?? {}),
    },
  } as PromptConfig;

  const promptConfigChanged = !isSameJson(promptConfig, storedPromptConfig ?? null);

  return {
    builtin: builtinEntry,
    savedPresets: rebuiltPresets,
    promptConfig,
    presetsDirty,
    // 设置主记录与预设键一起落库；外部静态文件一旦生效也按旧行为归一化一次；
    // 出厂修订标记落后时同样需要写回，避免每次启动都重复识别旧出厂内容。
    settingsDirty: presetsDirty || promptConfigChanged || input.externalDefaults !== null || factoryRevisionStale,
    presetFactoryRevision: CURRENT_PRESET_FACTORY_REVISION,
    diagnostics,
  };
}

function isSamePresetList(left: readonly PresetBundle[], right: readonly PresetBundle[]): boolean {
  return isSameJson(left, right);
}

function isSameJson(left: unknown, right: unknown): boolean {
  return stableSerializePresetSnapshot(left) === stableSerializePresetSnapshot(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 读取一个宽松的配置补丁。
 *
 * 返回值在写入前会与出厂基底合并，未知键随展开透传（与旧实现的 `any` 行为一致）；
 * 字段级校验由后续预设实体 v2 的 schema 承担。
 */
function readConfigPatch<T>(value: unknown): Partial<T> | undefined {
  return isRecord(value) ? (value as Partial<T>) : undefined;
}
