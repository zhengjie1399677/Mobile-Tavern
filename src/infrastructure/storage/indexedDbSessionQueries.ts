import type { ChatSession } from "../../types";
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
}): Promise<{ sessions: ChatSession[]; hasMore: boolean }> {
  const db = await getDB();
  const pageSize = Math.max(1, Math.floor(options.pageSize) || 20);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readonly");
    const store = transaction.objectStore("sessions");
    const source = store.indexNames.contains("createdAt") ? store.index("createdAt") : store;
    const results: ChatSession[] = [];
    const range = options.before && store.indexNames.contains("createdAt")
      ? IDBKeyRange.upperBound(options.before.createdAt)
      : null;
    const request = source.openCursor(range, "prev");
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || results.length > pageSize) {
        resolve({
          sessions: results.slice(0, pageSize),
          hasMore: results.length > pageSize,
        });
        return;
      }
      const record = cursor.value as SessionStorageRecord;
      if (record.lifecycle === "archived") {
        cursor.continue();
        return;
      }
      if (options.before) {
        const isBefore = record.createdAt < options.before.createdAt
          || (record.createdAt === options.before.createdAt && record.id < options.before.id);
        if (!isBefore) {
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
