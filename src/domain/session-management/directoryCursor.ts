import type { ChatSession } from "../../types";
import type {
  FavoriteSessionBackupMetadata,
  SessionDirectoryCategory,
  SessionDirectoryCursor,
  SessionDirectorySort,
} from "./contracts";

/**
 * 会话目录排序值与稳定游标的单一来源。
 *
 * Application Service、会话存储与收藏备份存储共用同一套比较与游标构造逻辑，
 * 避免 `(sortKey, id)` 分页语义在多处复制后漂移。游标必须绑定当前排序，
 * 同排序值按 id 打破，保证分页期间新增记录不跳项、不重复。
 */

export function getSessionSortValue(
  session: Pick<ChatSession, "createdAt" | "updatedAt" | "title" | "turnCount">,
  sort: SessionDirectorySort,
): number | string {
  if (sort === "created_asc" || sort === "created_desc") return session.createdAt;
  if (sort === "title_asc") return session.title;
  if (sort === "turns_desc") return session.turnCount ?? 0;
  return session.updatedAt ?? session.createdAt;
}

export function getBackupMetadataSortValue(
  metadata: Pick<FavoriteSessionBackupMetadata, "createdAt" | "updatedAt" | "title" | "messageCount">,
  sort: SessionDirectorySort,
): number | string {
  if (sort === "created_asc" || sort === "created_desc") return metadata.createdAt;
  if (sort === "title_asc") return metadata.title;
  if (sort === "turns_desc") return metadata.messageCount;
  return metadata.updatedAt;
}

export function compareDirectoryValues(left: number | string, right: number | string): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  const leftText = String(left);
  const rightText = String(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}

export function toSessionDirectoryCursor(
  session: Pick<ChatSession, "createdAt" | "updatedAt" | "title" | "turnCount" | "id">,
  sort: SessionDirectorySort,
  category?: SessionDirectoryCategory,
): SessionDirectoryCursor {
  return {
    ...(category ? { category } : {}),
    sort,
    value: getSessionSortValue(session, sort),
    createdAt: session.createdAt,
    id: session.id,
  };
}

export function toBackupMetadataCursor(
  metadata: Pick<FavoriteSessionBackupMetadata, "createdAt" | "updatedAt" | "title" | "messageCount" | "id">,
  sort: SessionDirectorySort,
): SessionDirectoryCursor {
  return {
    sort,
    value: getBackupMetadataSortValue(metadata, sort),
    createdAt: metadata.createdAt,
    id: metadata.id,
  };
}
