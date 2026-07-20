import type {
  PromptBlock,
  PromptBlockCondition,
  PromptBlockPlacement,
  PromptBlockSource,
  PromptComposition,
  PromptMessageRole,
} from "./types";

const MAX_BLOCKS = 200;
const MAX_NAME_LENGTH = 120;
const MAX_TEMPLATE_LENGTH = 100_000;
const ROLES: PromptMessageRole[] = ["system", "user", "assistant"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 外部原生编排包的唯一防腐入口。 */
export function parsePromptComposition(input: string | unknown): PromptComposition {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      throw new Error("PROMPT_COMPOSITION_INVALID_JSON");
    }
  }
  if (!isRecord(value) || value.version !== 1) throw new Error("PROMPT_COMPOSITION_UNSUPPORTED_VERSION");
  const id = readString(value.id, "PROMPT_COMPOSITION_INVALID_ID", MAX_NAME_LENGTH);
  const name = readString(value.name, "PROMPT_COMPOSITION_INVALID_NAME", MAX_NAME_LENGTH);
  if (!Array.isArray(value.blocks) || value.blocks.length > MAX_BLOCKS) {
    throw new Error("PROMPT_COMPOSITION_INVALID_BLOCKS");
  }
  const ids = new Set<string>();
  const blocks = value.blocks.map((block, index) => {
    const parsed = parseBlock(block, index);
    if (ids.has(parsed.id)) throw new Error("PROMPT_COMPOSITION_DUPLICATE_BLOCK_ID");
    ids.add(parsed.id);
    return parsed;
  });
  return { id, name, version: 1, blocks };
}

export function serializePromptComposition(composition: PromptComposition): string {
  return JSON.stringify(composition, null, 2);
}

function parseBlock(value: unknown, index: number): PromptBlock {
  if (!isRecord(value)) throw new Error("PROMPT_COMPOSITION_INVALID_BLOCK");
  const role = value.role;
  if (typeof role !== "string" || !ROLES.includes(role as PromptMessageRole)) {
    throw new Error("PROMPT_COMPOSITION_INVALID_ROLE");
  }
  if (typeof value.enabled !== "boolean") throw new Error("PROMPT_COMPOSITION_INVALID_ENABLED");
  const order = readFiniteNumber(value.order, index * 100);
  return {
    id: readString(value.id, "PROMPT_COMPOSITION_INVALID_BLOCK_ID", MAX_NAME_LENGTH),
    name: readString(value.name, "PROMPT_COMPOSITION_INVALID_BLOCK_NAME", MAX_NAME_LENGTH),
    enabled: value.enabled,
    role: role as PromptMessageRole,
    source: parseSource(value.source),
    template: readOptionalString(value.template, MAX_TEMPLATE_LENGTH),
    order,
    placement: parsePlacement(value.placement),
    condition: value.condition === undefined ? undefined : parseCondition(value.condition),
    tokenPolicy: parseTokenPolicy(value.tokenPolicy),
  };
}

function parseSource(value: unknown): PromptBlockSource {
  if (!isRecord(value) || (value.type !== "template" && value.type !== "chat_history")) {
    throw new Error("PROMPT_COMPOSITION_INVALID_SOURCE");
  }
  if (value.type === "template") return { type: "template" };
  if (value.selection === undefined) return { type: "chat_history" };
  if (!isRecord(value.selection) || (value.selection.mode !== "all" && value.selection.mode !== "recent")) {
    throw new Error("PROMPT_COMPOSITION_INVALID_HISTORY_SELECTION");
  }
  if (value.selection.mode === "all") {
    return { type: "chat_history", selection: { mode: "all" } };
  }
  if (typeof value.selection.preserveFirstAssistant !== "boolean") {
    throw new Error("PROMPT_COMPOSITION_INVALID_HISTORY_SELECTION");
  }
  return {
    type: "chat_history",
    selection: {
      mode: "recent",
      count: Math.max(0, Math.floor(readFiniteNumber(value.selection.count, 0))),
      preserveFirstAssistant: value.selection.preserveFirstAssistant,
    },
  };
}

function parsePlacement(value: unknown): PromptBlockPlacement {
  if (!isRecord(value)) throw new Error("PROMPT_COMPOSITION_INVALID_PLACEMENT");
  if (value.type === "ordered") return { type: "ordered" };
  if (value.type !== "in_chat") throw new Error("PROMPT_COMPOSITION_INVALID_PLACEMENT");
  return {
    type: "in_chat",
    depth: Math.max(0, Math.floor(readFiniteNumber(value.depth, 0))),
    order: value.order === undefined ? undefined : readFiniteNumber(value.order, 0),
    historyBlockId: value.historyBlockId === undefined
      ? undefined
      : readString(value.historyBlockId, "PROMPT_COMPOSITION_INVALID_HISTORY_TARGET", MAX_NAME_LENGTH),
  };
}

function parseCondition(value: unknown): PromptBlockCondition {
  if (!isRecord(value)) throw new Error("PROMPT_COMPOSITION_INVALID_CONDITION");
  if (value.operator !== "not_empty" && value.operator !== "empty" && value.operator !== "equals" && value.operator !== "not_equals") {
    throw new Error("PROMPT_COMPOSITION_INVALID_CONDITION");
  }
  return {
    dataKey: readString(value.dataKey, "PROMPT_COMPOSITION_INVALID_CONDITION_KEY", MAX_NAME_LENGTH),
    operator: value.operator,
    value: value.value === undefined ? undefined : readOptionalString(value.value, MAX_TEMPLATE_LENGTH),
  };
}

function parseTokenPolicy(value: unknown): PromptBlock["tokenPolicy"] {
  if (value === undefined) return undefined;
  if (!isRecord(value) || (value.overflow !== "keep" && value.overflow !== "drop")) {
    throw new Error("PROMPT_COMPOSITION_INVALID_TOKEN_POLICY");
  }
  return { priority: readFiniteNumber(value.priority, 50), overflow: value.overflow };
}

function readString(value: unknown, error: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) throw new Error(error);
  return value.trim();
}

function readOptionalString(value: unknown, maxLength: number): string {
  if (typeof value !== "string" || value.length > maxLength) throw new Error("PROMPT_COMPOSITION_INVALID_TEXT");
  return value;
}

function readFiniteNumber(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("PROMPT_COMPOSITION_INVALID_NUMBER");
  return value;
}
