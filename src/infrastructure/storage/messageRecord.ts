import type { Message } from "../../types";
import {
  getMessageContentText,
  normalizeMessageContentParts,
  replaceMessageText,
  type MessageContentPart,
} from "../../domain/messages/messageContent";

export type StoredMessageRole = Message["sender"];

/**
 * messages Store 的权威记录格式。
 *
 * `metadata` 对应领域消息的 `extra`；其余会影响重启后展示、重生成或变量恢复的
 * 字段均独立保存，避免不同写入路径各自挑选字段而造成静默丢失。
 */
interface StoredChatMessageRecordBase {
  id: string;
  sessionId: string;
  role: StoredMessageRole;
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

export type StoredChatMessageRecord = StoredChatMessageRecordBase & (
  | {
      /** 缺失兼容历史 V1 记录。 */
      contentVersion?: 1;
      content: string;
    }
  | {
      contentVersion: 2;
      /** V2 只保存 Content Parts，不并列保存派生文本。 */
      content: MessageContentPart[];
    }
);

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
  const base: StoredChatMessageRecordBase = {
    id: message.id,
    sessionId,
    role: normalizeStoredMessageRole(message.sender),
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

  if (message.contentVersion === 2 || message.parts !== undefined) {
    const normalized = normalizeMessageContentParts(message.parts ?? [
      { type: "text", text: message.content },
    ]);
    const content = getMessageContentText(normalized) === message.content
      ? normalized
      : replaceMessageText(normalized, message.content);
    return { ...base, contentVersion: 2, content };
  }
  return { ...base, content: message.content };
}

export function fromStoredMessageRecord(record: StoredChatMessageRecord): Message {
  const parts = record.contentVersion === 2
    ? normalizeMessageContentParts(record.content)
    : undefined;
  const textContent = record.contentVersion === 2
    ? getMessageContentText(parts!)
    : record.content;
  return {
    id: record.id,
    sender: normalizeStoredMessageRole(record.role),
    content: textContent,
    contentVersion: parts ? 2 : undefined,
    parts,
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

/** 所有旧统计、Prompt 与记忆消费者统一通过这里读取纯文本投影。 */
export function getStoredMessageText(record: StoredChatMessageRecord): string {
  return record.contentVersion === 2
    ? getMessageContentText(record.content)
    : record.content;
}
