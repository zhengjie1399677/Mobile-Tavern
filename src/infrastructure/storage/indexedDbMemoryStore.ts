import type { ChatSession, Message } from "../../types";
import type {
  MemoryFragment,
  MemoryFragmentStatus,
} from "../../kernel/services/memory/types";
import {
  bindTransactionAbort,
  enqueueWrite,
  getDB,
} from "../../utils/localDB";
import { toSessionStorageRecord } from "./sessionRecord";

function toMessageRecord(sessionId: string, message: Message, turnIndex: number) {
  const extended = message as Message & {
    tags?: string[];
    extractSource?: string;
    metadata?: Record<string, unknown>;
  };
  return {
    id: message.id,
    sessionId,
    role: message.sender === "user" ? "user" : message.sender === "system" ? "system" : "assistant",
    content: message.content,
    createdAt: message.timestamp || Date.now(),
    turnIndex,
    tags: extended.tags || [],
    extractSource: extended.extractSource || "none",
    metadata: extended.metadata || message.extra,
  };
}

// === Messages Store CRUD (v8 记忆系统物理分轨) ===
// 存储所有原始对话消息，按 sessionId 隔离，永久保留。
// 严禁将 messages 数组塞回 sessions 表，避免反序列化延时引发白屏（AGENTS.md 准则一）。

/**
 * 追加一条消息到 messages Store。
 * 使用 enqueueWrite 串行化写入，key 合并机制确保同 ID 多次写入只落盘最新版本。
 */
export async function appendMessage(message: {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: number;
  turnIndex: number;
  tags?: string[];
  extractSource?: string;
  metadata?: Record<string, any>;
}, signal?: AbortSignal): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("messages", "readwrite");
      const store = transaction.objectStore("messages");
      const record = {
        id: message.id,
        sessionId: message.sessionId,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        turnIndex: message.turnIndex,
        tags: message.tags || [],
        extractSource: message.extractSource || "none",
        metadata: message.metadata,
      };
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `message:${message.id}`, signal);
}

/**
 * 按 ID 合并更新消息的抽取字段（tags / extractSource / metadata）。
 * 使用 GET+PUT 合并，保留 content / createdAt / role / turnIndex 等已有字段。
 * 供 MemoryExtractor 在消息已由 appendSessionMessage 写入后更新抽取结果。
 */
export async function updateMessageExtraction(
  id: string,
  tags: string[],
  extractSource: string,
  metadata?: Record<string, any>,
  signal?: AbortSignal
): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("messages", "readwrite");
      const store = transaction.objectStore("messages");
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (!existing) {
          // 消息尚未入库（appendSessionMessage 未完成或失败），跳过更新
          resolve();
          return;
        }
        const updated = {
          ...existing,
          tags,
          extractSource,
          metadata: metadata !== undefined ? metadata : existing.metadata,
        };
        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `message:${id}:extract`, signal);
}

/**
 * 按主键单条直查消息。
 */
export async function getMessageById(id: string): Promise<any | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("messages", "readonly");
    const store = transaction.objectStore("messages");
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    transaction.onabort = () =>
      reject(transaction.error || new Error("Transaction aborted"));
  });
}

/**
 * 按会话查询所有消息（按 createdAt 升序）。
 * 优先使用复合索引 sessionId_createdAt（仅游标范围查询，高效），
 * 降级时使用 sessionId 单值索引并在内存中按 createdAt 排序。
 */
export async function getMessagesBySession(
  sessionId: string,
  options?: { limit?: number; offset?: number; descending?: boolean }
): Promise<any[]> {
  const db = await getDB();
  const limit = options?.limit;
  const offset = options?.offset || 0;
  const descending = !!options?.descending;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction("messages", "readonly");
    const store = transaction.objectStore("messages");

    // 复合索引 [sessionId, createdAt] 可用 → 用 bound 范围查询
    if (store.indexNames.contains("sessionId_createdAt")) {
      const index = store.index("sessionId_createdAt");
      const results: any[] = [];
      let skipped = 0;
      let collected = 0;

      const lower = [sessionId, -Infinity];
      const upper = [sessionId, Infinity];
      const direction: IDBCursorDirection = descending ? "prev" : "next";
      const request = index.openCursor(IDBKeyRange.bound(lower, upper), direction);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          // 按照 turnIndex 升序排序，若 turnIndex 相同或缺失则按 createdAt 排序
          results.sort((a, b) => {
            const turnA = a.turnIndex !== undefined ? a.turnIndex : 0;
            const turnB = b.turnIndex !== undefined ? b.turnIndex : 0;
            if (turnA !== turnB) return turnA - turnB;
            return a.createdAt - b.createdAt;
          });
          if (descending) {
            results.reverse();
          }
          resolve(results);
          return;
        }
        if (skipped < offset) {
          skipped++;
          cursor.continue();
          return;
        }
        if (limit !== undefined && collected >= limit) {
          // 同样进行排序和翻转
          results.sort((a, b) => {
            const turnA = a.turnIndex !== undefined ? a.turnIndex : 0;
            const turnB = b.turnIndex !== undefined ? b.turnIndex : 0;
            if (turnA !== turnB) return turnA - turnB;
            return a.createdAt - b.createdAt;
          });
          if (descending) {
            results.reverse();
          }
          resolve(results);
          return;
        }
        results.push(cursor.value);
        collected++;
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      transaction.onabort = () =>
        reject(transaction.error || new Error("Transaction aborted"));
      return;
    }

    // 降级：使用 sessionId 单值索引 + 内存排序
    if (store.indexNames.contains("sessionId")) {
      const index = store.index("sessionId");
      const request = index.getAll(IDBKeyRange.only(sessionId));
      request.onsuccess = () => {
        const all = request.result || [];
        all.sort((a, b) => {
          const turnA = a.turnIndex !== undefined ? a.turnIndex : 0;
          const turnB = b.turnIndex !== undefined ? b.turnIndex : 0;
          if (turnA !== turnB) return turnA - turnB;
          return a.createdAt - b.createdAt;
        });
        if (descending) {
          all.reverse();
        }
        const sliced =
          limit !== undefined
            ? all.slice(offset, offset + limit)
            : all.slice(offset);
        resolve(sliced);
      };
      request.onerror = () => reject(request.error);
      transaction.onabort = () =>
        reject(transaction.error || new Error("Transaction aborted"));
      return;
    }

    // 极端降级：全表扫描
    const request = store.getAll();
    request.onsuccess = () => {
      const all = (request.result || [])
        .filter((m) => m.sessionId === sessionId)
        .sort((a, b) => descending ? b.createdAt - a.createdAt : a.createdAt - b.createdAt);
      const sliced =
        limit !== undefined
          ? all.slice(offset, offset + limit)
          : all.slice(offset);
      resolve(sliced);
    };
    request.onerror = () => reject(request.error);
    transaction.onabort = () =>
      reject(transaction.error || new Error("Transaction aborted"));
  });
}

/**
 * 按标签查询消息（倒排召回）。
 * 使用 tags 多值索引，返回命中指定标签的消息列表。
 * @param sessionId 限定会话范围，避免跨会话污染
 * @param tags      查询标签数组（任一命中即返回）
 * @param limit     返回条数上限
 */
export async function getMessagesByTag(
  sessionId: string,
  tags: string[],
  limit?: number
): Promise<any[]> {
  if (!tags || tags.length === 0) return [];
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction("messages", "readonly");
    const store = transaction.objectStore("messages");

    if (!store.indexNames.contains("tags")) {
      // 索引不存在时降级为全表扫描过滤
      const fallbackReq = store.getAll();
      fallbackReq.onsuccess = () => {
        const all = fallbackReq.result || [];
        const tagSet = new Set(tags);
        const filtered = all
          .filter(
            (m) =>
              m.sessionId === sessionId &&
              Array.isArray(m.tags) &&
              m.tags.some((t) => tagSet.has(t))
          )
          .sort((a, b) => b.createdAt - a.createdAt);
        resolve(limit !== undefined ? filtered.slice(0, limit) : filtered);
      };
      fallbackReq.onerror = () => reject(fallbackReq.error);
      return;
    }

    const index = store.index("tags");
    const results: any[] = [];
    const seenIds = new Set<string>();
    let pending = tags.length;

    if (pending === 0) {
      resolve([]);
      return;
    }

    for (const tag of tags) {
      const req = index.getAll(IDBKeyRange.only(tag));
      req.onsuccess = () => {
        const hits = req.result || [];
        for (const msg of hits) {
          if (
            msg.sessionId === sessionId &&
            !seenIds.has(msg.id)
          ) {
            seenIds.add(msg.id);
            results.push(msg);
          }
        }
        pending--;
        if (pending === 0) {
          // 按时间倒序
          results.sort((a, b) => b.createdAt - a.createdAt);
          resolve(limit !== undefined ? results.slice(0, limit) : results);
        }
      };
      req.onerror = () => reject(req.error);
    }
    transaction.onabort = () =>
      reject(transaction.error || new Error("Transaction aborted"));
  });
}

/**
 * 删除指定会话的所有消息（用于会话删除时级联清理）。
 */
export async function deleteMessagesBySession(sessionId: string, signal?: AbortSignal): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("messages", "readwrite");
      const store = transaction.objectStore("messages");
      const index = store.index("sessionId");
      const request = index.openCursor(IDBKeyRange.only(sessionId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, undefined, signal);
}

/**
 * 按主键删除单条消息（用于重投/编辑场景显式删除旧消息）。
 */
export async function deleteMessageById(id: string, signal?: AbortSignal): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("messages", "readwrite");
      const store = transaction.objectStore("messages");
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `message:${id}:delete`, signal);
}

/**
 * 原子替换一次重发产生的会话分支。
 * sessions 元数据更新、旧分支删除与新分支写入共用一个跨 Store 事务，
 * 任一步失败都会整体回滚，避免杀进程或配额错误留下半截分支。
 */
export async function replaceSessionBranch(
  session: ChatSession,
  removedMessageIds: string[],
  newMessages: Message[],
  signal?: AbortSignal
): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(["sessions", "messages", "memory_fragments"], "readwrite");
      const sessionsStore = transaction.objectStore("sessions");
      const messagesStore = transaction.objectStore("messages");
      const fragmentsStore = transaction.objectStore("memory_fragments");

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      bindTransactionAbort(ctx, transaction, reject);

      try {
        sessionsStore.put(toSessionStorageRecord(session));
        const firstTurnIndex = session.messages.length - newMessages.length;
        const removedIds = new Set(removedMessageIds);
        const sessionIndex = messagesStore.index("sessionId");
        let branchStartTurnIndex = firstTurnIndex;

        const sweepOldBranch = () => {
          const cursorRequest = sessionIndex.openCursor(IDBKeyRange.only(session.id));
          cursorRequest.onerror = () => reject(cursorRequest.error);
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (cursor) {
              const record = cursor.value;
              const recordTurnIndex = Number.isInteger(record.turnIndex)
                ? record.turnIndex
                : null;

              // removedIds 兼容缺少 turnIndex 的旧记录；turnIndex 边界则是权威的
              // 分支覆盖规则，可一并清除未进入调用方 ID 列表的孤儿/重复回复。
              if (
                removedIds.has(record.id) ||
                (recordTurnIndex !== null && recordTurnIndex >= branchStartTurnIndex)
              ) {
                cursor.delete();
              }
              cursor.continue();
              return;
            }

            // 必须等旧尾部分支游标清理完成后再写入，避免新消息被同一游标误删。
            newMessages.forEach((message, index) => {
              messagesStore.put(toMessageRecord(session.id, message, branchStartTurnIndex + index));
            });

            // 与消息分支使用同一权威轮次边界，避免旧分支事件泄漏到重发后的召回。
            const fragmentIndex = fragmentsStore.index("sessionId");
            const fragmentCursor = fragmentIndex.openCursor(IDBKeyRange.only(session.id));
            fragmentCursor.onerror = () => reject(fragmentCursor.error);
            fragmentCursor.onsuccess = () => {
              const cursor = fragmentCursor.result;
              if (!cursor) return;
              const fragment = cursor.value as MemoryFragment;
              if (fragment.sourceTurnEnd >= branchStartTurnIndex) cursor.delete();
              cursor.continue();
            };
          };
        };

        // 若旧版本已经产生重复回复，内存数组长度推导出的 firstTurnIndex 会偏大。
        // 先读取调用方明确要求移除的记录，以其最早 turnIndex 校准真实分支起点。
        let pendingBoundaryReads = removedIds.size;
        if (pendingBoundaryReads === 0) {
          sweepOldBranch();
        } else {
          removedIds.forEach((messageId) => {
            const boundaryRequest = messagesStore.get(messageId);
            boundaryRequest.onerror = () => reject(boundaryRequest.error);
            boundaryRequest.onsuccess = () => {
              const record = boundaryRequest.result;
              if (
                record?.sessionId === session.id &&
                Number.isInteger(record.turnIndex)
              ) {
                branchStartTurnIndex = Math.min(branchStartTurnIndex, record.turnIndex);
              }
              pendingBoundaryReads--;
              if (pendingBoundaryReads === 0) sweepOldBranch();
            };
          });
        }
      } catch (error) {
        try { transaction.abort(); } catch { /* 事务可能已自动终止 */ }
        reject(error);
      }
    });
  }, `session:${session.id}:replace-branch`, signal);
}

/**
 * 批量同步会话消息（用于分支创建/备份恢复等需要全量写入的场景）。
 *
 * 与旧 saveSession 的消息同步逻辑不同：
 *   - 仅 PUT（upsert），不做 GET+PUT，避免 N 次读放大
 *   - 不做孤儿清理，调用方需自行决定是否需要 prune
 *   - 新消息 turnIndex 基于数组下标，MemoryExtractor 后续会更新
 *
 * @param sessionId 目标会话 ID
 * @param messages  Message[]（内存格式，sender/timestamp/extra）
 */
export async function syncSessionMessages(
  sessionId: string,
  messages: Array<{ id: string; sender: string; content: string; timestamp?: number; extra?: Record<string, any>; metadata?: Record<string, any> }>,
  signal?: AbortSignal
): Promise<void> {
  if (!messages || messages.length === 0) return;
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("messages", "readwrite");
      const store = transaction.objectStore("messages");

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      bindTransactionAbort(ctx, transaction, reject);

      messages.forEach((msg, idx) => {
        const record = {
          id: msg.id,
          sessionId,
          role: msg.sender === "user" ? "user" : "assistant",
          content: msg.content,
          createdAt: msg.timestamp || Date.now(),
          turnIndex: idx,
          tags: [],
          extractSource: "none",
          metadata: msg.metadata || msg.extra,
        };
        store.put(record);
      });
    });
  }, `session:${sessionId}:sync`, signal);
}

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
  type?: string;
  firstSeenMsgId: string;
  firstSeenTurn: number;
  count?: number;
  createdAt?: number;
  updatedAt?: number;
}, signal?: AbortSignal): Promise<boolean> {
  const id = entry.id || `${entry.sessionId}:${entry.entity}`;
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<boolean>((resolve, reject) => {
      const transaction = db.transaction("memory_dict", "readwrite");
      const store = transaction.objectStore("memory_dict");
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const existing = getReq.result;
        const now = Date.now();
        let isNew = false;
        let record: any;

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
        putRequest.onsuccess = () => resolve(isNew);
        putRequest.onerror = () => reject(putRequest.error);
      };

      getReq.onerror = () => reject(getReq.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `dict:${id}`, signal);
}

/**
 * 按主键单条直查词典条目。
 */
export async function getDictEntryById(id: string): Promise<any | null> {
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
export async function getDictBySession(sessionId: string): Promise<any[]> {
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
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
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
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `dict:${id}:delete`, signal);
}

// === Memory Fragments Store CRUD (v9 事件型长期记忆) ===

export async function upsertFragment(
  fragment: MemoryFragment,
  signal?: AbortSignal
): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("memory_fragments", "readwrite");
      const request = transaction.objectStore("memory_fragments").put(fragment);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `fragment:${fragment.id}`, signal);
}

export async function getFragmentById(id: string): Promise<MemoryFragment | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("memory_fragments", "readonly");
    const request = transaction.objectStore("memory_fragments").get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
  });
}

export async function getFragmentsBySession(sessionId: string): Promise<MemoryFragment[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("memory_fragments", "readonly");
    const store = transaction.objectStore("memory_fragments");
    const request = store.index("sessionId").getAll(IDBKeyRange.only(sessionId));
    request.onsuccess = () => {
      const result = (request.result || []) as MemoryFragment[];
      result.sort((a, b) => b.sourceTurnEnd - a.sourceTurnEnd || b.updatedAt - a.updatedAt);
      resolve(result);
    };
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
  });
}

export async function getFragmentsByTags(
  sessionId: string,
  tags: string[],
  limit?: number
): Promise<MemoryFragment[]> {
  if (tags.length === 0) return [];
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("memory_fragments", "readonly");
    const store = transaction.objectStore("memory_fragments");
    const index = store.index("tags");
    const results: MemoryFragment[] = [];
    const seen = new Set<string>();
    let pending = tags.length;

    tags.forEach((tag) => {
      const request = index.getAll(IDBKeyRange.only(tag));
      request.onsuccess = () => {
        for (const fragment of request.result as MemoryFragment[]) {
          if (
            fragment.sessionId === sessionId &&
            fragment.status === "active" &&
            !seen.has(fragment.id)
          ) {
            seen.add(fragment.id);
            results.push(fragment);
          }
        }
        pending--;
        if (pending === 0) {
          results.sort((a, b) => b.sourceTurnEnd - a.sourceTurnEnd || b.updatedAt - a.updatedAt);
          resolve(limit === undefined ? results : results.slice(0, limit));
        }
      };
      request.onerror = () => reject(request.error);
    });
    transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
  });
}

export async function supersedeFragment(
  originalId: string,
  replacement: MemoryFragment,
  signal?: AbortSignal
): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("memory_fragments", "readwrite");
      const store = transaction.objectStore("memory_fragments");
      const request = store.get(originalId);
      request.onsuccess = () => {
        const original = request.result as MemoryFragment | undefined;
        if (!original) {
          reject(new Error(`[memory_fragments] Fragment ${originalId} not found.`));
          return;
        }
        const now = Date.now();
        store.put({
          ...original,
          status: "superseded",
          supersededById: replacement.id,
          updatedAt: now,
        });
        store.put({
          ...replacement,
          supersedesId: originalId,
          status: "active",
          updatedAt: now,
        });
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `fragment:${originalId}:supersede`, signal);
}

export async function updateFragmentStatus(
  id: string,
  status: MemoryFragmentStatus,
  signal?: AbortSignal
): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("memory_fragments", "readwrite");
      const store = transaction.objectStore("memory_fragments");
      const request = store.get(id);
      request.onsuccess = () => {
        if (!request.result) {
          return;
        }
        store.put({ ...request.result, status, updatedAt: Date.now() });
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `fragment:${id}:status`, signal);
}

export async function deleteFragmentsBySession(
  sessionId: string,
  signal?: AbortSignal
): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("memory_fragments", "readwrite");
      const store = transaction.objectStore("memory_fragments");
      const request = store.index("sessionId").openCursor(IDBKeyRange.only(sessionId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `fragments:${sessionId}:delete`, signal);
}

/**
 * 原子化地向指定会话追加一条时间轴总结卡片（SummaryCard）。
 * 该操作完全在 enqueueWrite 队列中串行执行，确保在高频对话并发写入时不会发生“写覆盖”导致的消息丢失。
 *
 * @returns Promise<ChatSession> 返回更新后的会话（不含 messages，供写入后由上层重新装配）
 */
export async function appendSessionSummary(
  sessionId: string,
  newCard: any,
  signal?: AbortSignal
): Promise<ChatSession> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<ChatSession>((resolve, reject) => {
      const transaction = db.transaction("sessions", "readwrite");
      const store = transaction.objectStore("sessions");
      const getReq = store.get(sessionId);

      getReq.onsuccess = () => {
        const existingSession = getReq.result;
        if (!existingSession) {
          reject(new Error(`[localDB] Session ${sessionId} not found for appending summary.`));
          return;
        }

        const updatedSession = {
          ...existingSession,
          summaries: [...(existingSession.summaries || []), newCard],
          lastSummarizedMessageId: newCard.lastMessageId,
        };

        const putReq = store.put(updatedSession);
        putReq.onsuccess = () => resolve(updatedSession);
        putReq.onerror = () => reject(putReq.error);
      };

      getReq.onerror = () => reject(getReq.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `session:${sessionId}`, signal);
}
