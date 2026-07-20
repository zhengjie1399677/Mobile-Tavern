import type { ChatSession } from "../../types";
import { getDB } from "../../utils/localDB";

export async function getAllSessions(): Promise<ChatSession[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readonly");
    const request = transaction.objectStore("sessions").getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
  });
}

export async function getSessionById(id: string): Promise<ChatSession | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readonly");
    const request = transaction.objectStore("sessions").get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
  });
}

export async function getSessionsCount(): Promise<number> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readonly");
    const request = transaction.objectStore("sessions").count();
    request.onsuccess = () => resolve(request.result || 0);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
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
      if (skipped++ < offset) {
        cursor.continue();
        return;
      }
      results.push(cursor.value as ChatSession);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
  });
}
