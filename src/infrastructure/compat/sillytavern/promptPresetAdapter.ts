import type {
  CompatibilityReport,
  PromptBlock,
  PromptComposition,
  PromptCompositionDiagnostic,
  PromptMessageRole,
} from "../../../domain/prompt-composition";
import { parsePromptComposition } from "../../../domain/prompt-composition";
import type { CompatibilityCodecDefinition } from "../../../application/compatibility/contracts";
import type {
  CustomPromptBlock,
  SillyTavernCompatibilityLevel,
  SillyTavernPresetAnalysis,
} from "../../../types";

// 分析结果与兼容分级的唯一定义在 `src/types.ts`：通用用例与本适配器都只 import，
// 不再各自声明一份必然漂移的类型。
export type { SillyTavernCompatibilityLevel, SillyTavernPresetAnalysis };

interface SillyTavernPromptOrderEntry {
  identifier: string;
  enabled?: boolean;
}

interface SillyTavernPromptOrder {
  character_id?: number | string;
  order: SillyTavernPromptOrderEntry[];
}

export interface SillyTavernImportResult {
  composition: PromptComposition;
  report: CompatibilityReport;
}

export interface SillyTavernExportResult {
  data: Record<string, unknown> & {
    name: string;
    prompts: Array<Record<string, unknown>>;
    prompt_order: SillyTavernPromptOrder[];
  };
  report: CompatibilityReport;
}

const ROOT_KNOWN_FIELDS = new Set([
  "name",
  "version",
  "prompts",
  "prompt_order",
  "promptOrder",
  "system_prompt",
  "mainPrompt",
  "jailbreak_prompt",
  "jailbreakPrompt",
  "post_history_instructions",
  "postHistoryPrompt",
  "story_string",
  "storyString",
  "regex_scripts",
]);

const PROMPT_KNOWN_FIELDS = new Set([
  "id",
  "identifier",
  "name",
  "role",
  "content",
  "system_prompt",
  "enabled",
  "injection_position",
  "injection_depth",
  "injection_order",
  "position",
  "depth",
  "order",
  "marker",
]);

/** 已识别但领域编排不执行的 ST 字段：隔离保留用于往返，不作为未知字段报警。 */
const PROMPT_RECOGNIZED_PRESERVED_FIELDS = new Set([
  "forbid_overrides",
  "injection_trigger",
  "attach_index",
  "attach_role",
  "attach_side",
]);

const KNOWN_SOURCE_MACROS: Record<string, string> = {
  main: "{{prompt.main}}",
  mainPrompt: "{{prompt.main}}",
  worldInfoBefore: "{{worldbook.before}}",
  world_info_before: "{{worldbook.before}}",
  worldInfoAfter: "{{worldbook.after}}",
  world_info_after: "{{worldbook.after}}",
  personaDescription: "{{persona.description}}",
  persona_description: "{{persona.description}}",
  charDescription: "{{character.description}}",
  characterDescription: "{{character.description}}",
  charPersonality: "{{character.personality}}",
  characterPersonality: "{{character.personality}}",
  scenario: "{{character.scenario}}",
  dialogueExamples: "{{character.examples}}",
  chatExamples: "{{character.examples}}",
  jailbreak: "{{prompt.jailbreak}}",
  postHistoryInstructions: "{{prompt.postHistory}}",
  post_history_instructions: "{{prompt.postHistory}}",
  enhanceDefinitions: "{{character.systemPrompt}}",
};

const HISTORY_IDENTIFIERS = new Set(["chatHistory", "chat_history"]);
const AGENT_IDENTIFIERS = new Set(["agentSystemPrompt", "agentResults"]);
const MAX_PRESERVED_SCRIPT_BYTES = 2 * 1024 * 1024;

/**
 * 在导入前只读分析 ST 预设的可移植语义与扩展风险。
 * 结果只由数据形状决定，不包含任何特定预设或作者名称。
 */
export function analyzeSillyTavernPreset(input: unknown): SillyTavernPresetAnalysis {
  if (!isRecord(input) || !Array.isArray(input.prompts)) {
    return {
      level: "invalid",
      promptCount: 0,
      orderedPromptCount: 0,
      enabledPromptCount: 0,
      markerCount: 0,
      unknownMarkerCount: 0,
      inChatPromptCount: 0,
      attachmentPromptCount: 0,
      regexCount: 0,
      tavernHelperScriptCount: 0,
      enabledTavernHelperScriptCount: 0,
      remoteScriptCount: 0,
      tavernHelperScriptBytes: 0,
      diagnostics: ["INVALID_PRESET_ROOT"],
    };
  }

  const prompts = input.prompts.filter(isRecord);
  const order = readPromptOrder(input.prompt_order ?? input.promptOrder);
  const effectiveOrder = selectOrderedPromptEntries(
    order,
    prompts.map((prompt, index) => ({
      identifier: getIdentifier(prompt, index),
      enabled: prompt.enabled !== false,
    })),
  );
  const markers = prompts.filter((prompt) => prompt.marker === true);
  const unknownMarkers = markers.filter((prompt, index) => {
    const identifier = getIdentifier(prompt, index);
    return !KNOWN_SOURCE_MACROS[identifier]
      && !HISTORY_IDENTIFIERS.has(identifier)
      && !AGENT_IDENTIFIERS.has(identifier);
  });
  const attachmentPromptCount = prompts.filter((prompt) =>
    prompt.attach_index !== undefined || prompt.attach_role !== undefined || prompt.attach_side !== undefined
  ).length;
  const agentMarkerCount = markers.filter((prompt, index) =>
    AGENT_IDENTIFIERS.has(getIdentifier(prompt, index))
  ).length;
  const extensions = isRecord(input.extensions) ? input.extensions : undefined;
  const regexScripts = readRecordCollection(extensions?.regex_scripts ?? input.regex_scripts);
  const tavernHelper = extensions && isRecord(extensions.tavern_helper)
    ? extensions.tavern_helper
    : undefined;
  const scripts = tavernHelper && Array.isArray(tavernHelper.scripts)
    ? tavernHelper.scripts.filter(isRecord)
    : [];
  const enabledScripts = scripts.filter((script) => script.enabled !== false);
  const remoteScriptCount = enabledScripts.filter((script) => {
    const content = readOptionalString(script.content);
    return /https?:\/\//i.test(content);
  }).length;
  const tavernHelperScriptBytes = scripts.reduce((total, script) =>
    total + byteLength(readOptionalString(script.content)), 0
  );
  const diagnostics: string[] = [];
  if (attachmentPromptCount > 0) diagnostics.push("UNSUPPORTED_ATTACHMENT_PROMPTS");
  if (agentMarkerCount > 0) diagnostics.push("UNSUPPORTED_AGENT_MARKERS");
  if (unknownMarkers.length > 0) diagnostics.push("UNKNOWN_MARKERS");
  if (enabledScripts.length > 0) diagnostics.push("PRESET_TAVERN_HELPER_SCRIPTS_NOT_EXECUTED");
  if (remoteScriptCount > 0) diagnostics.push("REMOTE_SCRIPT_EXECUTION_BLOCKED");
  if (tavernHelperScriptBytes > MAX_PRESERVED_SCRIPT_BYTES) diagnostics.push("SCRIPT_PAYLOAD_TOO_LARGE");

  const level: SillyTavernCompatibilityLevel = attachmentPromptCount > 0
    || agentMarkerCount > 0
    || tavernHelperScriptBytes > MAX_PRESERVED_SCRIPT_BYTES
    ? "recognize_only"
    : enabledScripts.length > 0 || unknownMarkers.length > 0
      ? "core"
      : "full";

  const promptByIdentifier = new Map(prompts.map((p, i) => [getIdentifier(p, i), p]));
  const effectiveEnabledCount = effectiveOrder.filter((entry) => {
    if (typeof entry.enabled === "boolean") return entry.enabled;
    const prompt = promptByIdentifier.get(entry.identifier);
    return prompt ? prompt.enabled !== false : true;
  }).length;

  return {
    level,
    promptCount: prompts.length,
    orderedPromptCount: effectiveOrder.length,
    enabledPromptCount: effectiveEnabledCount,
    markerCount: markers.length,
    unknownMarkerCount: unknownMarkers.length,
    inChatPromptCount: prompts.filter((prompt) => prompt.injection_position === 1).length,
    attachmentPromptCount,
    regexCount: regexScripts.length,
    tavernHelperScriptCount: scripts.length,
    enabledTavernHelperScriptCount: enabledScripts.length,
    remoteScriptCount,
    tavernHelperScriptBytes,
    diagnostics,
  };
}

/**
 * SillyTavern Chat Completion 预设防腐导入。
 * 专有 identifier 只在本文件转换，产物是无 ST 运行时依赖的普通 PromptComposition。
 */
export function importSillyTavernPreset(input: unknown): SillyTavernImportResult {
  const warnings: PromptCompositionDiagnostic[] = [];
  const errors: PromptCompositionDiagnostic[] = [];
  if (!isRecord(input)) throw new Error("SILLYTAVERN_PRESET_INVALID_ROOT");

  const name = readOptionalString(input.name) || "导入的 SillyTavern 编排";
  const rawPrompts = Array.isArray(input.prompts) ? input.prompts : [];
  const prompts = rawPrompts.filter(isRecord);
  if (prompts.length !== rawPrompts.length) {
    warnings.push(warning("SKIPPED_INVALID_PROMPT", "部分 SillyTavern Prompt 不是对象，已跳过。"));
  }

  const order = readPromptOrder(input.prompt_order ?? input.promptOrder);
  const promptByIdentifier = new Map<string, Record<string, unknown>>();
  prompts.forEach((prompt, index) => {
    const identifier = getIdentifier(prompt, index);
    if (promptByIdentifier.has(identifier)) {
      warnings.push(warning("DUPLICATE_IDENTIFIER", `重复的 Prompt identifier 已使用最后一项：${identifier}`));
    }
    promptByIdentifier.set(identifier, prompt);
  });

  // 某些 ST 预设只在根字段保存三个常用 Prompt，将其补入统一转换入口。
  addRootPrompt(promptByIdentifier, "main", input.system_prompt ?? input.mainPrompt, "Main Prompt");
  addRootPrompt(promptByIdentifier, "jailbreak", input.jailbreak_prompt ?? input.jailbreakPrompt, "Jailbreak");
  addRootPrompt(promptByIdentifier, "postHistoryInstructions", input.post_history_instructions ?? input.postHistoryPrompt, "Post-History Instructions");
  addRootPrompt(promptByIdentifier, "storyString", input.story_string ?? input.storyString, "Story String");

  // 与 ST Prompt Manager 一致：有 prompt_order 时只导入排序条目，
  // 候选库（未排序 Prompt）在 ST 中仅存在于下拉候选、不进入管理器列表，因此不转为编排区块。
  // 完全没有 prompt_order 时降级保留全部，避免静默丢失无排序预设的内容。
  const unorderedIdentifiers = [...promptByIdentifier.keys()]
    .filter((identifier) => !order.some((item) => item.identifier === identifier));
  const identifiers = selectOrderedPromptEntries(
    order,
    unorderedIdentifiers.map((identifier) => ({ identifier })),
  ).map((entry) => entry.identifier);
  if (order.length > 0 && unorderedIdentifiers.length > 0) {
    warnings.push(warning(
      "SKIPPED_UNORDERED_PROMPTS",
      `${unorderedIdentifiers.length} 个未在 prompt_order 中的候选 Prompt 未导入（与 ST Prompt Manager 一致，它们仅存在于候选库）。`,
    ));
  }
  const usedBlockIds = new Set<string>();
  const blocks: PromptBlock[] = [];

  identifiers.forEach((identifier, index) => {
    const prompt = promptByIdentifier.get(identifier) ?? { identifier, name: identifier, enabled: false };
    const orderEntry = order.find((item) => item.identifier === identifier);
    const block = convertPrompt(prompt, identifier, index, orderEntry?.enabled, warnings, usedBlockIds);
    blocks.push(block);
  });

  const preservedRootFields = pickUnknownFields(input, ROOT_KNOWN_FIELDS);
  const sourceVersion = readOptionalString(input.version);
  if (Object.keys(preservedRootFields).length > 0) {
    warnings.push(warning("PRESERVED_UNKNOWN_ROOT_FIELDS", "未识别的 SillyTavern 根字段已隔离保留，不参与编译。"));
  }

  return {
    composition: {
      id: `composition_st_${createSafeId(name)}`,
      name,
      version: 1,
      blocks,
      compatibility: {
        source: "sillytavern",
        sourceVersion: sourceVersion || undefined,
        originalName: name,
        preservedRootFields: Object.keys(preservedRootFields).length ? preservedRootFields : undefined,
      },
    },
    report: { warnings, errors },
  };
}

/** 将中立编排尽最大可能导出为 ST Prompt Manager 结构，并显式报告降级。 */
export function exportSillyTavernComposition(composition: PromptComposition): SillyTavernExportResult {
  const warnings: PromptCompositionDiagnostic[] = [];
  const errors: PromptCompositionDiagnostic[] = [];
  const prompts: Array<Record<string, unknown>> = [];
  const order: SillyTavernPromptOrderEntry[] = [];

  const sorted = composition.blocks
    .map((block, index) => ({ block, index }))
    .sort((left, right) => left.block.order - right.block.order || left.index - right.index);

  for (const { block } of sorted) {
    const identifier = block.compatibility?.originalIdentifier || block.id;
    const prompt: Record<string, unknown> = {
      identifier,
      name: block.name,
      role: block.role,
      content: block.source.type === "chat_history" ? "" : block.template,
      enabled: block.enabled,
      injection_position: block.placement.type === "in_chat" ? 1 : 0,
      injection_depth: block.placement.type === "in_chat" ? block.placement.depth : 4,
      injection_order: block.placement.type === "in_chat" ? block.placement.order ?? block.order : block.order,
    };
    if (block.compatibility?.originalFields) Object.assign(prompt, block.compatibility.originalFields);
    prompts.push(prompt);
    order.push({ identifier, enabled: block.enabled });

    if (block.condition) {
      warnings.push(warning("CONDITION_NOT_PORTABLE", `区块“${block.name}”的条件无法由 ST Prompt Manager 原样表达。`, block.id));
    }
    if (block.tokenPolicy) {
      warnings.push(warning("TOKEN_POLICY_NOT_PORTABLE", `区块“${block.name}”的 Token 策略仅保留在 Mobile Tavern。`, block.id));
    }
    if (block.source.type === "chat_history" && block.source.selection?.mode === "recent") {
      warnings.push(warning("HISTORY_SELECTION_NOT_PORTABLE", `区块“${block.name}”的独立历史选择策略无法由 ST Prompt Manager 原样表达。`, block.id));
    }
    if (block.placement.type === "in_chat" && block.placement.historyBlockId) {
      warnings.push(warning("HISTORY_TARGET_NOT_PORTABLE", `区块“${block.name}”的目标历史区块无法由 ST Prompt Manager 原样表达。`, block.id));
    }
  }

  return {
    data: {
      ...(composition.compatibility?.source === "sillytavern"
        ? composition.compatibility.preservedRootFields
        : {}),
      name: composition.name,
      prompts,
      prompt_order: [{ character_id: 100001, order }],
    },
    report: { warnings, errors },
  };
}

/**
 * 把来源预设的 Prompt 候选列表收口为应用内部传统 Prompt 块。
 *
 * 与 `importSillyTavernPreset` 共用同一套顺序与角色语义：存在 `prompt_order` 时只保留
 * 排序条目（候选库 Prompt 不进入界面列表），完全缺失时按 `prompts` 原序降级保留。
 * `marker` / `injection_*` 等自包含导入所需字段在此一次性收口，通用用例只消费结果，
 * 不反向识别来源字段（见 `COMPAT-DATA` 与 sillytavern_compat.md 第 5 节）。
 */
export function readSillyTavernPresetPrompts(input: unknown): CustomPromptBlock[] {
  const data = isRecord(input) ? input : {};
  const rawPrompts = Array.isArray(data.prompts)
    ? data.prompts
    : Array.isArray(data.customPrompts) ? data.customPrompts : [];
  const prompts = rawPrompts.filter(isRecord);
  const order = readPromptOrder(data.prompt_order ?? data.promptOrder);
  const orderByIdentifier = new Map(order.map((entry) => [entry.identifier, entry]));
  const promptByIdentifier = new Map(prompts.map((prompt, index) => [
    readLegacyPromptIdentifier(prompt, index),
    prompt,
  ]));
  const identifiers = selectOrderedPromptEntries(
    order,
    [...promptByIdentifier.keys()].map((identifier) => ({ identifier })),
  ).map((entry) => entry.identifier);

  return identifiers.map((identifier) => {
    const prompt = promptByIdentifier.get(identifier) ?? {};
    const orderEntry = orderByIdentifier.get(identifier);
    const resolvedEnabled = typeof orderEntry?.enabled === "boolean"
      ? orderEntry.enabled
      : (typeof prompt.enabled === "boolean" ? prompt.enabled : true);

    return {
      id: readStringOrUndefined(prompt.id) ?? identifier,
      identifier,
      name: readStringOrUndefined(prompt.name) ?? "导入提示词模组",
      role: resolvePromptRole(readStringOrUndefined(prompt.role)),
      content: readStringOrUndefined(prompt.content) ?? "",
      enabled: resolvedEnabled,
      marker: prompt.marker === true || undefined,
      system_prompt: typeof prompt.system_prompt === "boolean" ? prompt.system_prompt : undefined,
      injection_position: readOptionalNumber(prompt.injection_position),
      injection_depth: readOptionalNumber(prompt.injection_depth),
      injection_order: readOptionalNumber(prompt.injection_order),
      forbid_overrides: typeof prompt.forbid_overrides === "boolean" ? prompt.forbid_overrides : undefined,
      injection_trigger: readOptionalStringArray(prompt.injection_trigger),
    };
  });
}

/**
 * SillyTavern Prompt 预设 Codec 的唯一定义。
 *
 * 受信 Runtime Plugin、预设样例验收工具与夹具都复用同一份来源语义与容器 wiring，
 * 避免各处自行拼装导致顺序、分级或字段收口漂移（见 `COMPAT-DATA`）。
 */
export const sillyTavernPromptPresetCodec: CompatibilityCodecDefinition = {
  id: "compat.sillytavern.codec.prompt-preset",
  version: "1.0.0",
  format: "sillytavern.prompt-preset",
  canDecode(input) {
    return analyzeSillyTavernPreset(input).level !== "invalid";
  },
  analyze: analyzeSillyTavernPreset,
  decode: importSillyTavernPreset,
  readPresetPrompts: readSillyTavernPresetPrompts,
  encode(input) {
    return exportSillyTavernComposition(parsePromptComposition(input));
  },
};

function convertPrompt(
  prompt: Record<string, unknown>,
  identifier: string,
  index: number,
  orderEnabled: boolean | undefined,
  warnings: PromptCompositionDiagnostic[],
  usedBlockIds: Set<string>
): PromptBlock {
  const originalFields = pickUnknownFields(prompt, PROMPT_KNOWN_FIELDS);
  const unknownFieldNames = Object.keys(originalFields).filter(
    (field) => !PROMPT_RECOGNIZED_PRESERVED_FIELDS.has(field),
  );
  if (unknownFieldNames.length > 0) {
    warnings.push(warning("PRESERVED_UNKNOWN_FIELDS", `Prompt“${identifier}”的未知字段已隔离保留。`));
  }
  const rawRole = readOptionalString(prompt.role);
  const role = resolvePromptRole(rawRole);
  if (rawRole && rawRole !== role && rawRole !== "model") {
    warnings.push(warning("INVALID_ROLE_FALLBACK", `Prompt“${identifier}”的角色无效，已降级为 system。`));
  }
  const source = HISTORY_IDENTIFIERS.has(identifier)
    ? { type: "chat_history" as const, selection: { mode: "all" as const } }
    : { type: "template" as const };
  const rawContent = readOptionalString(prompt.content ?? prompt.system_prompt);
  const template = source.type === "chat_history"
    ? ""
    : rawContent || KNOWN_SOURCE_MACROS[identifier] || "";
  let enabled = typeof orderEnabled === "boolean"
    ? orderEnabled
    : (typeof prompt.enabled === "boolean" ? prompt.enabled : true);
  if (!template && source.type !== "chat_history" && !KNOWN_SOURCE_MACROS[identifier]) {
    enabled = false;
    warnings.push(warning("UNMAPPED_EMPTY_PROMPT", `Prompt“${identifier}”没有内容且不是已知数据源，已作为停用区块保留。`));
  }

  const baseId = `st_${createSafeId(identifier || String(index + 1))}`;
  let id = baseId;
  let suffix = 2;
  while (usedBlockIds.has(id)) id = `${baseId}_${suffix++}`;
  usedBlockIds.add(id);

  const injectionPosition = prompt.injection_position ?? prompt.position;
  const isInChat = injectionPosition === 1 || injectionPosition === "in_chat" || injectionPosition === "In-Chat";
  const depth = readFiniteNumber(prompt.injection_depth ?? prompt.depth, 0);
  const injectionOrder = readFiniteNumber(prompt.injection_order, index * 100);

  return {
    id,
    name: readOptionalString(prompt.name) || identifier,
    enabled,
    role,
    source,
    template,
    order: index * 100,
    placement: isInChat
      ? { type: "in_chat", depth: Math.max(0, Math.floor(depth)), order: injectionOrder }
      : { type: "ordered" },
    compatibility: {
      source: "sillytavern",
      originalIdentifier: identifier,
      originalFields: Object.keys(originalFields).length ? originalFields : undefined,
    },
  };
}

/**
 * ST Prompt Manager 顺序语义的唯一实现：存在 `prompt_order` 时只保留排序条目
 * （未排序的候选 Prompt 仅存在于候选库、不进入管理器列表），完全缺失时按来源
 * `prompts` 原序降级保留，避免静默丢失无排序预设的内容。
 */
function selectOrderedPromptEntries(
  order: readonly SillyTavernPromptOrderEntry[],
  fallback: readonly SillyTavernPromptOrderEntry[],
): readonly SillyTavernPromptOrderEntry[] {
  return order.length > 0 ? order : fallback;
}

/** ST 的 `model` 角色等价于 assistant；只识别 system/user/assistant，其余降级为 system。 */
function resolvePromptRole(rawRole: string | undefined): PromptMessageRole {
  if (rawRole === "model") return "assistant";
  return rawRole === "user" || rawRole === "assistant" || rawRole === "system" ? rawRole : "system";
}

function readPromptOrder(value: unknown): SillyTavernPromptOrderEntry[] {
  if (!Array.isArray(value)) return [];

  const containers = value.filter((item) => isRecord(item) && Array.isArray(item.order));
  if (containers.length > 0) {
    const container = containers.find((item) =>
      isRecord(item) && (item.character_id === 100001 || item.character_id === "100001") && Array.isArray(item.order) && item.order.length > 0
    ) ?? containers.find((item) =>
      isRecord(item) && (item.character_id === 100001 || item.character_id === "100001")
    ) ?? containers.find((item) =>
      isRecord(item) && Array.isArray(item.order) && item.order.length > 0
    ) ?? containers[0];

    if (!isRecord(container) || !Array.isArray(container.order)) return [];
    return normalizeOrderEntries(container.order);
  }

  return normalizeOrderEntries(value);
}

function normalizeOrderEntries(entries: unknown[]): SillyTavernPromptOrderEntry[] {
  return entries
    .filter(isRecord)
    .map((item) => ({
      identifier: readOptionalString(item.identifier),
      enabled: typeof item.enabled === "boolean" ? item.enabled : undefined,
    }))
    .filter((item) => item.identifier);
}

function readRecordCollection(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value)) return Object.values(value).filter(isRecord);
  return [];
}

function addRootPrompt(
  prompts: Map<string, Record<string, unknown>>,
  identifier: string,
  value: unknown,
  name: string
): void {
  const content = readOptionalString(value);
  if (!content || prompts.has(identifier)) return;
  prompts.set(identifier, { identifier, name, role: "system", content, enabled: true });
}

function getIdentifier(prompt: Record<string, unknown>, index: number): string {
  return readOptionalString(prompt.identifier ?? prompt.id) || `prompt_${index + 1}`;
}

/**
 * 传统 Prompt 列表的历史标识符推导：只接受字符串 `identifier`，其次字符串 `id`，
 * 最后按下标兜底。
 *
 * 与编排路径的 `getIdentifier` 有意区分：后者把空串或非字符串 `identifier` 也回落到
 * `prompt_N`，而传统列表历史上保留空串/改用字符串 `id`；单点化不得改变既有导入结果
 * （`CHANGE-SAFE`）。两者共享的是顺序容器、候选库丢弃与角色别名语义。
 */
function readLegacyPromptIdentifier(prompt: Record<string, unknown>, index: number): string {
  return readStringOrUndefined(prompt.identifier)
    ?? readStringOrUndefined(prompt.id)
    ?? `prompt_${index + 1}`;
}

function pickUnknownFields(
  value: Record<string, unknown>,
  knownFields: ReadonlySet<string>
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !knownFields.has(key) && key !== "__proto__" && key !== "prototype" && key !== "constructor"
  ));
}

function warning(code: string, message: string, blockId?: string): PromptCompositionDiagnostic {
  return { level: "warning", code, message, blockId };
}

function readOptionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 原样保留空字符串，只把非字符串视为未提供（与 `readOptionalString` 的空串兜底语义区分）。 */
function readStringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readOptionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function createSafeId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "imported";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
