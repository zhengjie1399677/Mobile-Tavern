import type { ChatSession } from "../../types";

export type SessionStorageRecord = Omit<ChatSession, "messages"> & {
  /** v8 以前的记录可能仍残留内嵌消息；读取时不得将其当作权威消息源。 */
  messages?: ChatSession["messages"];
};

/**
 * 将内存会话转换为 sessions Store 的轻量记录。
 * messages 始终物理分轨到 messages Store，禁止写回会话主记录。
 */
export function toSessionStorageRecord(session: ChatSession): Omit<ChatSession, "messages"> {
  const { messages, ...record } = session;
  const userMessageCount = messages.filter((message) => message.sender === "user").length;

  record.turnCount = userMessageCount > 0
    ? userMessageCount
    : messages.length > 1
      ? Math.floor(messages.length / 2)
      : messages.length > 0
        ? 1
        : 0;
  record.charCount = messages.reduce(
    (total, message) => total + (message.content?.length || 0),
    0
  );

  return record;
}

/**
 * 将 sessions Store 记录投影为应用会话。
 * messages Store 是消息的单一来源，因此无条件丢弃旧记录中残留的内嵌消息切片。
 */
export function fromSessionStorageRecord(record: SessionStorageRecord): ChatSession {
  const { messages: _legacyMessages, ...metadata } = record;
  return {
    ...metadata,
    messages: [],
    summaries: Array.isArray(metadata.summaries) ? metadata.summaries : [],
  };
}

/** 清除旧记录的内嵌消息字段，供原子元数据更新顺带完成读修复。 */
export function stripLegacySessionMessages(
  record: SessionStorageRecord,
): Omit<ChatSession, "messages"> {
  const { messages: _legacyMessages, ...metadata } = record;
  return metadata;
}
