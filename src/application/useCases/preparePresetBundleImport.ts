import type {
  CustomPromptBlock,
  PresetPromptConfig,
  PromptConfig,
  PromptRequestShapingConfig,
  RegexScript,
  SamplerPreset,
  SillyTavernPresetAnalysis,
} from "../../types";
import {
  PRESET_BUNDLE_SCHEMA_VERSION,
  type PresetBundleV2,
} from "../../domain/presets/contracts";
import type {
  CompatibilityReport,
  PromptComposition,
  PromptCompositionDiagnostic,
} from "../../domain/prompt-composition";
import { parsePromptComposition } from "../../domain/prompt-composition";
import type { CompatibilityCodecDefinition } from "../compatibility/contracts";
import { dedupeTopLevelPromptBlocks } from "../../domain/prompts/promptSourceBlocks";
import { toPresetPromptConfig } from "./presetPromptConfig";
import { parseMobileTavernPresetExtension } from "./presetRuntimeNamespace";

type ExternalRecord = Record<string, unknown>;
type ImportIdKind = "preset" | "regex" | "bundle";

// 兼容分析结果的唯一定义在 `src/types.ts`；此处只转发既有导出名，保持调用方 API 稳定。
export type { SillyTavernPresetAnalysis };

export interface PreparePresetBundleImportOptions {
  input: unknown;
  fallbackName: string;
  currentPromptConfig: PromptConfig;
  /**
   * 文件自带 Prompt 字段时使用的自包含基底（通常是出厂 Prompt 配置）。
   * 未提供时退化为沿用 currentPromptConfig，避免影响既有调用方。
   */
  neutralPromptConfig?: PromptConfig;
  createId?: (kind: ImportIdKind) => string;
  compatibilityCodec?: CompatibilityCodecDefinition | null;
}

export interface PreparedPresetBundleImport {
  name: string;
  bundle: PresetBundleV2;
  composition?: PromptComposition;
  compatibilityAnalysis?: SillyTavernPresetAnalysis;
  report: CompatibilityReport;
}

/**
 * 将外部预设数据收口为应用内部预设包。
 * 该用例无 IO、无 React 状态，也不会执行外部脚本。
 */
export function preparePresetBundleImport(
  options: PreparePresetBundleImportOptions,
): PreparedPresetBundleImport {
  if (!isRecord(options.input)) throw new Error("PRESET_INVALID_ROOT");
  const data = options.input;
  const createId = options.createId ?? createImportId;
  const rawName = readString(data.name)
    || readString(data.preset_name)
    || readString(data.presetName)
    || options.fallbackName;
  const name = rawName.length > 60 ? `${rawName.slice(0, 57)}...` : rawName;
  const preset: SamplerPreset = {
    id: createId("preset"),
    name,
    temperature: readFirstNumber(data.temperature, data.temp) ?? 0.8,
    topP: readFirstNumber(data.top_p, data.topP) ?? 0.85,
    topK: readFirstNumber(data.top_k, data.topK) ?? 40,
    repetitionPenalty: readFirstNumber(data.repetition_penalty, data.repetitionPenalty) ?? 1.05,
    frequencyPenalty: readFirstNumber(data.frequency_penalty, data.frequencyPenalty) ?? 0,
    presencePenalty: readFirstNumber(data.presence_penalty, data.presencePenalty) ?? 0,
    minP: readFirstNumber(data.min_p, data.minP) ?? 0,
    maxTokens: readFirstNumber(data.max_tokens, data.openai_max_tokens, data.maxTokens) ?? 600,
  };

  // 来源格式的 Prompt 语义只由 Compatibility Codec 解释，故先取出注入的 Codec 再收口 Prompt 字段。
  const codec = options.compatibilityCodec;
  const promptConfigBase = preparePromptConfig(
    data,
    options.currentPromptConfig,
    options.neutralPromptConfig ?? options.currentPromptConfig,
    codec,
  );
  const presetExtension = parseMobileTavernPresetExtension(
    isRecord(data.extensions) ? data.extensions : undefined,
  );
  const promptConfig = presetExtension.promptRuntime
    ? toPresetPromptConfig({ ...promptConfigBase, ...presetExtension.promptRuntime })
    : promptConfigBase;
  const regexResult = parseRegexScripts(data, createId);
  // 部分社区预设没有 prompt_order；Codec 会按 prompts 原顺序降级保留，
  // 因此正式入口只要求存在 prompts，不能在此提前把它排除。
  const isSillyTavernPromptPreset = Array.isArray(data.prompts);
  const compositionImport = isSillyTavernPromptPreset && codec?.canDecode(data)
    ? parseCodecImport(codec.decode({ ...data, name }))
    : undefined;
  const composition = compositionImport
    ? { ...compositionImport.composition, name }
    : undefined;
  const compatibilityAnalysis = isSillyTavernPromptPreset && codec?.analyze
    ? parseCompatibilityAnalysis(codec.analyze(data))
    : undefined;
  const codecWarnings: PromptCompositionDiagnostic[] = isSillyTavernPromptPreset && !codec
    ? [{
        level: "warning",
        code: "COMPATIBILITY_CODEC_UNAVAILABLE",
        message: "当前 Profile 未启用 SillyTavern 兼容 Codec，已仅导入通用预设字段。",
      }]
    : [];

  // v2 实体：`prompt` 快照是唯一 Prompt 权威；导入的传统字段只进只读兼容块
  // `legacyPromptConfig`（SillyTavern 导出与运行期投影读取它）。
  const bundle: PresetBundleV2 = {
    schemaVersion: PRESET_BUNDLE_SCHEMA_VERSION,
    id: createId("bundle"),
    sampler: preset,
    prompt: composition
      ? {
          version: PRESET_BUNDLE_SCHEMA_VERSION,
          mode: "composition",
          source: "sillytavern",
          composition,
        }
      : {
          // 外部文件没有可解码编排时不得继承当前预设的编排快照（见 sillytavern_compat.md 第 4 节）。
          version: PRESET_BUNDLE_SCHEMA_VERSION,
          mode: "legacy",
          source: "mobile-tavern",
        },
    legacyPromptConfig: promptConfig,
    regexScripts: regexResult.scripts,
  };

  return {
    name,
    bundle,
    composition,
    compatibilityAnalysis,
    report: {
      warnings: [
        ...(compositionImport?.report.warnings ?? []),
        ...codecWarnings,
        ...presetExtension.diagnostics,
        ...regexResult.warnings,
      ],
      errors: compositionImport?.report.errors ?? [],
    },
  };
}

function parseCodecImport(value: unknown): {
  composition: PromptComposition;
  report: CompatibilityReport;
} {
  if (!isRecord(value) || !isRecord(value.composition) || !isCompatibilityReport(value.report)) {
    throw new Error("COMPATIBILITY_CODEC_INVALID_IMPORT_RESULT");
  }
  return {
    composition: parsePromptComposition(value.composition),
    report: value.report,
  };
}

function isCompatibilityReport(value: unknown): value is CompatibilityReport {
  return isRecord(value) && Array.isArray(value.warnings) && Array.isArray(value.errors);
}

/**
 * 收口 Codec 的兼容分析结果。
 *
 * Codec 贡献是进程内受信插件，但 `analyze` 在契约中按 `unknown` 暴露，
 * 因此这里逐字段校验形状（不解释来源语义），并避免用整体断言强行改型。
 */
function parseCompatibilityAnalysis(value: unknown): SillyTavernPresetAnalysis {
  if (!isRecord(value)) throw new Error("COMPATIBILITY_CODEC_INVALID_ANALYSIS");
  const level = value.level;
  if (level !== "full" && level !== "core" && level !== "recognize_only" && level !== "invalid") {
    throw new Error("COMPATIBILITY_CODEC_INVALID_ANALYSIS");
  }
  return {
    level,
    promptCount: requireAnalysisNumber(value, "promptCount"),
    orderedPromptCount: requireAnalysisNumber(value, "orderedPromptCount"),
    enabledPromptCount: requireAnalysisNumber(value, "enabledPromptCount"),
    markerCount: requireAnalysisNumber(value, "markerCount"),
    unknownMarkerCount: requireAnalysisNumber(value, "unknownMarkerCount"),
    inChatPromptCount: requireAnalysisNumber(value, "inChatPromptCount"),
    attachmentPromptCount: requireAnalysisNumber(value, "attachmentPromptCount"),
    regexCount: requireAnalysisNumber(value, "regexCount"),
    tavernHelperScriptCount: requireAnalysisNumber(value, "tavernHelperScriptCount"),
    enabledTavernHelperScriptCount: requireAnalysisNumber(value, "enabledTavernHelperScriptCount"),
    remoteScriptCount: requireAnalysisNumber(value, "remoteScriptCount"),
    tavernHelperScriptBytes: requireAnalysisNumber(value, "tavernHelperScriptBytes"),
    diagnostics: requireAnalysisDiagnostics(value.diagnostics),
  };
}

function requireAnalysisNumber(record: ExternalRecord, field: string): number {
  const candidate = record[field];
  if (typeof candidate !== "number") throw new Error("COMPATIBILITY_CODEC_INVALID_ANALYSIS");
  return candidate;
}

function requireAnalysisDiagnostics(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item: unknown) => typeof item !== "string")) {
    throw new Error("COMPATIBILITY_CODEC_INVALID_ANALYSIS");
  }
  return value.filter((item: unknown): item is string => typeof item === "string");
}

export function formatSillyTavernCompatibilityAnalysis(
  analysis: SillyTavernPresetAnalysis,
): string {
  const levelLabel = {
    full: "完整兼容",
    core: "核心兼容",
    recognize_only: "仅识别/降级导入",
    invalid: "无效格式",
  }[analysis.level];
  const scriptSize = analysis.tavernHelperScriptBytes >= 1024 * 1024
    ? `${(analysis.tavernHelperScriptBytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(analysis.tavernHelperScriptBytes / 1024)} KB`;
  const details = [
    `兼容分级：${levelLabel}`,
    `Prompt：${analysis.enabledPromptCount}/${analysis.orderedPromptCount} 启用（共 ${analysis.promptCount} 项）`,
    `Marker：${analysis.markerCount}，In-Chat：${analysis.inChatPromptCount}，正则：${analysis.regexCount}`,
  ];
  if (analysis.tavernHelperScriptCount > 0) {
    details.push(
      `TavernHelper：${analysis.enabledTavernHelperScriptCount}/${analysis.tavernHelperScriptCount} 启用，脚本 ${scriptSize}`,
    );
  }
  if (analysis.remoteScriptCount > 0) details.push(`外部网络脚本：${analysis.remoteScriptCount} 个（不执行）`);
  if (analysis.attachmentPromptCount > 0) details.push(`降级：${analysis.attachmentPromptCount} 个数据库附着 Prompt 不执行附着语义`);
  if (analysis.unknownMarkerCount > 0) details.push(`降级：${analysis.unknownMarkerCount} 个未知 Marker`);
  return details.join("\n");
}

export function formatPresetOperationReport(
  report: CompatibilityReport,
  operation: "导入" | "导出" = "导入",
): string {
  if (report.errors.length === 0 && report.warnings.length === 0) return "";
  const groupedWarnings = groupDiagnostics(report.warnings);
  const lines = [
    `${operation}诊断：${report.errors.length} 个错误，${report.warnings.length} 个警告`,
    ...report.errors.slice(0, 3).map((item) => `错误：${item.message}`),
    ...groupedWarnings.slice(0, 5).map((item) =>
      `警告：${item.message}${item.count > 1 ? `（同类 ${item.count} 项）` : ""}`),
  ];
  const hiddenCount = Math.max(0, report.errors.length - 3)
    + Math.max(0, groupedWarnings.length - 5);
  if (hiddenCount > 0) lines.push(`另有 ${hiddenCount} 条诊断未展开。`);
  return lines.join("\n");
}

function groupDiagnostics(
  diagnostics: PromptCompositionDiagnostic[],
): Array<{ message: string; count: number }> {
  const groups = new Map<string, { message: string; count: number }>();
  diagnostics.forEach((item) => {
    const existing = groups.get(item.code);
    if (existing) existing.count++;
    else groups.set(item.code, { message: item.message, count: 1 });
  });
  return [...groups.values()];
}

function preparePromptConfig(
  data: ExternalRecord,
  current: PromptConfig,
  neutral: PromptConfig,
  codec: CompatibilityCodecDefinition | null | undefined,
): PresetPromptConfig {
  const mainPrompt = readString(data.system_prompt) ?? readString(data.mainPrompt) ?? "";
  const jailbreakPrompt = readString(data.jailbreak_prompt) ?? readString(data.jailbreakPrompt) ?? "";
  const postHistoryPrompt = readString(data.post_history_instructions) ?? readString(data.postHistoryPrompt) ?? "";
  const storyString = readString(data.story_string) ?? readString(data.storyString) ?? "";
  // 导入边界就去掉与根字段同源的核心 Prompt 区块：ST 常把同一段正文同时放在
  // `system_prompt` 与 `prompts[main].content`，传统路径只应注入一次。
  const customPrompts = dedupeTopLevelPromptBlocks(
    readCodecPresetPrompts(codec, data),
    { mainPrompt, jailbreakPrompt },
  );
  const hasPromptFields = customPrompts.length > 0
    || hasExternalPromptCandidates(data)
    || !!mainPrompt
    || !!jailbreakPrompt
    || !!postHistoryPrompt
    || !!storyString;
  // 文件自带 Prompt 字段时以自包含基底为准：外部预设不得混入"当前预设"的 MT 专有字段。
  const base = hasPromptFields ? neutral : current;
  const instructTemplate = parseInstructTemplate(data.instruct_layouts ?? data.instructTemplate);
  const assistantPrefill = readString(data.assistant_prefill) ?? "";
  const stopSequences = readStringArray(data.custom_stop_strings)
    ?? readStringArray(data.stop_sequences)
    ?? [];
  const squashSystemMessages = data.squash_system_messages === true;
  const mergeAdjacentMessages = data.merge_adjacent_messages === true;
  const roleWrappers = parseRoleWrappers(data.role_wrappers);
  const hasRequestShaping = !!assistantPrefill
    || stopSequences.length > 0
    || squashSystemMessages
    || mergeAdjacentMessages
    || roleWrappers !== undefined;

  // 传输结构层：序列包裹、Instruct 模板、Story 排列与请求整形属于宿主请求层，不是预设内容，
  // 文件未声明时沿用基底（否则导入后角色卡字段可能完全无法进入上下文）。
  const structural: Omit<PresetPromptConfig, "mainPrompt" | "jailbreakPrompt" | "useJailbreak"> = {
    instructTemplate: instructTemplate ?? base.instructTemplate,
    systemPrefix: readString(data.system_sequence_start) ?? base.systemPrefix,
    systemSuffix: readString(data.system_sequence_end) ?? base.systemSuffix,
    userPrefix: readString(data.user_sequence_start) ?? base.userPrefix,
    userSuffix: readString(data.user_sequence_end) ?? base.userSuffix,
    assistantPrefix: readString(data.assistant_sequence_start) ?? base.assistantPrefix,
    assistantSuffix: readString(data.assistant_sequence_end) ?? base.assistantSuffix,
    storyString: hasPromptFields ? storyString : base.storyString,
    requestShaping: hasRequestShaping
      ? {
          enabled: true,
          mergeAdjacentMessages,
          squashSystemMessages,
          roleWrappers,
          assistantPrefill,
          stopSequences,
        }
      : base.requestShaping,
  };

  if (!hasPromptFields) {
    // 文件不含任何 Prompt 字段（例如只携带采样参数的预设）：沿用基底内容，避免清空当前提示词。
    return toPresetPromptConfig({
      ...base,
      ...structural,
      mainPrompt: base.mainPrompt,
      jailbreakPrompt: base.jailbreakPrompt,
      useJailbreak: base.useJailbreak,
      postHistoryPrompt: base.postHistoryPrompt,
      usePostHistory: base.usePostHistory,
      customPrompts: base.customPrompts,
    });
  }

  // 文件自带 Prompt 字段：内容字段只能来自文件，未声明即"不声明"。
  // 严禁展开基底——否则 tableMemoryPrompt / sectionHeaders / roleplayMode / useMainPrompt /
  // reasoningGuidancePrompt / renderingFormat 等本应用专有内容会被固化进第三方预设包，
  // 使外部预设"自带系统内置内容"。这些键保持缺失后，由运行时出厂默认兜底。
  return toPresetPromptConfig({
    ...structural,
    mainPrompt,
    jailbreakPrompt,
    useJailbreak: !!jailbreakPrompt,
    postHistoryPrompt,
    usePostHistory: !!postHistoryPrompt,
    customPrompts,
  });
}

/**
 * 来源格式的 Prompt 候选列表只由 Compatibility Codec 解释（顺序容器、角色别名、
 * 候选库丢弃与保留字段都在兼容边界收口）；通用用例只消费结果，不反向识别
 * `prompts` / `prompt_order` / `marker` 等来源字段（见 `COMPAT-DATA`）。
 */
function readCodecPresetPrompts(
  codec: CompatibilityCodecDefinition | null | undefined,
  data: ExternalRecord,
): CustomPromptBlock[] {
  const provided = codec?.readPresetPrompts?.(data);
  return Array.isArray(provided) ? [...provided] : [];
}

/**
 * 判断外部文件是否自带 Prompt 候选字段，作为"自包含导入"的依据
 * （见 sillytavern_compat.md 第 4 节）。
 *
 * 这里只做存在性判断，不解释来源语义：内容如何收口由 Compatibility Codec 决定。
 */
function hasExternalPromptCandidates(data: ExternalRecord): boolean {
  const containsRecord = (value: unknown): boolean =>
    Array.isArray(value) && value.some((item: unknown) => isRecord(item));
  return containsRecord(data.prompts)
    || containsRecord(data.customPrompts)
    || Array.isArray(data.prompt_order)
    || Array.isArray(data.promptOrder);
}

function parseRegexScripts(
  data: ExternalRecord,
  createId: (kind: ImportIdKind) => string,
): { scripts: RegexScript[]; warnings: PromptCompositionDiagnostic[] } {
  const extensions = isRecord(data.extensions) ? data.extensions : undefined;
  const rawSource = extensions?.regex_scripts ?? data.regex_scripts;
  const rawScripts = Array.isArray(rawSource)
    ? rawSource
    : isRecord(rawSource) ? Object.values(rawSource) : [];
  const scripts: RegexScript[] = [];
  const warnings: PromptCompositionDiagnostic[] = [];
  rawScripts.forEach((item, index) => {
    if (!isRecord(item)) {
      warnings.push(regexWarning(index, "正则项目不是对象，已跳过。"));
      return;
    }
    const scriptName = readString(item.scriptName);
    const findRegex = readString(item.findRegex);
    if (!scriptName || !findRegex) {
      warnings.push(regexWarning(index, "正则项目缺少 scriptName 或 findRegex，已跳过。"));
      return;
    }
    scripts.push({
      id: readString(item.id) ?? createId("regex"),
      scriptName,
      findRegex,
      replaceString: readString(item.replaceString) ?? "",
      disabled: item.disabled === true,
      placement: Array.isArray(item.placement)
        ? item.placement.filter((entry): entry is number => typeof entry === "number")
        : [2],
      runOnEdit: typeof item.runOnEdit === "boolean" ? item.runOnEdit : true,
      markdownOnly: typeof item.markdownOnly === "boolean" ? item.markdownOnly : false,
      promptOnly: typeof item.promptOnly === "boolean" ? item.promptOnly : false,
      substituteRegex: readNumber(item.substituteRegex),
      minDepth: item.minDepth === null ? null : readNumber(item.minDepth),
      maxDepth: item.maxDepth === null ? null : readNumber(item.maxDepth),
      trimStrings: readStringArray(item.trimStrings),
    });
  });
  return { scripts, warnings };
}

function regexWarning(index: number, message: string): PromptCompositionDiagnostic {
  return {
    level: "warning",
    code: "SKIPPED_INVALID_REGEX_SCRIPT",
    message: `第 ${index + 1} 个${message}`,
  };
}

function parseInstructTemplate(value: unknown): PromptConfig["instructTemplate"] | undefined {
  return value === "default" || value === "alpaca" || value === "chatml"
    || value === "llama3" || value === "custom"
    ? value
    : undefined;
}

function parseRoleWrappers(value: unknown): PromptRequestShapingConfig["roleWrappers"] | undefined {
  if (!isRecord(value)) return undefined;
  const result: NonNullable<PromptRequestShapingConfig["roleWrappers"]> = {};
  (["system", "user", "assistant"] as const).forEach((role) => {
    const wrapper = value[role];
    if (!isRecord(wrapper)) return;
    const prefix = readString(wrapper.prefix);
    const suffix = readString(wrapper.suffix);
    if (prefix !== undefined || suffix !== undefined) result[role] = { prefix, suffix };
  });
  return Object.keys(result).length > 0 ? result : undefined;
}

function createImportId(kind: ImportIdKind): string {
  const prefix = kind === "preset" ? "import" : kind === "regex" ? "import_reg" : "bundle";
  return `${prefix}_${Math.random().toString(36).substring(2, 9)}`;
}

function readFirstNumber(...values: unknown[]): number | undefined {
  return values.map(readNumber).find((value) => value !== undefined);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function isRecord(value: unknown): value is ExternalRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
