import type { AgentToolExecutionContext } from "../../domain/agents/contracts";
import type { ToolPluginHostCapability } from "../../domain/toolPlugins";
import type { MemoryServiceTyped } from "../services/memory";

export interface ToolPluginHostCapabilityExecution {
  readonly capability: ToolPluginHostCapability;
  readonly input: unknown;
  readonly context: AgentToolExecutionContext;
  readonly memory: MemoryServiceTyped;
  readonly now?: () => number;
  readonly locale?: string;
  readonly timeZone?: string;
  /** [0, 1) 随机源，缺省回退 Math.random；仅用于无副作用随机能力，便于测试注入。 */
  readonly random?: () => number;
}

export async function executeToolPluginHostCapability(
  execution: ToolPluginHostCapabilityExecution,
): Promise<unknown> {
  switch (execution.capability) {
    case "memory.write":
      return executeMemoryWrite(execution);
    case "system.time":
      return executeSystemTime(execution);
    case "random.dice":
      return executeRandomDice(execution);
    case "random.coin":
      return executeRandomCoin(execution);
    case "random.pick":
      return executeRandomPick(execution);
    case "text.count":
      return executeTextCount(execution);
  }
}

function executeSystemTime(
  execution: ToolPluginHostCapabilityExecution,
): { text: string } {
  assertNotAborted(execution.context.signal);
  const date = new Date(execution.now?.() ?? Date.now());
  const locale = execution.locale ?? globalThis.navigator?.language ?? "zh-CN";
  const timeZone = (execution.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC";
  const dateText = new Intl.DateTimeFormat(locale, {
    timeZone,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
  const timeText = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
  return { text: `📅 ${dateText}\n🕒 ${timeText} · ${timeZone}` };
}

function executeRandomDice(
  execution: ToolPluginHostCapabilityExecution,
): { text: string } {
  assertNotAborted(execution.context.signal);
  const input = parseDiceExpression(execution.input);
  const random = execution.random ?? Math.random;
  const rolls: number[] = [];
  for (let i = 0; i < input.count; i += 1) {
    rolls.push(1 + Math.floor(random() * input.sides));
  }
  const total = rolls.reduce((sum, value) => sum + value, 0) + input.modifier;
  return { text: `🎲 ${input.expression} = [${rolls.join(", ")}] → ${total}` };
}

interface DiceExpression {
  readonly expression: string;
  readonly count: number;
  readonly sides: number;
  readonly modifier: number;
}

function parseDiceExpression(input: unknown): DiceExpression {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("TOOL_PLUGIN_DICE_INPUT_INVALID");
  }
  const value = input as Record<string, unknown>;
  if (typeof value.expression !== "string") throw new Error("TOOL_PLUGIN_DICE_INPUT_INVALID");
  const expression = value.expression.trim();
  const match = /^(\d{1,3})d(\d{1,4})([+-]\d{1,6})?$/i.exec(expression);
  if (!match) throw new Error("TOOL_PLUGIN_DICE_INPUT_INVALID");
  const count = Number(match[1]);
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(match[3]) : 0;
  if (count < 1 || count > 100 || sides < 2 || sides > 1000) {
    throw new Error("TOOL_PLUGIN_DICE_INPUT_INVALID");
  }
  return { expression, count, sides, modifier };
}

function executeRandomCoin(
  execution: ToolPluginHostCapabilityExecution,
): { text: string } {
  assertNotAborted(execution.context.signal);
  const random = execution.random ?? Math.random;
  return { text: random() < 0.5 ? "🪙 正面" : "🪙 反面" };
}

function executeRandomPick(
  execution: ToolPluginHostCapabilityExecution,
): { text: string } {
  assertNotAborted(execution.context.signal);
  const options = parsePickOptions(execution.input);
  const random = execution.random ?? Math.random;
  const picked = options[Math.floor(random() * options.length)];
  return { text: `🎯 从 ${options.length} 个选项抽中：${picked}` };
}

function parsePickOptions(input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("TOOL_PLUGIN_PICK_INPUT_INVALID");
  }
  const value = input as Record<string, unknown>;
  if (typeof value.options !== "string") throw new Error("TOOL_PLUGIN_PICK_INPUT_INVALID");
  const options = [...new Set(
    value.options.split(/[,，、;；\n]/).map((item) => item.trim()).filter(Boolean),
  )];
  if (options.length < 2 || options.length > 100) throw new Error("TOOL_PLUGIN_PICK_INPUT_INVALID");
  return options;
}

function executeTextCount(
  execution: ToolPluginHostCapabilityExecution,
): { text: string } {
  assertNotAborted(execution.context.signal);
  const text = parseTextInput(execution.input);
  const chars = [...text].length;
  const nonSpace = [...text.replace(/\s/g, "")].length;
  const han = [...text].filter((char) => /\p{Script=Han}/u.test(char)).length;
  const lines = text.length === 0 ? 0 : text.split(/\r?\n/).length;
  return { text: `字符 ${chars}（含空白）· 非空白 ${nonSpace} · 汉字 ${han} · 行 ${lines}` };
}

function parseTextInput(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("TOOL_PLUGIN_TEXT_INPUT_INVALID");
  }
  const value = input as Record<string, unknown>;
  if (typeof value.text !== "string") throw new Error("TOOL_PLUGIN_TEXT_INPUT_INVALID");
  return value.text;
}

async function executeMemoryWrite(
  execution: ToolPluginHostCapabilityExecution,
): Promise<{ id: string; status: "active"; sourceMessageId: string }> {
  assertNotAborted(execution.context.signal);
  const input = parseMemoryWriteInput(execution.input);
  const storage = execution.memory.getStorage();
  const [source] = await storage.getMessagesBySession(execution.context.sessionId, {
    limit: 1,
    descending: true,
  });
  if (!source) throw new Error("TOOL_PLUGIN_MEMORY_SOURCE_NOT_FOUND");
  assertNotAborted(execution.context.signal);

  const id = await createMemoryWriteId(execution.context.sessionId, execution.context.callId);
  const existing = await storage.getFragmentById(id);
  assertNotAborted(execution.context.signal);
  const now = execution.now?.() ?? Date.now();
  await storage.upsertFragment({
    id,
    sessionId: execution.context.sessionId,
    content: input.content,
    participants: input.participants,
    tags: input.tags,
    sourceMessageIds: [source.id],
    sourceRole: source.role,
    sourceTurnStart: source.turnIndex,
    sourceTurnEnd: source.turnIndex,
    status: "active",
    importance: input.importance,
    confidence: 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }, true, execution.context.signal);
  execution.memory.getRecall().invalidateCache(execution.context.sessionId);
  return { id, status: "active", sourceMessageId: source.id };
}

interface MemoryWriteInput {
  readonly content: string;
  readonly participants: string[];
  readonly tags: string[];
  readonly importance: number;
}

function parseMemoryWriteInput(input: unknown): MemoryWriteInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("TOOL_PLUGIN_MEMORY_INPUT_INVALID");
  }
  const value = input as Record<string, unknown>;
  const content = typeof value.content === "string" ? value.content.trim() : "";
  const participants = normalizeStringList(value.participants, 16);
  const tags = normalizeStringList(value.tags, 24);
  if (
    !content
    || content.length > 2_000
    || tags.length === 0
    || typeof value.importance !== "number"
    || !Number.isFinite(value.importance)
    || value.importance < 0
    || value.importance > 1
  ) {
    throw new Error("TOOL_PLUGIN_MEMORY_INPUT_INVALID");
  }
  return { content, participants, tags, importance: value.importance };
}

function normalizeStringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value) || value.length > limit || value.some((item) => typeof item !== "string")) {
    throw new Error("TOOL_PLUGIN_MEMORY_INPUT_INVALID");
  }
  const normalized = [...new Set(value.map((item) => item.trim()).filter(Boolean))];
  if (normalized.some((item) => item.length > 120)) throw new Error("TOOL_PLUGIN_MEMORY_INPUT_INVALID");
  return normalized;
}

async function createMemoryWriteId(sessionId: string, callId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${sessionId}\0${callId}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `tool-memory:${[...digest].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error("TOOL_PLUGIN_HOST_CAPABILITY_ABORTED");
}
