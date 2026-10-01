import type {
  MemoryConfig,
  PromptConfig,
} from "../../types";
import type { PresetBundleV2 } from "../../domain/presets/contracts";
import { isBuiltinPresetActive, resolvePresetPromptMigration } from "./presetRuntimeMigration";
import { stableSerializePresetSnapshot, toPresetPromptConfig } from "./presetPromptConfig";

/**
 * 启动期预设引导用例。
 *
 * 原先这些职责散落在 `useSettingsLoader` 的 420 行 useEffect 里：外部静态文件的收口、
 * 内置预设重建、旧键迁移、旧出厂提示词升级、出厂区块迁移，以及活跃 Prompt 配置的最终
 * 形状。它们混在 Hook 中既无法测试，也让"错了就静默改用户提示词"成为可能。
 *
 * 边界：
 * - 只处理预设拥有的数据：`saved_presets_bundle` 列表与活跃 Prompt 配置。
 *   人设、API、记忆、主题、世界书等非预设字段仍由调用方合并。
 * - 无 IO、无 React、不读环境；外部文件的 `fetch` 由组合根负责，本用例只消费收口结果。
 * - 出厂内容迁移只作用于内置预设（`COMPAT-DATA`）；自定义与导入预设必须原样保留。
 */

/**
 * 出厂内容修订标记。
 *
 * 内置预设的提示词内容变化需要一次性覆盖到用户设置时，递增本标记；启动引导据此判断
 * 是否需要识别"旧出厂内容"。这取代了"每次启动都按文本特征扫描"的做法（`CHANGE-SAFE`）：
 * 标记已是当前值时，引导不再按字符串改写任何用户可见提示词。
 */
export const CURRENT_PRESET_FACTORY_REVISION = 2;

/** 旧版本注入的遗留预设 id，启动时必须清除。 */
export const LEGACY_FORMAT_PRESET_ID = "bundle_format_preservation";

/**
 * 判定"旧出厂主提示词"的特征串；命中即整块升级为当前内置内容。
 *
 * 这是对历史出厂文案的一次性识别，不是行为引导注入：只在内置预设生效时使用，
 * 第三方预设即便包含相同文本也不会被改写。
 */
export const LEGACY_DEFAULT_PROMPT_PATTERNS: readonly string[] = [
  "[NARRATIVE ENGINE:",
  "[系统核心任务：",
  "叙事共鸣沙盒",
];

/** 状态与结构化记忆引擎提示词的特征串；命中即视为已迁移内容。 */
export const TABLE_MEMORY_PROMPT_MARKER = "【状态与结构化记忆引擎】";

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
  savedPresets?: PresetBundleV2[] | undefined;
  /** 出厂内容修订标记；缺失表示旧数据，需要一次兜底识别。 */
  presetFactoryRevision?: number | undefined;
}

export interface PresetBootstrapInput {
  /** 已存储的设置主记录；`null` 表示全新安装。 */
  storedSettings: PresetBootstrapStoredSettings | null;
  /** `saved_presets_bundle` 中的列表；`null` 表示该键尚不存在（旧数据）。 */
  storedPresets: PresetBundleV2[] | null;
  /** 外部静态文件收口结果；`null` 表示未触发拉取或拉取失败。 */
  externalDefaults: ExternalPresetDefaults | null;
  /** 编译期内置预设（未被外部文件覆盖）。 */
  compiledBuiltin: PresetBundleV2;
  factory: PresetBootstrapFactoryDefaults;
}

export type PresetBootstrapDiagnosticCode =
  | "external-defaults-applied"
  | "legacy-saved-presets-key-migrated"
  | "legacy-format-preset-removed"
  | "builtin-preset-rebuilt"
  | "legacy-default-prompt-upgraded"
  | "factory-prompt-migration-applied"
  | "table-memory-prompt-repaired";

export interface PresetBootstrapDiagnostic {
  code: PresetBootstrapDiagnosticCode;
  detail?: string;
}

export interface PresetBootstrapResult {
  /** 生效的内置预设（已合并外部文件的 `basicPresetBundle.promptConfig`）。 */
  builtin: PresetBundleV2;
  /** 写入 `UserSettings.savedPresets` 的权威列表。 */
  savedPresets: PresetBundleV2[];
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
  bundle: PresetBundleV2;
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

/** 内置预设重建：外部静态文件只允许覆盖内置预设的 Prompt 字段。 */
export function resolveBuiltinPreset(
  compiledBuiltin: PresetBundleV2,
  externalDefaults: ExternalPresetDefaults | null,
): ResolvedBuiltinPreset {
  const patch = externalDefaults?.basicPresetBundlePromptConfig;
  if (!patch) return { bundle: compiledBuiltin, externalPromptConfigApplied: false };
  return {
    bundle: {
      ...compiledBuiltin,
      // 外部静态文件只修补内置预设的传统 Prompt 字段；`prompt` 快照是 v2 的唯一权威，
      // 不允许被外部文件间接改写（与 v1 时代 `toPresetPromptConfig` 会剥掉编排字段一致）。
      legacyPromptConfig: toPresetPromptConfig({
        ...(compiledBuiltin.legacyPromptConfig ?? {}),
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
  builtin: PresetBundleV2,
  diagnostics: PresetBootstrapDiagnostic[],
  report: (code: PresetBootstrapDiagnosticCode, detail?: string) => void,
): PresetBootstrapResult {
  const external = input.externalDefaults;
  const promptConfig = external
    ? ({
        ...input.factory.settingsPromptConfig,
        ...(external.promptConfig ?? {}),
        ...(external.basicPresetBundlePromptConfig ? (builtin.legacyPromptConfig ?? {}) : {}),
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

/** 已存在设置记录：旧键迁移、内置预设重建、出厂内容迁移与活跃 Prompt 的最终形状。 */
function resolveStoredSettings(
  input: PresetBootstrapInput,
  builtin: PresetBundleV2,
  diagnostics: PresetBootstrapDiagnostic[],
  report: (code: PresetBootstrapDiagnosticCode, detail?: string) => void,
): PresetBootstrapResult {
  const stored = input.storedSettings as PresetBootstrapStoredSettings;
  const builtinEntry = builtin;
  // 两个 id 不可混用：列表重建比对的是预设包 id，出厂迁移判定的是包内采样子预设 id。
  const builtinBundleId = builtinEntry.id;
  const builtinPresetId = builtinEntry.sampler.id;
  const activePresetId = stored.preset?.id;
  const isBuiltinActive = isBuiltinPresetActive(activePresetId, builtinPresetId);
  const hasCurrentFactoryRevision = stored.presetFactoryRevision === CURRENT_PRESET_FACTORY_REVISION;
  const factoryRevisionStale = !hasCurrentFactoryRevision;
  if (input.externalDefaults) report("external-defaults-applied", "promptConfig");

  // ── 预设列表 ────────────────────────────────────────────────────────────────
  const storedList: PresetBundleV2[] = input.storedPresets ?? stored.savedPresets ?? [];
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

  // 内置预设始终以出厂内容重建：既不保留数据库里的旧副本，也不覆盖自定义预设。
  const customPresets = list.filter((bundle) => bundle.id !== builtinBundleId);
  const rebuiltPresets = [...customPresets, builtinEntry];
  if (!isSamePresetList(rebuiltPresets, storedList)) {
    report("builtin-preset-rebuilt", builtinBundleId);
    presetsDirty = true;
  }

  // ── 活跃 Prompt 配置 ────────────────────────────────────────────────────────
  const storedPromptConfig = stored.promptConfig;
  const working: Partial<PromptConfig> = { ...(storedPromptConfig ?? {}) };

  if (isBuiltinActive && !hasCurrentFactoryRevision) {
    // 只有在缺少当前出厂修订标记时才做一次性识别：字符串匹配是历史数据的兜底手段，
    // 一旦盖上标记就不再按文本判断，避免覆盖用户手写内容、也避免每次启动都扫描提示词。
    const matchedPattern = LEGACY_DEFAULT_PROMPT_PATTERNS.find(
      (pattern) => typeof working.mainPrompt === "string" && working.mainPrompt.includes(pattern),
    );
    if (matchedPattern) {
      working.mainPrompt = builtinEntry.legacyPromptConfig?.mainPrompt;
      working.jailbreakPrompt = builtinEntry.legacyPromptConfig?.jailbreakPrompt;
      working.storyString = builtinEntry.legacyPromptConfig?.storyString;
      working.customPrompts = builtinEntry.legacyPromptConfig?.customPrompts;
      delete working.postHistoryPrompt;
      delete working.usePostHistory;
      delete working.enableReasoningGuidance;
      delete working.reasoningGuidancePrompt;
      report("legacy-default-prompt-upgraded", matchedPattern);
    }
  }

  // 出厂内容迁移同样只对内置预设生效：非内置预设原样返回。
  const promptMigration = resolvePresetPromptMigration({
    prompts: working.customPrompts ?? [],
    defaultPrompts: builtinEntry.legacyPromptConfig?.customPrompts ?? [],
    activePresetId,
    builtinPresetId,
  });
  if (promptMigration.updated) {
    report("factory-prompt-migration-applied", `count=${promptMigration.prompts.length}`);
  }

  const defaultPromptConfig: Partial<PromptConfig> = input.externalDefaults
    ? { ...input.factory.promptConfig, ...(input.externalDefaults.promptConfig ?? {}) }
    : (builtinEntry.legacyPromptConfig ?? {});

  const builtinBackfill: Partial<PromptConfig> = {};
  if (isBuiltinActive) {
    builtinBackfill.mainPrompt = working.mainPrompt || defaultPromptConfig.mainPrompt;
    builtinBackfill.postHistoryPrompt = working.postHistoryPrompt || defaultPromptConfig.postHistoryPrompt;
    builtinBackfill.reasoningGuidancePrompt =
      working.reasoningGuidancePrompt || defaultPromptConfig.reasoningGuidancePrompt;

    const storedTableMemoryPrompt = working.tableMemoryPrompt;
    if (!storedTableMemoryPrompt || !storedTableMemoryPrompt.includes(TABLE_MEMORY_PROMPT_MARKER)) {
      builtinBackfill.tableMemoryPrompt = input.factory.tableMemoryPrompt;
      report("table-memory-prompt-repaired");
    } else {
      builtinBackfill.tableMemoryPrompt = storedTableMemoryPrompt;
    }
  }

  const promptConfig = {
    ...defaultPromptConfig,
    ...working,
    ...(!isBuiltinActive ? {
      mainPrompt: working.mainPrompt ?? "",
      useMainPrompt: working.useMainPrompt ?? Boolean(working.mainPrompt && working.mainPrompt.trim().length > 0),
    } : {}),
    ...(isBuiltinActive ? builtinBackfill : {}),
    customPrompts: promptMigration.prompts,
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

function isSamePresetList(left: readonly PresetBundleV2[], right: readonly PresetBundleV2[]): boolean {
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
