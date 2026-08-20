import type { ChatSession, ChatSessionMetadata, Message } from "../../types";

export interface SessionMessageStats {
  messageCount: number;
  userMessageCount: number;
  turnCount: number;
  charCount: number;
}

export type SessionStorageRecord = ChatSessionMetadata & {
  /** v8 以前的记录可能仍残留内嵌消息；读取时不得将其当作权威消息源。 */
  messages?: ChatSession["messages"];
  /** 内部计数基线，只由 messages Store 的事务维护。 */
  messageCount?: number;
  userMessageCount?: number;
};

export function calculateSessionMessageStats(
  messages: ReadonlyArray<Pick<Message, "sender" | "content">>,
): SessionMessageStats {
  const messageCount = messages.length;
  const userMessageCount = messages.reduce(
    (total, message) => total + (message.sender === "user" ? 1 : 0),
    0,
  );
  return {
    messageCount,
    userMessageCount,
    turnCount: deriveTurnCount(messageCount, userMessageCount),
    charCount: messages.reduce(
      (total, message) => total + (message.content?.length ?? 0),
      0,
    ),
  };
}

export function deriveTurnCount(messageCount: number, userMessageCount: number): number {
  if (userMessageCount > 0) return userMessageCount;
  if (messageCount > 1) return Math.floor(messageCount / 2);
  return messageCount > 0 ? 1 : 0;
}

/**
 * 将内存会话转换为 sessions Store 的轻量记录。
 * messages 始终物理分轨到 messages Store，禁止写回会话主记录。
 */
export function toSessionStorageRecord(
  session: ChatSession | ChatSessionMetadata,
): ChatSessionMetadata {
  if ("messages" in session) {
    const { messages: _messages, ...record } = session;
    return record;
  }
  return { ...session };
}

/**
 * 将 sessions Store 记录投影为应用会话。
 * messages Store 是消息的单一来源，因此无条件丢弃旧记录中残留的内嵌消息切片。
 */
export function fromSessionStorageRecord(record: SessionStorageRecord): ChatSession {
  const {
    messages: _legacyMessages,
    messageCount: _messageCount,
    userMessageCount: _userMessageCount,
    ...metadata
  } = record;
  return {
    ...metadata,
    messages: [],
    summaries: Array.isArray(metadata.summaries) ? metadata.summaries : [],
  };
}

/** 清除旧记录的内嵌消息字段，供原子元数据更新顺带完成读修复。 */
export function stripLegacySessionMessages(
  record: SessionStorageRecord,
): SessionStorageRecord {
  const { messages: _legacyMessages, ...metadata } = record;
  return metadata;
}
