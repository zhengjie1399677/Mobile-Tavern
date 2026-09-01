import type { AgentToolExecutionContext } from "../../domain/agents/contracts";
import type { ToolPluginHostCapability } from "../../domain/toolPlugins";
import type { MemoryServiceTyped } from "../services/memory";

export interface ToolPluginHostCapabilityExecution {
  readonly capability: ToolPluginHostCapability;
  readonly input: unknown;
  readonly context: AgentToolExecutionContext;
  readonly memory: MemoryServiceTyped;
  readonly now?: () => number;
}

export async function executeToolPluginHostCapability(
  execution: ToolPluginHostCapabilityExecution,
): Promise<unknown> {
  switch (execution.capability) {
    case "memory.write":
      return executeMemoryWrite(execution);
  }
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
