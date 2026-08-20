import type { MemoryDictEntry } from "../../../application/services/memory/types";
import { bindTransactionAbort, enqueueWrite } from "../idbQueue";
import { getDB } from "../idbConnection";

// === Memory Dict Store CRUD (v8 记忆系统会话级自动学习词典) ===

/**
 * 更新或插入词典条目。
 * 使用复合键 `${sessionId}:${entity}` 保证会话内实体唯一。
 */
/**
 * 更新或插入词典条目（原子操作）。
 * 使用复合键 `${sessionId}:${entity}` 保证会话内实体唯一。
 * 将“读取旧数据 -> 判断新建或更新 -> 写入新数据”包裹在单个 enqueueWrite 中串行化执行，
 * 彻底消除高并发下的 Read-After-Write 脏读与 Count 计数丢失问题。
 *
 * 保持单对象参数签名以兼容现有 UI 调用处。
 *
 * @returns Promise<boolean> 标识是否为新建实体（true 表示新建，false 表示更新）
 */
export async function upsertDictEntry(entry: {
  id?: string;
  sessionId: string;
  entity: string;
  aliases?: string[];
  type?: MemoryDictEntry["type"];
  firstSeenMsgId: string;
  firstSeenTurn: number;
  count?: number;
  createdAt?: number;
  updatedAt?: number;
  requireSourceMessage?: boolean;
}, signal?: AbortSignal): Promise<boolean> {
  const id = entry.id || `${entry.sessionId}:${entry.entity}`;
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<boolean>((resolve, reject) => {
      const transaction = db.transaction(
        entry.requireSourceMessage ? ["messages", "memory_dict"] : ["memory_dict"],
        "readwrite",
      );
      const store = transaction.objectStore("memory_dict");
      // isNew 提升至外层作用域，供 transaction.oncomplete 在 getReq.onsuccess 之外读取。
      let isNew = false;

      const writeEntry = () => {
        const getReq = store.get(id);
        getReq.onsuccess = () => {
          const existing = getReq.result;
          const now = Date.now();
          let record: MemoryDictEntry;

          if (existing) {
            const nextCount = entry.count !== undefined ? entry.count : (existing.count || 0) + 1;
            record = {
              id,
              sessionId: entry.sessionId,
              entity: entry.entity,
              aliases: entry.aliases ?? existing.aliases ?? [],
              type: entry.type ?? existing.type ?? "concept",
              firstSeenMsgId: existing.firstSeenMsgId,
              firstSeenTurn: existing.firstSeenTurn,
              count: nextCount,
              createdAt: existing.createdAt,
              updatedAt: entry.updatedAt ?? now,
            };
          } else {
            isNew = true;
            record = {
              id,
              sessionId: entry.sessionId,
              entity: entry.entity,
              aliases: entry.aliases ?? [],
              type: entry.type ?? "concept",
              firstSeenMsgId: entry.firstSeenMsgId,
              firstSeenTurn: entry.firstSeenTurn,
              count: entry.count ?? 1,
              createdAt: entry.createdAt ?? now,
              updatedAt: entry.updatedAt ?? now,
            };
          }

          const putRequest = store.put(record);
          putRequest.onerror = () => reject(putRequest.error);
        };
        getReq.onerror = () => reject(getReq.error);
      };

      if (entry.requireSourceMessage) {
        const sourceRequest = transaction.objectStore("messages").get(entry.firstSeenMsgId);
        sourceRequest.onsuccess = () => {
          if (sourceRequest.result?.sessionId === entry.sessionId) writeEntry();
        };
        sourceRequest.onerror = () => reject(sourceRequest.error);
      } else {
        writeEntry();
      }
      transaction.oncomplete = () => resolve(isNew);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `dict:${id}`, signal);
}

/**
 * 按主键单条直查词典条目。
 */
export async function getDictEntryById(id: string): Promise<MemoryDictEntry | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("memory_dict", "readonly");
    const store = transaction.objectStore("memory_dict");
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    transaction.onabort = () =>
      reject(transaction.error || new Error("Transaction aborted"));
  });
}

/**
 * 按会话查询所有词典条目。
 */
export async function getDictBySession(sessionId: string): Promise<MemoryDictEntry[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("memory_dict", "readonly");
    const store = transaction.objectStore("memory_dict");
    const index = store.index("sessionId");
    const request = index.getAll(IDBKeyRange.only(sessionId));

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    transaction.onabort = () =>
      reject(transaction.error || new Error("Transaction aborted"));
  });
}

/**
 * 删除指定会话的所有词典条目（用于会话删除时级联清理）。
 */
export async function deleteDictBySession(sessionId: string, signal?: AbortSignal): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("memory_dict", "readwrite");
      const store = transaction.objectStore("memory_dict");
      const index = store.index("sessionId");
      const request = index.openCursor(IDBKeyRange.only(sessionId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, undefined, signal);
}

/**
 * 按主键物理删除单条词典条目。
 */
export async function deleteDictEntryById(id: string, signal?: AbortSignal): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("memory_dict", "readwrite");
      const store = transaction.objectStore("memory_dict");
      const request = store.delete(id);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `dict:${id}:delete`, signal);
}
