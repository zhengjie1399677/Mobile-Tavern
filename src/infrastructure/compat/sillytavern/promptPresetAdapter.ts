import type {
  CompatibilityReport,
  PromptBlock,
  PromptComposition,
  PromptCompositionDiagnostic,
  PromptMessageRole,
} from "../../../domain/prompt-composition";

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

  const identifiers = [
    ...order.map((item) => item.identifier),
    ...[...promptByIdentifier.keys()].filter((identifier) => !order.some((item) => item.identifier === identifier)),
  ];
  const usedBlockIds = new Set<string>();
  const blocks: PromptBlock[] = [];

  identifiers.forEach((identifier, index) => {
    const prompt = promptByIdentifier.get(identifier) ?? { identifier, name: identifier, enabled: false };
    const orderEntry = order.find((item) => item.identifier === identifier);
    const block = convertPrompt(prompt, identifier, index, orderEntry?.enabled, warnings, usedBlockIds);
    blocks.push(block);
  });

  const preservedRootFields = pickUnknownFields(input, ROOT_KNOWN_FIELDS);
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
        sourceVersion: readOptionalString(input.version),
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

function convertPrompt(
  prompt: Record<string, unknown>,
  identifier: string,
  index: number,
  orderEnabled: boolean | undefined,
  warnings: PromptCompositionDiagnostic[],
  usedBlockIds: Set<string>
): PromptBlock {
  const originalFields = pickUnknownFields(prompt, PROMPT_KNOWN_FIELDS);
  if (Object.keys(originalFields).length > 0) {
    warnings.push(warning("PRESERVED_UNKNOWN_FIELDS", `Prompt“${identifier}”的未知字段已隔离保留。`));
  }
  const rawRole = readOptionalString(prompt.role);
  const role: PromptMessageRole = rawRole === "user" || rawRole === "assistant" || rawRole === "system"
    ? rawRole
    : "system";
  if (rawRole && rawRole !== role) {
    warnings.push(warning("INVALID_ROLE_FALLBACK", `Prompt“${identifier}”的角色无效，已降级为 system。`));
  }
  const source = HISTORY_IDENTIFIERS.has(identifier)
    ? { type: "chat_history" as const, selection: { mode: "all" as const } }
    : { type: "template" as const };
  const rawContent = readOptionalString(prompt.content ?? prompt.system_prompt);
  const template = source.type === "chat_history"
    ? ""
    : rawContent || KNOWN_SOURCE_MACROS[identifier] || "";
  let enabled = orderEnabled ?? (prompt.enabled !== false);
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

function readPromptOrder(value: unknown): SillyTavernPromptOrderEntry[] {
  if (!Array.isArray(value)) return [];
  const container = value.find((item) => isRecord(item) && Array.isArray(item.order));
  if (!isRecord(container) || !Array.isArray(container.order)) return [];
  return container.order
    .filter(isRecord)
    .map((item) => ({ identifier: readOptionalString(item.identifier), enabled: item.enabled !== false }))
    .filter((item) => item.identifier);
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

function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function createSafeId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "imported";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
