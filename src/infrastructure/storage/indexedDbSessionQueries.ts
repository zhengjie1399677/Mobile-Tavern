import type { ChatSession } from "../../types";
import type {
  SessionDirectoryCursor,
  SessionDirectorySort,
} from "../../domain/session-management";
import {
  compareDirectoryValues,
  getSessionSortValue,
  toSessionDirectoryCursor,
} from "../../domain/session-management";
import { getDB } from "./idbConnection";
import { bindReadonlyTransactionAbort } from "./idbQueue";
import {
  fromSessionStorageRecord,
  type SessionStorageRecord,
} from "./sessionRecord";

export async function getAllSessions(): Promise<ChatSession[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readonly");
    const request = transaction.objectStore("sessions").getAll();
    request.onsuccess = () => resolve(
      (request.result || []).map((record) =>
        fromSessionStorageRecord(record as SessionStorageRecord)
      )
    );
    request.onerror = () => reject(request.error);
    bindReadonlyTransactionAbort(transaction, reject);
  });
}

export async function getSessionById(id: string): Promise<ChatSession | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readonly");
    const request = transaction.objectStore("sessions").get(id);
    request.onsuccess = () => resolve(
      request.result
        ? fromSessionStorageRecord(request.result as SessionStorageRecord)
        : null
    );
    request.onerror = () => reject(request.error);
    bindReadonlyTransactionAbort(transaction, reject);
  });
}

export async function getSessionsCount(): Promise<number> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readonly");
    const request = transaction.objectStore("sessions").count();
    request.onsuccess = () => resolve(request.result || 0);
    request.onerror = () => reject(request.error);
    bindReadonlyTransactionAbort(transaction, reject);
  });
}

/** 按角色读取最近创建的会话，不依赖界面已经加载到哪一页。 */
export async function getLatestSessionByCharacter(characterId: string): Promise<ChatSession | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readonly");
    const store = transaction.objectStore("sessions");
    const request = store.index("characterId").openCursor(IDBKeyRange.only(characterId));
    let latest: SessionStorageRecord | undefined;
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const record = cursor.value as SessionStorageRecord;
        if (record.lifecycle === "archived") {
          cursor.continue();
          return;
        }
        if (!latest || (record.createdAt ?? 0) > (latest.createdAt ?? 0)) latest = record;
        cursor.continue();
        return;
      }
      resolve(latest ? fromSessionStorageRecord(latest) : null);
    };
    request.onerror = () => reject(request.error);
    bindReadonlyTransactionAbort(transaction, reject);
  });
}

/**
 * 按角色汇总会话数量。
 *
 * 只遍历 characterId 索引键，不反序列化 sessions 记录，更不会读取独立的
 * messages Store。首页可据此展示完整分支数，而不依赖当前已加载的会话分页。
 */
export async function getSessionCountsByCharacter(): Promise<Record<string, number>> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readonly");
    const store = transaction.objectStore("sessions");
    const counts: Record<string, number> = {};

    if (!store.indexNames.contains("characterId")) {
      resolve(counts);
      return;
    }

    const request = store.index("characterId").openKeyCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(counts);
        return;
      }
      if (typeof cursor.key === "string") {
        counts[cursor.key] = (counts[cursor.key] ?? 0) + 1;
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
    bindReadonlyTransactionAbort(transaction, reject);
  });
}

/** 只遍历 parentSessionId 索引键，不加载会话记录或消息正文。 */
export async function getSessionBranchCounts(): Promise<Record<string, number>> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readonly");
    const store = transaction.objectStore("sessions");
    const counts: Record<string, number> = {};
    if (!store.indexNames.contains("parentSessionId")) {
      resolve(counts);
      return;
    }
    const request = store.index("parentSessionId").openKeyCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(counts);
        return;
      }
      if (typeof cursor.key === "string" && cursor.key) {
        counts[cursor.key] = (counts[cursor.key] ?? 0) + 1;
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
    bindReadonlyTransactionAbort(transaction, reject);
  });
}

/** 使用 createdAt 索引按最近会话优先分页，只反序列化当前页。 */
export async function getSessionsPaginated(page: number, pageSize: number): Promise<ChatSession[]> {
  const db = await getDB();
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safePageSize = Math.max(1, Math.floor(pageSize) || 20);
  const offset = (safePage - 1) * safePageSize;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readonly");
    const store = transaction.objectStore("sessions");
    const source = store.indexNames.contains("createdAt") ? store.index("createdAt") : store;
    const results: ChatSession[] = [];
    let skipped = 0;

    const request = source.openCursor(null, "prev");
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || results.length >= safePageSize) {
        resolve(results);
        return;
      }
      if ((cursor.value as SessionStorageRecord).lifecycle === "archived") {
        cursor.continue();
        return;
      }
      if (skipped++ < offset) {
        cursor.continue();
        return;
      }
      results.push(fromSessionStorageRecord(cursor.value as SessionStorageRecord));
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
    bindReadonlyTransactionAbort(transaction, reject);
  });
}

/** 使用 `(createdAt, id)` 稳定游标分页；分页期间新增最近会话不会造成后续页跳项。 */
export async function getSessionsPage(options: {
  pageSize: number;
  before?: { createdAt: number; id: string };
  cursor?: SessionDirectoryCursor;
  lifecycle?: "active" | "archived";
  sort?: SessionDirectorySort;
}): Promise<{ sessions: ChatSession[]; hasMore: boolean; cursor?: SessionDirectoryCursor }> {
  const db = await getDB();
  const pageSize = Math.max(1, Math.floor(options.pageSize) || 20);
  const sort = options.sort ?? "created_desc";
  const legacyCursor = options.before
    ? { sort: "created_desc" as const, value: options.before.createdAt, ...options.before }
    : undefined;
  const boundary = options.cursor ?? legacyCursor;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readonly");
    const store = transaction.objectStore("sessions");
    const indexName = sort === "created_asc" || sort === "created_desc"
      ? "createdAt"
      : sort === "title_asc"
        ? "title"
        : sort === "turns_desc"
          ? "turnCount"
          : "updatedAt";
    const source = store.indexNames.contains(indexName) ? store.index(indexName) : store;
    const direction: IDBCursorDirection = sort === "created_asc" || sort === "title_asc" ? "next" : "prev";
    const results: ChatSession[] = [];
    const range = boundary && store.indexNames.contains(indexName)
      ? direction === "prev"
        ? IDBKeyRange.upperBound(boundary.value)
        : IDBKeyRange.lowerBound(boundary.value)
      : null;
    const request = source.openCursor(range, direction);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || results.length > pageSize) {
        const page = results.slice(0, pageSize);
        resolve({
          sessions: page,
          hasMore: results.length > pageSize,
          cursor: page.length > 0
            ? toSessionDirectoryCursor(page[page.length - 1], sort)
            : undefined,
        });
        return;
      }
      const record = cursor.value as SessionStorageRecord;
      const lifecycle = record.lifecycle === "archived" ? "archived" : "active";
      if (options.lifecycle && lifecycle !== options.lifecycle) {
        cursor.continue();
        return;
      }
      if (!options.lifecycle && lifecycle === "archived") {
        cursor.continue();
        return;
      }
      if (boundary) {
        const value = getSessionSortValue(record, sort);
        const comparison = compareDirectoryValues(value, boundary.value);
        const isPastBoundary = direction === "prev"
          ? comparison < 0 || (comparison === 0 && record.id < boundary.id)
          : comparison > 0 || (comparison === 0 && record.id > boundary.id);
        if (!isPastBoundary) {
          cursor.continue();
          return;
        }
      }
      results.push(fromSessionStorageRecord(record));
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
    bindReadonlyTransactionAbort(transaction, reject);
  });
}

