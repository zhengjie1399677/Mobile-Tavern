import type { Message } from "../../types";

export type StoredMessageRole = Message["sender"];

/**
 * messages Store 的权威记录格式。
 *
 * `metadata` 对应领域消息的 `extra`；其余会影响重启后展示、重生成或变量恢复的
 * 字段均独立保存，避免不同写入路径各自挑选字段而造成静默丢失。
 */
export interface StoredChatMessageRecord {
  id: string;
  sessionId: string;
  role: StoredMessageRole;
  content: string;
  createdAt: number;
  turnIndex: number;
  tags: string[];
  extractSource: "llm" | "dict" | "none";
  metadata?: Record<string, unknown>;
  isSummaryLine?: boolean;
  generationTime?: number;
  tokenCount?: number;
  promptTokenCount?: number;
  reasoningContent?: string;
  swipes?: string[];
  swipe_id?: number;
  variables?: Record<string, unknown>;
}

export type PersistableMessage = Message & {
  turnIndex?: number;
  tags?: string[];
  extractSource?: StoredChatMessageRecord["extractSource"];
  metadata?: Record<string, unknown>;
};

export function normalizeStoredMessageRole(role: unknown): StoredMessageRole {
  if (role === "user" || role === "system") return role;
  return "assistant";
}

export function toStoredMessageRecord(
  sessionId: string,
  message: PersistableMessage,
  turnIndex: number,
): StoredChatMessageRecord {
  return {
    id: message.id,
    sessionId,
    role: normalizeStoredMessageRole(message.sender),
    content: message.content,
    createdAt: message.timestamp || Date.now(),
    turnIndex,
    tags: message.tags ?? [],
    extractSource: message.extractSource ?? "none",
    metadata: message.metadata ?? message.extra,
    isSummaryLine: message.isSummaryLine,
    generationTime: message.generationTime,
    tokenCount: message.tokenCount,
    promptTokenCount: message.promptTokenCount,
    reasoningContent: message.reasoningContent,
    swipes: message.swipes,
    swipe_id: message.swipe_id,
    variables: message.variables,
  };
}

export function fromStoredMessageRecord(record: StoredChatMessageRecord): Message {
  return {
    id: record.id,
    sender: normalizeStoredMessageRole(record.role),
    content: record.content,
    timestamp: record.createdAt,
    extra: record.metadata,
    isSummaryLine: record.isSummaryLine,
    generationTime: record.generationTime,
    tokenCount: record.tokenCount,
    promptTokenCount: record.promptTokenCount,
    reasoningContent: record.reasoningContent,
    swipes: record.swipes,
    swipe_id: record.swipe_id,
    variables: record.variables,
    turnIndex: record.turnIndex,
    tags: record.tags,
    extractSource: record.extractSource,
    metadata: record.metadata,
  };
}
