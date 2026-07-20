import type { ChatSession } from "../../types";

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
