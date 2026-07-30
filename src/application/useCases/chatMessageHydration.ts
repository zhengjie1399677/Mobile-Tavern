import type { Message } from "../../types";

interface StoredChatMessage {
  id: string;
  role?: string;
  content: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

/** 将存储层“最新优先”的消息页投影成界面所需的时间正序。 */
export function hydrateNewestFirstMessagePage(
  records: StoredChatMessage[],
): Message[] {
  return records
    .slice()
    .reverse()
    .map((record) => ({
      id: record.id,
      sender:
        record.role === "user"
          ? "user"
          : record.role === "system"
            ? "system"
            : "assistant",
      content: record.content,
      timestamp: record.createdAt,
      extra: record.metadata,
    }));
}
