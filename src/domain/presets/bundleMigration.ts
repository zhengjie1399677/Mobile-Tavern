import type { ZodError } from "zod";
import type { RegexScript } from "../../types";
import {
  PRESET_BUNDLE_SCHEMA_VERSION,
  PRESET_ID_MAX_LENGTH,
  presetBundleSchema,
  presetRegexScriptSchema,
  presetSamplerSchema,
  type PresetBundle,
  type PresetSampler,
} from "./contracts";

/**
 * 预设实体 v1/v2 → v3 读取迁移。
 *
 * 存储边界必须"能读就不能失效"：v1 记录、被改坏的记录、含未知字段的记录都要能读出来，
 * 并且**不得静默丢数据**（`CHANGE-SAFE`）。因此这里的策略是
 * 「构造候选 → 用实体 schema 校验 → 逐级降级修复 → 记录诊断」，而不是直接 `parse` 抛错。
 * 只有导入边界才允许 fail-closed，那由导入用例负责。
 *
 * v3 只保留传统 `promptConfig` 这一个 Prompt 权威：v1 的 `promptPlan`/`composition`/
 * `usePromptComposition` 与 v2 的 `prompt` 编排快照在迁移时**整体丢弃**（编排路径已删除）。
 */

export type PresetBundleDiagnosticCode =
  | "preset.bundle.v1-migrated"
  | "preset.bundle.v2-migrated"
  | "preset.bundle.repaired"
  | "preset.bundle.invalid-record"
  | "preset.bundle.regex-script-dropped"
  | "preset.bundle.regex-script-fields-dropped"
  | "preset.bundle.unknown-keys-preserved";

export interface PresetBundleDiagnostic {
  code: PresetBundleDiagnosticCode;
  detail?: string;
}

export interface PresetBundleReadResult {
  bundle: PresetBundle;
  /** 记录由旧形态迁移或被修复，调用方应写回当前版本存储。 */
  migrated: boolean;
  diagnostics: readonly PresetBundleDiagnostic[];
}

export interface PresetBundleListReadResult {
  bundles: PresetBundle[];
  migrated: boolean;
  diagnostics: readonly PresetBundleDiagnostic[];
}

/** v1 记录中被 v3 识别的键；v1 的编排字段按"不保留"处理。 */
const V1_KNOWN_KEYS: readonly string[] = [
  "id",
  "isBuiltin",
  "preset",
  "promptConfig",
  "presetRegexScripts",
  "promptPlan",
  "composition",
  "usePromptComposition",
];

/** v2 记录中被 v3 识别的键；`prompt`／`legacyPromptConfig` 里的传统字段会被读出后降级。 */
const V2_KNOWN_KEYS: readonly string[] = [
  "schemaVersion",
  "id",
  "isBuiltin",
  "sampler",
  "prompt",
  "regexScripts",
  "promptConfig",
  "legacyPromptConfig",
  "extensions",
];

const SAMPLER_NUMERIC_KEYS = [
  "temperature",
  "topP",
  "topK",
  "repetitionPenalty",
  "frequencyPenalty",
  "presencePenalty",
  "minP",
  "maxTokens",
] as const;

/** 正则脚本实体可识别的字段；与导入边界（`preparePresetBundleImport`）同口径。 */
const REGEX_SCRIPT_FIELDS: readonly string[] = [
  "id",
  "scriptName",
  "findRegex",
  "replaceString",
  "disabled",
  "placement",
  "runOnEdit",
  "markdownOnly",
  "promptOnly",
  "substituteRegex",
  "minDepth",
  "maxDepth",
  "trimStrings",
];

const REGEX_SCRIPT_OPTIONAL_BOOLEAN_KEYS = ["runOnEdit", "markdownOnly", "promptOnly"] as const;
const REGEX_SCRIPT_OPTIONAL_DEPTH_KEYS = ["minDepth", "maxDepth"] as const;

/** 读取单条预设记录；无法作为预设识别的记录返回 null。 */
export function readPresetBundle(raw: unknown): PresetBundleReadResult | null {
  if (!isRecord(raw)) return null;
  // 标识不符合实体契约（缺失/空串/超长）的记录没有可用身份，按不可识别丢弃并留诊断。
  // 绝不能带进实体校验再让 `parse` 抛错——那会让整份列表读取失效（`CHANGE-SAFE`）。
  const id = readBundleId(raw.id);
  if (id === undefined) return null;

  if (raw.schemaVersion === PRESET_BUNDLE_SCHEMA_VERSION) return readCurrentRecord(raw, id);
  if (raw.schemaVersion === 2) return readV2Record(raw, id);
  return readV1Record(raw, id);
}

/**
 * 严格迁移：把确定可用的记录（编译期内置预设常量、测试夹具）转换为当前版本；不可用时抛错。
 *
 * 存储边界请用 `readPresetBundle`（可失效优先），本入口只用于"必须成功"的调用点。
 */
export function requirePresetBundle(raw: unknown): PresetBundle {
  const read = readPresetBundle(raw);
  if (read === null) throw new Error("preset.bundle.invalid-record: 记录无法识别为预设");
  return read.bundle;
}

/** 读取预设列表；非记录与缺少 id 的条目会被丢弃并留下诊断。 */
export function readPresetBundleList(raw: unknown): PresetBundleListReadResult {
  if (!Array.isArray(raw)) {
    return { bundles: [], migrated: false, diagnostics: [{ code: "preset.bundle.invalid-record", detail: "不是数组" }] };
  }
  const bundles: PresetBundle[] = [];
  const diagnostics: PresetBundleDiagnostic[] = [];
  let migrated = false;

  for (const entry of raw) {
    let result: PresetBundleReadResult | null;
    try {
      result = readPresetBundle(entry);
    } catch (error: unknown) {
      // 读取边界最后一道保险：未预期异常只影响这一条记录，不得让整份列表失效。
      diagnostics.push({
        code: "preset.bundle.invalid-record",
        detail: `${describeRecord(entry)}:${describeError(error)}`,
      });
      continue;
    }
    if (result === null) {
      diagnostics.push({ code: "preset.bundle.invalid-record", detail: describeRecord(entry) });
      continue;
    }
    bundles.push(result.bundle);
    diagnostics.push(...result.diagnostics);
    migrated = migrated || result.migrated;
  }
  return { bundles, migrated, diagnostics };
}

function readCurrentRecord(raw: Record<string, unknown>, id: string): PresetBundleReadResult | null {
  const parsed = presetBundleSchema.safeParse(raw);
  if (parsed.success) {
    return { bundle: parsed.data, migrated: false, diagnostics: [] };
  }
  // 当前版本记录被改坏：按同样的修复路径重建，并保留未知字段与诊断。
  const repaired = buildBundle({
    id,
    isBuiltin: raw.isBuiltin === true,
    samplerSource: raw.sampler,
    regexScriptsSource: raw.regexScripts,
    promptConfig: isRecord(raw.promptConfig) ? raw.promptConfig : undefined,
    preserveFrom: raw,
    knownKeys: V2_KNOWN_KEYS,
  });
  if (repaired.bundle === null) return null;
  return {
    bundle: repaired.bundle,
    migrated: true,
    diagnostics: [
      { code: "preset.bundle.repaired", detail: describeIssues(parsed.error) },
      ...repaired.diagnostics,
    ],
  };
}

/** v2 → v3：丢弃 `prompt` 编排快照，只保留 `legacyPromptConfig` 里的传统 Prompt 字段。 */
function readV2Record(raw: Record<string, unknown>, id: string): PresetBundleReadResult | null {
  const traditionalSource = isRecord(raw.legacyPromptConfig)
    ? raw.legacyPromptConfig
    : isRecord(raw.promptConfig) ? raw.promptConfig : undefined;
  const repaired = buildBundle({
    id,
    isBuiltin: raw.isBuiltin === true,
    samplerSource: raw.sampler,
    regexScriptsSource: raw.regexScripts,
    promptConfig: traditionalSource,
    preserveFrom: raw,
    knownKeys: V2_KNOWN_KEYS,
  });
  if (repaired.bundle === null) return null;
  return {
    bundle: repaired.bundle,
    migrated: true,
    diagnostics: [{ code: "preset.bundle.v2-migrated" }, ...repaired.diagnostics],
  };
}

/** v1 → v3：只取传统字段，`promptPlan`／`composition` 一并丢弃。 */
function readV1Record(raw: Record<string, unknown>, id: string): PresetBundleReadResult | null {
  const repaired = buildBundle({
    id,
    isBuiltin: raw.isBuiltin === true,
    samplerSource: raw.preset,
    regexScriptsSource: raw.presetRegexScripts,
    promptConfig: isRecord(raw.promptConfig) ? raw.promptConfig : undefined,
    preserveFrom: raw,
    knownKeys: V1_KNOWN_KEYS,
  });
  if (repaired.bundle === null) return null;
  return {
    bundle: repaired.bundle,
    migrated: true,
    diagnostics: [{ code: "preset.bundle.v1-migrated" }, ...repaired.diagnostics],
  };
}

interface BuildBundleInput {
  id: string;
  isBuiltin: boolean;
  samplerSource: unknown;
  regexScriptsSource: unknown;
  promptConfig: Record<string, unknown> | undefined;
  preserveFrom: Record<string, unknown>;
  knownKeys: readonly string[];
}

interface BuildBundleResult {
  /** 无法构造出可读实体时为 null，调用方按"不可识别记录"丢弃。 */
  bundle: PresetBundle | null;
  diagnostics: PresetBundleDiagnostic[];
}

function buildBundle(input: BuildBundleInput): BuildBundleResult {
  const diagnostics: PresetBundleDiagnostic[] = [];
  const candidate: Record<string, unknown> = {
    schemaVersion: PRESET_BUNDLE_SCHEMA_VERSION,
    id: input.id,
    sampler: toSampler(input.samplerSource, input.id),
    promptConfig: input.promptConfig ?? {},
    regexScripts: toRegexScripts(input.regexScriptsSource, diagnostics),
  };
  if (input.isBuiltin) candidate.isBuiltin = true;

  const preserved = collectUnknownKeys(input.preserveFrom, input.knownKeys);
  if (preserved) {
    candidate.extensions = preserved;
    diagnostics.push({
      code: "preset.bundle.unknown-keys-preserved",
      detail: Object.keys(preserved).join(","),
    });
  }

  const parsed = presetBundleSchema.safeParse(candidate);
  if (parsed.success) return { bundle: parsed.data, diagnostics };

  // 最后一级降级：保留已逐条校验过的正则、可读的采样参数与 Prompt 字段。
  // 绝不因为某个无法解释的字段而整轨清空用户数据（`CHANGE-SAFE`）。
  diagnostics.push({ code: "preset.bundle.repaired", detail: "候选未通过校验，已降级记录" });
  const fallback: Record<string, unknown> = {
    schemaVersion: PRESET_BUNDLE_SCHEMA_VERSION,
    id: input.id,
    sampler: toSampler(input.samplerSource, input.id),
    promptConfig: input.promptConfig ?? {},
    regexScripts: candidate.regexScripts,
  };
  if (input.isBuiltin) fallback.isBuiltin = true;
  if (preserved) fallback.extensions = preserved;
  const fallbackParsed = presetBundleSchema.safeParse(fallback);
  if (fallbackParsed.success) return { bundle: fallbackParsed.data, diagnostics };

  // 理论上不可达：标识已在读取入口按实体契约校验。真到了这里说明契约被改坏，
  // 按"不可识别记录"丢弃并留诊断，仍然不抛错。
  diagnostics.push({
    code: "preset.bundle.invalid-record",
    detail: describeIssues(fallbackParsed.error),
  });
  return { bundle: null, diagnostics };
}

function toSampler(raw: unknown, fallbackId: string): PresetSampler {
  const record = isRecord(raw) ? raw : {};
  const id = readNonEmptyString(record.id) ?? fallbackId;
  const name = readString(record.name) ?? id;
  const candidate: Record<string, unknown> = { id, name };
  for (const key of SAMPLER_NUMERIC_KEYS) {
    const value = record[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    // 逐字段按实体 schema 校验：越界值单独丢弃，合法字段不陪葬（`CHANGE-SAFE`）。
    if (presetSamplerSchema.shape[key].safeParse(value).success) candidate[key] = value;
  }
  const parsed = presetSamplerSchema.safeParse(candidate);
  // 兜底：仅保留必然合法的身份字段，数值由运行期投影与出厂默认合并补齐。
  return parsed.success ? parsed.data : { id, name };
}

/**
 * 逐条收口正则脚本：白名单构造候选 → 单条实体校验。
 *
 * 旧实现把整条记录 `...entry` 展开后交给 `.strict()` 校验，任何一个未知键（例如编辑器
 * 曾经把 `scope` 一起写进对象）或类型不符的字段，都会让**整条轨道**在末级降级里被清空。
 * 现在未知字段只从这一条里剔除（留诊断），校验失败的条目单独丢弃，其余脚本原样保留。
 */
function toRegexScripts(raw: unknown, diagnostics: PresetBundleDiagnostic[]): RegexScript[] {
  if (!Array.isArray(raw)) return [];
  const scripts: RegexScript[] = [];
  raw.forEach((entry, index) => {
    if (!isRecord(entry)) {
      diagnostics.push({ code: "preset.bundle.regex-script-dropped", detail: `${index}:${describeRecord(entry)}` });
      return;
    }
    const unknownKeys = Object.keys(entry).filter((key) => !REGEX_SCRIPT_FIELDS.includes(key));
    if (unknownKeys.length > 0) {
      diagnostics.push({
        code: "preset.bundle.regex-script-fields-dropped",
        detail: `${index}:${unknownKeys.join(",")}`,
      });
    }

    const candidate: Record<string, unknown> = {
      id: readString(entry.id) ?? "",
      scriptName: readString(entry.scriptName) ?? "",
      findRegex: readString(entry.findRegex) ?? "",
      replaceString: readString(entry.replaceString) ?? "",
      disabled: entry.disabled === true,
      placement: Array.isArray(entry.placement)
        ? entry.placement.filter((item): item is number => typeof item === "number" && Number.isInteger(item))
        : [],
    };
    for (const key of REGEX_SCRIPT_OPTIONAL_BOOLEAN_KEYS) {
      if (typeof entry[key] === "boolean") candidate[key] = entry[key];
    }
    if (typeof entry.substituteRegex === "number" && Number.isInteger(entry.substituteRegex)) {
      candidate.substituteRegex = entry.substituteRegex;
    }
    for (const key of REGEX_SCRIPT_OPTIONAL_DEPTH_KEYS) {
      const value = entry[key];
      if (value === null) candidate[key] = null;
      else if (typeof value === "number" && Number.isInteger(value)) candidate[key] = value;
    }
    if (Array.isArray(entry.trimStrings) && entry.trimStrings.every((item) => typeof item === "string")) {
      candidate.trimStrings = entry.trimStrings;
    }

    const parsed = presetRegexScriptSchema.safeParse(candidate);
    if (!parsed.success) {
      diagnostics.push({ code: "preset.bundle.regex-script-dropped", detail: `${index}:${describeIssues(parsed.error)}` });
      return;
    }
    scripts.push(parsed.data);
  });
  return scripts;
}

function collectUnknownKeys(
  source: Record<string, unknown>,
  knownKeys: readonly string[],
): Record<string, unknown> | undefined {
  const preserved: Record<string, unknown> = {};
  let any = false;
  for (const [key, value] of Object.entries(source)) {
    if (knownKeys.includes(key)) continue;
    preserved[key] = value;
    any = true;
  }
  return any ? preserved : undefined;
}

/** 预设标识必须非空且不超过实体契约长度，否则该记录没有可用身份。 */
function readBundleId(value: unknown): string | undefined {
  const id = readNonEmptyString(value);
  if (id === undefined || id.length > PRESET_ID_MAX_LENGTH) return undefined;
  return id;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function describeRecord(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** 校验问题摘要：`unrecognized_keys` 这类问题没有路径，退回 issue code，避免空诊断。 */
function describeIssues(error: ZodError): string {
  return error.issues.map((issue) => issue.path.join(".") || issue.code).join(",");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : typeof error;
}

/** 记录形状判定：预设读取面只接受普通对象，数组与 null 都按不可读处理。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
