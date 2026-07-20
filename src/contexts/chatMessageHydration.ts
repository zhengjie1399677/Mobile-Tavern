import type { Message } from "../types";

interface StoredChatMessage {
  id: string;
  role?: string;
  content: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * 将存储层按“最新优先”读取的分页结果转换为界面使用的时间正序消息。
 *
 * `descending: true` 只负责让 IndexedDB 高效定位最新一页；聊天界面始终
 * 使用从旧到新的数组。该转换保留在 Context 适配层，避免把展示顺序语义
 * 反向污染记忆存储端口。
 */
export function hydrateNewestFirstMessagePage(
  records: StoredChatMessage[]
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
