import type {
  CustomPromptBlock,
  PresetPromptConfig,
  PromptConfig,
  PromptRequestShapingConfig,
  RegexScript,
  SavedPresetBundle,
  SamplerPreset,
} from "../../types";
import type {
  CompatibilityReport,
  PromptComposition,
  PromptCompositionDiagnostic,
} from "../../domain/prompt-composition";
import { parsePromptComposition } from "../../domain/prompt-composition";
import type { CompatibilityCodecDefinition } from "../compatibility/contracts";
import { createPromptPresetPlan, toPresetPromptConfig } from "./presetPromptConfig";

type ExternalRecord = Record<string, unknown>;
type ImportIdKind = "preset" | "regex" | "bundle";

export interface PreparePresetBundleImportOptions {
  input: unknown;
  fallbackName: string;
  currentPromptConfig: PromptConfig;
  createId?: (kind: ImportIdKind) => string;
  compatibilityCodec?: CompatibilityCodecDefinition | null;
}

export interface SillyTavernPresetAnalysis {
  level: "full" | "core" | "recognize_only" | "invalid";
  promptCount: number;
  orderedPromptCount: number;
  enabledPromptCount: number;
  markerCount: number;
  unknownMarkerCount: number;
  inChatPromptCount: number;
  attachmentPromptCount: number;
  regexCount: number;
  tavernHelperScriptCount: number;
  enabledTavernHelperScriptCount: number;
  remoteScriptCount: number;
  tavernHelperScriptBytes: number;
  diagnostics: string[];
}

export interface PreparedPresetBundleImport {
  name: string;
  bundle: SavedPresetBundle;
  composition?: PromptComposition;
  compatibilityAnalysis?: SillyTavernPresetAnalysis;
  report: CompatibilityReport;
}

interface PromptOrderEntry {
  identifier: string;
  enabled: boolean;
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
  const name = readString(data.name)
    || readString(data.preset_name)
    || readString(data.presetName)
    || options.fallbackName;
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

  const promptConfig = preparePromptConfig(data, options.currentPromptConfig);
  const regexResult = parseRegexScripts(data, createId);
  // 部分社区预设没有 prompt_order；Codec 会按 prompts 原顺序降级保留，
  // 因此正式入口只要求存在 prompts，不能在此提前把它排除。
  const isSillyTavernPromptPreset = Array.isArray(data.prompts);
  const codec = options.compatibilityCodec;
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

  const bundle: SavedPresetBundle = {
    id: createId("bundle"),
    preset,
    promptConfig,
    presetRegexScripts: regexResult.scripts,
  };
  if (composition) {
    bundle.promptPlan = {
      version: 1,
      mode: "composition",
      source: "sillytavern",
      composition,
    };
  } else {
    bundle.promptPlan = createPromptPresetPlan(
      { ...options.currentPromptConfig, ...promptConfig, usePromptComposition: false },
      "mobile-tavern",
    );
  }

  return {
    name,
    bundle,
    composition,
    compatibilityAnalysis,
    report: {
      warnings: [
        ...(compositionImport?.report.warnings ?? []),
        ...codecWarnings,
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

function parseCompatibilityAnalysis(value: unknown): SillyTavernPresetAnalysis {
  if (!isRecord(value) || !["full", "core", "recognize_only", "invalid"].includes(String(value.level))) {
    throw new Error("COMPATIBILITY_CODEC_INVALID_ANALYSIS");
  }
  const numberFields = [
    "promptCount", "orderedPromptCount", "enabledPromptCount", "markerCount",
    "unknownMarkerCount", "inChatPromptCount", "attachmentPromptCount", "regexCount",
    "tavernHelperScriptCount", "enabledTavernHelperScriptCount", "remoteScriptCount",
    "tavernHelperScriptBytes",
  ] as const;
  if (numberFields.some((field) => typeof value[field] !== "number")) {
    throw new Error("COMPATIBILITY_CODEC_INVALID_ANALYSIS");
  }
  if (!Array.isArray(value.diagnostics) || value.diagnostics.some((item) => typeof item !== "string")) {
    throw new Error("COMPATIBILITY_CODEC_INVALID_ANALYSIS");
  }
  return value as unknown as SillyTavernPresetAnalysis;
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
): PresetPromptConfig {
  const mainPrompt = readString(data.system_prompt) ?? readString(data.mainPrompt) ?? "";
  const jailbreakPrompt = readString(data.jailbreak_prompt) ?? readString(data.jailbreakPrompt) ?? "";
  const postHistoryPrompt = readString(data.post_history_instructions) ?? readString(data.postHistoryPrompt) ?? "";
  const storyString = readString(data.story_string) ?? readString(data.storyString) ?? "";
  const customPrompts = parseCustomPrompts(data);
  const hasPromptFields = customPrompts.length > 0
    || Array.isArray(data.prompt_order)
    || Array.isArray(data.promptOrder)
    || !!mainPrompt
    || !!jailbreakPrompt
    || !!postHistoryPrompt
    || !!storyString;
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

  return toPresetPromptConfig({
    ...current,
    mainPrompt: hasPromptFields ? mainPrompt : current.mainPrompt,
    jailbreakPrompt: hasPromptFields ? jailbreakPrompt : current.jailbreakPrompt,
    useJailbreak: hasPromptFields ? !!jailbreakPrompt : current.useJailbreak,
    postHistoryPrompt: hasPromptFields ? postHistoryPrompt : current.postHistoryPrompt,
    usePostHistory: hasPromptFields ? !!postHistoryPrompt : current.usePostHistory,
    storyString: hasPromptFields ? storyString : current.storyString,
    customPrompts: hasPromptFields ? customPrompts : current.customPrompts,
    instructTemplate,
    systemPrefix: readString(data.system_sequence_start) || readString(data.systemPrefix) || current.systemPrefix,
    systemSuffix: readString(data.system_sequence_end) || readString(data.systemSuffix) || current.systemSuffix,
    userPrefix: readString(data.user_sequence_start) || readString(data.userPrefix) || current.userPrefix,
    userSuffix: readString(data.user_sequence_end) || readString(data.userSuffix) || current.userSuffix,
    assistantPrefix: readString(data.assistant_sequence_start) || readString(data.assistantPrefix) || current.assistantPrefix,
    assistantSuffix: readString(data.assistant_sequence_end) || readString(data.assistantSuffix) || current.assistantSuffix,
    requestShaping: hasRequestShaping
      ? {
          enabled: true,
          mergeAdjacentMessages,
          squashSystemMessages,
          roleWrappers,
          assistantPrefill,
          stopSequences,
        }
      : current.requestShaping,
  });
}

function parseCustomPrompts(data: ExternalRecord): CustomPromptBlock[] {
  const rawPrompts = Array.isArray(data.prompts)
    ? data.prompts
    : Array.isArray(data.customPrompts) ? data.customPrompts : [];
  const prompts = rawPrompts.filter(isRecord);
  const preferredOrder = readPreferredPromptOrder(data.prompt_order ?? data.promptOrder);
  const orderByIdentifier = new Map(preferredOrder.map((entry) => [entry.identifier, entry]));
  const promptByIdentifier = new Map(prompts.map((prompt, index) => [
    readString(prompt.identifier) ?? readString(prompt.id) ?? `prompt_${index + 1}`,
    prompt,
  ]));
  // 与 ST Prompt Manager 一致：有排序时只保留排序条目，候选库不进入界面列表；
  // 无排序时降级保留全部，避免静默丢失。
  const identifiers = preferredOrder.length > 0
    ? preferredOrder.map((entry) => entry.identifier)
    : [...promptByIdentifier.keys()];
  return identifiers.map((identifier) => {
    const prompt = promptByIdentifier.get(identifier) ?? {};
    const rawRole = readString(prompt.role);
    const role: CustomPromptBlock["role"] = rawRole === "model"
      ? "assistant"
      : rawRole === "user" || rawRole === "assistant"
        ? rawRole
        : "system";
    return {
      id: readString(prompt.id) ?? identifier,
      identifier,
      name: readString(prompt.name) ?? "导入提示词模组",
      role,
      content: readString(prompt.content) ?? "",
      enabled: orderByIdentifier.get(identifier)?.enabled
        ?? (preferredOrder.length > 0 ? false : prompt.enabled !== false),
      marker: prompt.marker === true || undefined,
      system_prompt: typeof prompt.system_prompt === "boolean" ? prompt.system_prompt : undefined,
      injection_position: readNumber(prompt.injection_position),
      injection_depth: readNumber(prompt.injection_depth),
      injection_order: readNumber(prompt.injection_order),
      forbid_overrides: typeof prompt.forbid_overrides === "boolean" ? prompt.forbid_overrides : undefined,
      injection_trigger: readStringArray(prompt.injection_trigger),
    };
  });
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

/** ST 导出通常用 100001 保存用户实际编排，100000 是基础默认编排。 */
function readPreferredPromptOrder(value: unknown): PromptOrderEntry[] {
  if (!Array.isArray(value)) return [];
  const containers = value.filter(isRecord).filter((item) => Array.isArray(item.order));
  const selected = containers.find((item) => item.character_id === 100001 || item.character_id === "100001")
    ?? containers[0];
  if (!selected || !Array.isArray(selected.order)) return [];
  return selected.order.filter(isRecord).flatMap((item) => {
    const identifier = readString(item.identifier);
    return identifier ? [{ identifier, enabled: item.enabled !== false }] : [];
  });
}

function parseInstructTemplate(value: unknown): PromptConfig["instructTemplate"] {
  return value === "default" || value === "alpaca" || value === "chatml"
    || value === "llama3" || value === "custom"
    ? value
    : "default";
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
