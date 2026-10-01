import type { CustomPromptBlock, RegexScript, SavedPresetBundle } from "../../types";
import {
  PRESET_BUNDLE_SCHEMA_VERSION,
  presetBundleV2Schema,
  presetSamplerSchema,
  type PresetBundleV2,
  type PresetSamplerV2,
} from "./contracts";
import {
  isRecord,
  resolvePromptFromV1Fields,
  toPromptSnapshotV2,
} from "./promptSnapshot";

/**
 * 预设实体 v1 → v2 读取迁移。
 *
 * 存储边界必须"能读就不能失效"：v1 记录、被改坏的记录、含未知字段的记录都要能读出来，
 * 并且**不得静默丢数据**（`CHANGE-SAFE`）。因此这里的策略是
 * 「构造候选 → 用实体 schema 校验 → 逐级降级修复 → 记录诊断」，而不是直接 `parse` 抛错。
 * 只有导入边界才允许 fail-closed，那由导入用例负责。
 */

export type PresetBundleDiagnosticCode =
  | "preset.bundle.v1-migrated"
  | "preset.bundle.v2-repaired"
  | "preset.bundle.invalid-record"
  | "preset.bundle.regex-script-dropped"
  | "preset.bundle.unknown-keys-preserved";

export interface PresetBundleDiagnostic {
  code: PresetBundleDiagnosticCode;
  detail?: string;
}

export interface PresetBundleReadResult {
  bundle: PresetBundleV2;
  /** 记录由旧形态迁移或被修复，调用方应写回 v2 存储。 */
  migrated: boolean;
  diagnostics: readonly PresetBundleDiagnostic[];
}

export interface PresetBundleListReadResult {
  bundles: PresetBundleV2[];
  migrated: boolean;
  diagnostics: readonly PresetBundleDiagnostic[];
}

/** v1 记录中被 v2 识别的键；其余键进 `extensions` 保真保存。 */
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

const V2_KNOWN_KEYS: readonly string[] = [
  "schemaVersion",
  "id",
  "isBuiltin",
  "sampler",
  "prompt",
  "regexScripts",
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

/** 读取单条预设记录；无法作为预设识别的记录返回 null。 */
export function readPresetBundle(raw: unknown): PresetBundleReadResult | null {
  if (!isRecord(raw)) return null;
  const id = readNonEmptyString(raw.id);
  if (id === undefined) return null;
  return raw.schemaVersion === PRESET_BUNDLE_SCHEMA_VERSION
    ? readV2Record(raw, id)
    : readV1Record(raw, id);
}

/**
 * 严格迁移：把确定可用的记录（编译期内置预设常量、测试夹具）转换为 v2；不可用时抛错。
 *
 * 存储边界请用 `readPresetBundle`（可失效优先），本入口只用于"必须成功"的调用点。
 */
export function requirePresetBundleV2(raw: unknown): PresetBundleV2 {
  const read = readPresetBundle(raw);
  if (read === null) throw new Error("preset.bundle.invalid-record: 记录无法识别为预设");
  return read.bundle;
}

/** 读取预设列表；非记录与缺少 id 的条目会被丢弃并留下诊断。 */export function readPresetBundleList(raw: unknown): PresetBundleListReadResult {
  if (!Array.isArray(raw)) {
    return { bundles: [], migrated: false, diagnostics: [{ code: "preset.bundle.invalid-record", detail: "不是数组" }] };
  }
  const bundles: PresetBundleV2[] = [];
  const diagnostics: PresetBundleDiagnostic[] = [];
  let migrated = false;

  for (const entry of raw) {
    const result = readPresetBundle(entry);
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

function readV2Record(raw: Record<string, unknown>, id: string): PresetBundleReadResult {
  const parsed = presetBundleV2Schema.safeParse(raw);
  if (parsed.success) {
    return { bundle: parsed.data, migrated: false, diagnostics: [] };
  }
  // v2 记录被改坏：按同样的修复路径重建，并保留未知字段与诊断。
  const repaired = buildBundle({
    id,
    isBuiltin: raw.isBuiltin === true,
    samplerSource: raw.sampler,
    promptSource: raw.prompt,
    regexScriptsSource: raw.regexScripts,
    legacyPromptConfig: isRecord(raw.legacyPromptConfig) ? raw.legacyPromptConfig : undefined,
    preserveFrom: raw,
    knownKeys: V2_KNOWN_KEYS,
  });
  return {
    bundle: repaired.bundle,
    migrated: true,
    diagnostics: [
      { code: "preset.bundle.v2-repaired", detail: parsed.error.issues.map((issue) => issue.path.join(".")).join(",") },
      ...repaired.diagnostics,
    ],
  };
}

function readV1Record(raw: Record<string, unknown>, id: string): PresetBundleReadResult {
  const promptConfig = isRecord(raw.promptConfig) ? raw.promptConfig : undefined;
  const repaired = buildBundle({
    id,
    isBuiltin: raw.isBuiltin === true,
    samplerSource: raw.preset,
    promptSource: toPromptSnapshotV2(resolvePromptFromV1Fields({
      promptConfig: promptConfig as SavedPresetBundle["promptConfig"] | undefined,
      promptPlan: raw.promptPlan,
      composition: raw.composition,
      usePromptComposition: raw.usePromptComposition,
    })),
    regexScriptsSource: raw.presetRegexScripts,
    legacyPromptConfig: promptConfig,
    preserveFrom: raw,
    knownKeys: V1_KNOWN_KEYS,
  });
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
  promptSource: unknown;
  regexScriptsSource: unknown;
  legacyPromptConfig: Record<string, unknown> | undefined;
  preserveFrom: Record<string, unknown>;
  knownKeys: readonly string[];
}

function buildBundle(input: BuildBundleInput): { bundle: PresetBundleV2; diagnostics: PresetBundleDiagnostic[] } {
  const diagnostics: PresetBundleDiagnostic[] = [];
  const candidate: Record<string, unknown> = {
    schemaVersion: PRESET_BUNDLE_SCHEMA_VERSION,
    id: input.id,
    sampler: toSamplerV2(input.samplerSource, input.id),
    prompt: toPromptSnapshot(input.promptSource),
    regexScripts: toRegexScripts(input.regexScriptsSource, diagnostics),
  };
  if (input.isBuiltin) candidate.isBuiltin = true;
  if (input.legacyPromptConfig) candidate.legacyPromptConfig = input.legacyPromptConfig;

  const preserved = collectUnknownKeys(input.preserveFrom, input.knownKeys);
  if (preserved) {
    candidate.extensions = preserved;
    diagnostics.push({
      code: "preset.bundle.unknown-keys-preserved",
      detail: Object.keys(preserved).join(","),
    });
  }

  const parsed = presetBundleV2Schema.safeParse(candidate);
  if (parsed.success) return { bundle: parsed.data, diagnostics };

  // 最后一级降级：丢掉无法校验的 Prompt 快照与正则，保留可读的采样与兼容块。
  diagnostics.push({ code: "preset.bundle.v2-repaired", detail: "候选未通过校验，已降级为 legacy 快照" });
  const fallback: Record<string, unknown> = {
    schemaVersion: PRESET_BUNDLE_SCHEMA_VERSION,
    id: input.id,
    sampler: toSamplerV2(input.samplerSource, input.id),
    prompt: toPromptSnapshotV2(resolvePromptFromV1Fields({ promptConfig: undefined })),
    regexScripts: [],
  };
  if (input.isBuiltin) fallback.isBuiltin = true;
  if (input.legacyPromptConfig) fallback.legacyPromptConfig = input.legacyPromptConfig;
  if (preserved) fallback.extensions = preserved;
  return { bundle: presetBundleV2Schema.parse(fallback), diagnostics };
}

function toSamplerV2(raw: unknown, fallbackId: string): PresetSamplerV2 {
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

function toPromptSnapshot(raw: unknown): Record<string, unknown> {
  if (isRecord(raw) && (raw.mode === "legacy" || raw.mode === "composition")) {
    return {
      version: PRESET_BUNDLE_SCHEMA_VERSION,
      mode: raw.mode,
      source: raw.source === "sillytavern" || raw.source === "native" ? raw.source : "mobile-tavern",
      ...(raw.composition === undefined ? {} : { composition: raw.composition }),
    };
  }
  return toPromptSnapshotV2(resolvePromptFromV1Fields({ promptConfig: undefined }));
}

function toRegexScripts(raw: unknown, diagnostics: PresetBundleDiagnostic[]): RegexScript[] {
  if (!Array.isArray(raw)) return [];
  const scripts: RegexScript[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      diagnostics.push({ code: "preset.bundle.regex-script-dropped", detail: describeRecord(entry) });
      continue;
    }
    scripts.push({
      ...entry,
      id: readString(entry.id) ?? "",
      scriptName: readString(entry.scriptName) ?? "",
      findRegex: readString(entry.findRegex) ?? "",
      replaceString: readString(entry.replaceString) ?? "",
      disabled: entry.disabled === true,
      placement: Array.isArray(entry.placement)
        ? entry.placement.filter((item): item is number => typeof item === "number" && Number.isInteger(item))
        : [],
    });
  }
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

/** 供类型检查与调用方复用：v1 记录形状。 */
export type PresetBundleV1Like = Partial<SavedPresetBundle> & { id: string };

/** 传统 Prompt 区块在迁移中的来源；仅用于文档化 v1 的读取面。 */
export type MigratedPromptBlocks = CustomPromptBlock[];
