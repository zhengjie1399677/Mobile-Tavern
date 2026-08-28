import type { ChatSession, Message } from "../../types";
import type {
  MemoryFragment,
  MemoryFragmentStatus,
  TemporalFact,
} from "../../application/services/memory/types";
import { bindTransactionAbort, enqueueWrite } from "./idbQueue";
import { getDB } from "./idbConnection";
import {
  advanceSessionContentRevision,
  deriveTurnCount,
  toSessionStorageRecord,
} from "./sessionRecord";
import {
  getStoredMessageText,
  normalizeStoredMessageRole,
  toStoredMessageRecord,
  type PersistableMessage,
  type StoredChatMessageRecord,
} from "./messageRecord";

// === Messages Store CRUD (v8 记忆系统物理分轨) ===
// 存储所有原始对话消息，按 sessionId 隔离，永久保留。
// 严禁将 messages 数组塞回 sessions 表，避免反序列化延时引发白屏（AGENTS.md 准则一）。

/**
 * 追加一条消息到 messages Store。
 * 这是记忆持久化端口使用的 messages Store 原语，不负责维护会话聚合统计。
 * 应用层新增或替换会话消息必须使用 commitSessionTurn，避免底层原语出现双重语义。
 */
export async function appendMessage(
  message: Omit<StoredChatMessageRecord, "turnIndex" | "tags" | "extractSource" | "role"> & {
    role: string;
    turnIndex?: number;
    tags?: string[];
    extractSource?: string;
  },
  signal?: AbortSignal,
): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("messages", "readwrite");
      const messagesStore = transaction.objectStore("messages");
      const existingMessageRequest = messagesStore.get(message.id);
      existingMessageRequest.onsuccess = () => {
        const existingMessage = existingMessageRequest.result as StoredChatMessageRecord | undefined;
        if (existingMessage && existingMessage.sessionId !== message.sessionId) {
          try { transaction.abort(); } catch { /* 事务可能已结束 */ }
          reject(new Error(`[localDB] Message ${message.id} belongs to another session.`));
          return;
        }
        const put = (turnIndex: number) => {
          messagesStore.put({
            ...message,
            role: normalizeStoredMessageRole(message.role),
            turnIndex,
            tags: message.tags ?? [],
            extractSource: message.extractSource === "llm" || message.extractSource === "dict"
              ? message.extractSource
              : "none",
          });
        };
        if (Number.isInteger(message.turnIndex) && (message.turnIndex as number) >= 0) {
          put(message.turnIndex as number);
          return;
        }
        if (existingMessage) {
          put(existingMessage.turnIndex);
          return;
        }
        const maxRequest = messagesStore.index("sessionId_turnIndex_createdAt").openCursor(
          IDBKeyRange.bound(
            [message.sessionId, -Infinity, -Infinity],
            [message.sessionId, Infinity, Infinity],
          ),
          "prev",
        );
        maxRequest.onsuccess = () => {
          const previous = maxRequest.result?.value as StoredChatMessageRecord | undefined;
          put((previous?.turnIndex ?? -1) + 1);
        };
        maxRequest.onerror = () => reject(maxRequest.error);
      };
      existingMessageRequest.onerror = () => reject(existingMessageRequest.error);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
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
  metadata?: Record<string, unknown>,
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
          // 消息尚未入库（appendSessionMessage 未完成或失败），无写操作，事务会立即 complete。
          return;
        }
        const updated = {
          ...existing,
          tags,
          extractSource,
          metadata: metadata !== undefined
            ? { ...(existing.metadata ?? {}), ...metadata }
            : existing.metadata,
        };
        const putReq = store.put(updated);
        // 仅注册 onerror；resolve 统一由 transaction.oncomplete 处理，
        // 保证跨事务读取时能看到已 commit 的数据。
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `message:${id}:extract`, signal);
}

/**
 * 按主键单条直查消息。
 */
export async function getMessageById(id: string): Promise<StoredChatMessageRecord | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("messages", "readonly");
    const store = transaction.objectStore("messages");
    const request = store.get(id);

    request.onsuccess = () => resolve(
      (request.result as StoredChatMessageRecord | undefined) ?? null,
    );
    request.onerror = () => reject(request.error);
    transaction.onabort = () =>
      reject(transaction.error || new Error("Transaction aborted"));
  });
}

/**
 * 按会话查询消息。优先使用绝对 turnIndex 复合索引，使分页边界和最终展示
 * 使用同一顺序；旧数据库降级到 createdAt 索引。
 */
export async function getMessagesBySession(
  sessionId: string,
  options?: {
    limit?: number;
    offset?: number;
    descending?: boolean;
    minTurnIndexExclusive?: number;
    maxTurnIndexExclusive?: number;
  }
): Promise<StoredChatMessageRecord[]> {
  const db = await getDB();
  const limit = options?.limit;
  const offset = options?.offset || 0;
  const descending = !!options?.descending;
  const minTurnIndexExclusive = options?.minTurnIndexExclusive;
  const maxTurnIndexExclusive = options?.maxTurnIndexExclusive;

  if (
    minTurnIndexExclusive !== undefined
    && maxTurnIndexExclusive !== undefined
    && minTurnIndexExclusive >= maxTurnIndexExclusive
  ) return [];

  return new Promise((resolve, reject) => {
    const transaction = db.transaction("messages", "readonly");
    const store = transaction.objectStore("messages");

    const preferredIndex = store.indexNames.contains("sessionId_turnIndex_createdAt")
      ? "sessionId_turnIndex_createdAt"
      : store.indexNames.contains("sessionId_createdAt")
        ? "sessionId_createdAt"
        : null;

    if (preferredIndex) {
      const index = store.index(preferredIndex);
      const results: StoredChatMessageRecord[] = [];
      let skipped = 0;
      let collected = 0;

      const lower = preferredIndex === "sessionId_turnIndex_createdAt"
        ? minTurnIndexExclusive !== undefined
          ? [sessionId, minTurnIndexExclusive, Infinity]
          : [sessionId, -Infinity, -Infinity]
        : [sessionId, -Infinity];
      const upper = preferredIndex === "sessionId_turnIndex_createdAt"
        ? maxTurnIndexExclusive !== undefined
          ? [sessionId, maxTurnIndexExclusive, -Infinity]
          : [sessionId, Infinity, Infinity]
        : [sessionId, Infinity];
      const direction: IDBCursorDirection = descending ? "prev" : "next";
      const request = index.openCursor(
        IDBKeyRange.bound(
          lower,
          upper,
          preferredIndex === "sessionId_turnIndex_createdAt" && minTurnIndexExclusive !== undefined,
          preferredIndex === "sessionId_turnIndex_createdAt" && maxTurnIndexExclusive !== undefined,
        ),
        direction,
      );
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(results);
          return;
        }
        const record = cursor.value as StoredChatMessageRecord;
        if (
          minTurnIndexExclusive !== undefined
          && record.turnIndex <= minTurnIndexExclusive
        ) {
          cursor.continue();
          return;
        }
        if (
          maxTurnIndexExclusive !== undefined
          && record.turnIndex >= maxTurnIndexExclusive
        ) {
          cursor.continue();
          return;
        }
        if (skipped < offset) {
          skipped++;
          cursor.continue();
          return;
        }
        if (limit !== undefined && collected >= limit) {
          resolve(results);
          return;
        }
        results.push(record);
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
        const all = (request.result || []) as StoredChatMessageRecord[];
        all.sort((a, b) => {
          const turnA = a.turnIndex !== undefined ? a.turnIndex : 0;
          const turnB = b.turnIndex !== undefined ? b.turnIndex : 0;
          if (turnA !== turnB) return turnA - turnB;
          return a.createdAt - b.createdAt;
        });
        if (descending) {
          all.reverse();
        }
        const eligible = all.filter((record) =>
          (minTurnIndexExclusive === undefined || record.turnIndex > minTurnIndexExclusive)
          && (maxTurnIndexExclusive === undefined || record.turnIndex < maxTurnIndexExclusive)
        );
        const sliced =
          limit !== undefined
            ? eligible.slice(offset, offset + limit)
            : eligible.slice(offset);
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
      const all = ((request.result || []) as StoredChatMessageRecord[])
        .filter((message) => message.sessionId === sessionId)
        .filter((message) => minTurnIndexExclusive === undefined || message.turnIndex > minTurnIndexExclusive)
        .filter((message) => maxTurnIndexExclusive === undefined || message.turnIndex < maxTurnIndexExclusive)
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
): Promise<StoredChatMessageRecord[]> {
  if (!tags || tags.length === 0) return [];
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction("messages", "readonly");
    const store = transaction.objectStore("messages");

    if (!store.indexNames.contains("tags")) {
      // 索引不存在时降级为全表扫描过滤
      const fallbackReq = store.getAll();
      fallbackReq.onsuccess = () => {
        const all = (fallbackReq.result || []) as StoredChatMessageRecord[];
        const tagSet = new Set(tags);
        const filtered = all
          .filter(
            (m: StoredChatMessageRecord) =>
              m.sessionId === sessionId &&
              Array.isArray(m.tags) &&
              m.tags.some((t: string) => tagSet.has(t))
          )
          .sort((a, b) => b.createdAt - a.createdAt);
        resolve(limit !== undefined ? filtered.slice(0, limit) : filtered);
      };
      fallbackReq.onerror = () => reject(fallbackReq.error);
      return;
    }

    const index = store.index("tags");
    const results: StoredChatMessageRecord[] = [];
    const seenIds = new Set<string>();
    let pending = tags.length;

    if (pending === 0) {
      resolve([]);
      return;
    }

    for (const tag of tags) {
      const req = index.getAll(IDBKeyRange.only(tag));
      req.onsuccess = () => {
        const hits = (req.result || []) as StoredChatMessageRecord[];
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
  if (new Set(newMessages.map((message) => message.id)).size !== newMessages.length) {
    throw new Error(`[localDB] Session ${session.id} branch contains duplicate message IDs.`);
  }
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(
        ["sessions", "messages", "memory_dict", "memory_fragments", "memory_facts"],
        "readwrite",
      );
      const sessionsStore = transaction.objectStore("sessions");
      const messagesStore = transaction.objectStore("messages");
      const dictStore = transaction.objectStore("memory_dict");
      const fragmentsStore = transaction.objectStore("memory_fragments");
      const factsStore = transaction.objectStore("memory_facts");

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      bindTransactionAbort(ctx, transaction, reject);

      const fail = (error: unknown) => {
        try { transaction.abort(); } catch { /* 事务可能已终止 */ }
        reject(error);
      };

      try {
        const firstTurnIndex = session.messages.length - newMessages.length;
        const removedIds = new Set(removedMessageIds);
        const sessionIndex = messagesStore.index("sessionId");
        let branchStartTurnIndex = firstTurnIndex;
        let calibrated = false;

        const sweepOldBranch = () => {
          if (!calibrated) {
            fail(new Error(
              `[localDB] Cannot replace session ${session.id}: branch boundary is stale or missing.`,
            ));
            return;
          }
          let retainedMessageCount = 0;
          let retainedUserMessageCount = 0;
          let retainedCharCount = 0;
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
              } else {
                retainedMessageCount++;
                if (record.role === "user") retainedUserMessageCount++;
                retainedCharCount += getStoredMessageText(record).length;
              }
              cursor.continue();
              return;
            }

            // 必须等旧尾部分支游标清理完成后再写入，避免新消息被同一游标误删。
            newMessages.forEach((message, index) => {
              messagesStore.put(toStoredMessageRecord(
                session.id,
                message as PersistableMessage,
                branchStartTurnIndex + index,
              ));
            });
            const newUserMessageCount = newMessages.reduce(
              (total, message) => total + (message.sender === "user" ? 1 : 0),
              0,
            );
            const newCharCount = newMessages.reduce(
              (total, message) => total + message.content.length,
              0,
            );
            const messageCount = retainedMessageCount + newMessages.length;
            const userMessageCount = retainedUserMessageCount + newUserMessageCount;
            sessionsStore.put(advanceSessionContentRevision({
              ...toSessionStorageRecord(session),
              pinnedMessageIds: session.pinnedMessageIds?.filter((id) => !removedIds.has(id)),
              mutedMessageIds: session.mutedMessageIds?.filter((id) => !removedIds.has(id)),
              messageCount,
              userMessageCount,
              turnCount: deriveTurnCount(messageCount, userMessageCount),
              charCount: retainedCharCount + newCharCount,
            }, { activityTime: Date.now() }));

            // 自动词典不能证明条目未受旧分支影响，分支替换时保守清空并允许后续抽取重建。
            const dictCursor = dictStore.index("sessionId").openCursor(IDBKeyRange.only(session.id));
            dictCursor.onerror = () => fail(dictCursor.error);
            dictCursor.onsuccess = () => {
              const cursor = dictCursor.result;
              if (!cursor) return;
              cursor.delete();
              cursor.continue();
            };

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

            const factCursor = factsStore.index("sessionId").openCursor(IDBKeyRange.only(session.id));
            factCursor.onerror = () => reject(factCursor.error);
            factCursor.onsuccess = () => {
              const cursor = factCursor.result;
              if (!cursor) return;
              const fact = cursor.value as TemporalFact;
              if (fact.validFromTurn >= branchStartTurnIndex) cursor.delete();
              cursor.continue();
            };
          };
        };

        // 无被移除消息时（例如重发最后一条用户消息），不能信任 firstTurnIndex：
        // 懒加载下它只是内存数组长度，可能远小于真实 turnIndex，导致该用户消息与
        // 更早历史被误删。此时新消息应追加到 store 当前最大 turnIndex 之后。
        const computeMaxTurnIndex = (cb: (maxTurn: number) => void) => {
          const maxCursor = sessionIndex.openCursor(IDBKeyRange.only(session.id));
          let maxTurn = -1;
          maxCursor.onerror = () => reject(maxCursor.error);
          maxCursor.onsuccess = () => {
            const cursor = maxCursor.result;
            if (cursor) {
              const t = cursor.value?.turnIndex;
              if (Number.isInteger(t)) maxTurn = Math.max(maxTurn, t);
              cursor.continue();
              return;
            }
            cb(maxTurn);
          };
        };

        // 若旧版本已经产生重复回复，内存数组长度推导出的 firstTurnIndex 会偏大。
        // 先读取调用方明确要求移除的记录，以其最早 turnIndex 校准真实分支起点。
        const calibrateAndSweep = () => {
          let pendingBoundaryReads = removedIds.size;
          if (pendingBoundaryReads === 0) {
            computeMaxTurnIndex((maxTurn) => {
              branchStartTurnIndex = maxTurn + 1;
              calibrated = true;
              sweepOldBranch();
            });
            return;
          }
          removedIds.forEach((messageId) => {
            const boundaryRequest = messagesStore.get(messageId);
            boundaryRequest.onerror = () => fail(boundaryRequest.error);
            boundaryRequest.onsuccess = () => {
              const record = boundaryRequest.result;
              if (
                record?.sessionId === session.id &&
                Number.isInteger(record.turnIndex)
              ) {
                // 分支起点应以“被移除消息的最小 turnIndex”为准，而不是 firstTurnIndex。
                // firstTurnIndex 由内存数组长度推导；懒加载时该数组只含最近一页，
                // 用它作为清扫下界会把早于已加载页的合法历史一并删除，造成数据丢失。
                if (!calibrated) {
                  branchStartTurnIndex = record.turnIndex;
                  calibrated = true;
                } else {
                  branchStartTurnIndex = Math.min(branchStartTurnIndex, record.turnIndex);
                }
              }
              pendingBoundaryReads--;
              if (pendingBoundaryReads === 0) sweepOldBranch();
            };
          });
        };

        // 新分支消息 ID 是全库主键；覆盖其他会话的同名消息必须在清扫前失败关闭。
        if (newMessages.length === 0) {
          calibrateAndSweep();
        } else {
          let pendingOwnerReads = newMessages.length;
          for (const message of newMessages) {
            const ownerRequest = messagesStore.get(message.id);
            ownerRequest.onerror = () => fail(ownerRequest.error);
            ownerRequest.onsuccess = () => {
              const existing = ownerRequest.result as StoredChatMessageRecord | undefined;
              if (existing && existing.sessionId !== session.id) {
                fail(new Error(
                  `[localDB] Message ${message.id} belongs to another session.`,
                ));
                return;
              }
              pendingOwnerReads--;
              if (pendingOwnerReads === 0) calibrateAndSweep();
            };
          }
        }
      } catch (error) {
        try { transaction.abort(); } catch { /* 事务可能已自动终止 */ }
        reject(error);
      }
    });
  }, `session:${session.id}:replace-branch`, signal);
}

export {
  upsertDictEntry,
  getDictEntryById,
  getDictBySession,
  deleteDictBySession,
  deleteDictEntryById,
} from "./repositories/memoryDictRepository";


// === Memory Fragments Store CRUD (v9 事件型长期记忆) ===

export async function upsertFragment(
  fragment: MemoryFragment,
  signal?: AbortSignal,
  options?: { requireSourceMessages?: boolean },
): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(
        options?.requireSourceMessages
          ? ["messages", "memory_fragments"]
          : ["memory_fragments"],
        "readwrite",
      );
      const writeFragment = () => {
        const request = transaction.objectStore("memory_fragments").put(fragment);
        request.onerror = () => reject(request.error);
      };
      if (options?.requireSourceMessages) {
        let pending = fragment.sourceMessageIds.length;
        let valid = pending > 0;
        for (const messageId of fragment.sourceMessageIds) {
          const request = transaction.objectStore("messages").get(messageId);
          request.onsuccess = () => {
            valid &&= request.result?.sessionId === fragment.sessionId;
            pending--;
            if (pending === 0 && valid) writeFragment();
          };
          request.onerror = () => reject(request.error);
        }
      } else {
        writeFragment();
      }
      transaction.oncomplete = () => resolve();
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

export {
  evolveTemporalFact,
  getTemporalFactsBySession,
  getTemporalFactsByEntities,
  updateTemporalFactStatus,
  deleteTemporalFactsBySession,
} from "./repositories/memoryFactsRepository";


export {
  appendSessionSummary,
  updateSessionSummary,
  deleteSessionSummary,
} from "./repositories/sessionSummaryRepository";
