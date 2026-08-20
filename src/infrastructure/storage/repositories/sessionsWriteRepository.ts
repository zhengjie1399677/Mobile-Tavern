/**
 * Sessions Store 写入仓库。
 *
 * 从 localDB.ts 抽离，职责单一化：本模块只关心 sessions Store 的写入与级联删除，
 * 不涉及连接管理、写队列、加密或 schema。
 *
 * 会话查询（getAllSessions/getSessionById/getSessionsCount/getSessionsPaginated）
 * 仍由 indexedDbSessionQueries.ts 提供，本模块仅负责写入路径。
 */

import type {
  ChatSession,
  ChatSessionMetadataPatch,
} from "../../../types";
import { getDB } from "../idbConnection";
import { enqueueWrite, bindTransactionAbort } from "../idbQueue";
import {
  calculateSessionMessageStats,
  stripLegacySessionMessages,
  toSessionStorageRecord,
  type SessionStorageRecord,
} from "../sessionRecord";
import { toStoredMessageRecord, type PersistableMessage } from "../messageRecord";

/**
 * 保存会话元数据到 sessions Store。
 *
 * **职责边界（2026-07-11 重构）**：
 *   - 只写入 sessions Store（会话元数据），不触碰 messages Store。
 *   - 不从内存消息窗口重算 turnCount / charCount；这些字段只由消息事务维护。
 *   - 不再做消息全量同步（旧实现的 N 次 GET+PUT 已废弃，消除"多存"问题）。
 *   - 不再做孤儿清理（旧实现的 cursor.delete 已废弃，消除"遗漏"风险）。
 *
 * 消息写入、删除与分支替换均通过各自的跨 Store 原子事务完成。
 */
export async function updateSessionMetadata(
  sessionId: string,
  patch: ChatSessionMetadataPatch,
  signal?: AbortSignal,
): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("sessions", "readwrite");
      const sessionsStore = transaction.objectStore("sessions");

      const getRequest = sessionsStore.get(sessionId);

      // summaries 只能通过专用的原子摘要操作修改。普通会话保存常由流式输出、
      // 图片状态或标题更新触发，携带的可能是陈旧 React 快照，不能反向覆盖时间线。
      getRequest.onsuccess = () => {
        const existing = getRequest.result as SessionStorageRecord | undefined;
        if (!existing) {
          try { transaction.abort(); } catch { /* 事务可能已终止 */ }
          reject(new Error(`[localDB] Session ${sessionId} not found for metadata update.`));
          return;
        }
        const putRequest = sessionsStore.put({
          ...stripLegacySessionMessages(existing),
          ...patch,
        });
        putRequest.onerror = () => reject(putRequest.error);
      };
      // 用 oncomplete 判定成功（详见 charactersRepository.saveCharacter 注释）
      transaction.oncomplete = () => resolve();
      getRequest.onerror = () => reject(getRequest.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `session:${sessionId}:metadata`, signal);
}

export async function deleteSession(id: string, signal?: AbortSignal): Promise<void> {
  // 会话删除时级联清理所有记忆分轨，使用单事务保证原子性
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      // 跨 Store 事务：会话主记录及所有记忆分轨
      const transaction = db.transaction(
        ["sessions", "messages", "memory_dict", "memory_fragments", "memory_facts"],
        "readwrite"
      );
      const sessionsStore = transaction.objectStore("sessions");
      const messagesStore = transaction.objectStore("messages");
      const dictStore = transaction.objectStore("memory_dict");
      const fragmentsStore = transaction.objectStore("memory_fragments");
      const factsStore = transaction.objectStore("memory_facts");

      // 1. 删除会话主记录
      sessionsStore.delete(id);

      // 2. 删除 messages Store 中该 sessionId 的所有消息（含 tags 索引项）
      const messagesIndex = messagesStore.index("sessionId");
      const msgCursorReq = messagesIndex.openCursor(IDBKeyRange.only(id));
      msgCursorReq.onsuccess = () => {
        const cursor = msgCursorReq.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      msgCursorReq.onerror = () => reject(msgCursorReq.error);

      // 3. 删除 memory_dict Store 中该 sessionId 的所有词典条目
      const dictIndex = dictStore.index("sessionId");
      const dictCursorReq = dictIndex.openCursor(IDBKeyRange.only(id));
      dictCursorReq.onsuccess = () => {
        const cursor = dictCursorReq.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      dictCursorReq.onerror = () => reject(dictCursorReq.error);

      // 4. 删除事件型记忆片段
      const fragmentIndex = fragmentsStore.index("sessionId");
      const fragmentCursorReq = fragmentIndex.openCursor(IDBKeyRange.only(id));
      fragmentCursorReq.onsuccess = () => {
        const cursor = fragmentCursorReq.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      fragmentCursorReq.onerror = () => reject(fragmentCursorReq.error);

      // 5. 删除实体关系图与时态事实
      const factCursorReq = factsStore.index("sessionId").openCursor(IDBKeyRange.only(id));
      factCursorReq.onsuccess = () => {
        const cursor = factCursorReq.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      factCursorReq.onerror = () => reject(factCursorReq.error);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `session:${id}:cascade`, signal);  // 同会话级联删除合并为一次写入
}

export async function replaceCompleteSessions(sessionsList: ChatSession[], signal?: AbortSignal): Promise<void> {
  const sessionsById = new Map(sessionsList.map((session) => [session.id, session]));
  const messageOwners = new Map<string, string>();
  for (const session of sessionsById.values()) {
    for (const message of session.messages) {
      const owner = messageOwners.get(message.id);
      if (owner && owner !== session.id) {
        throw new Error(`[localDB] Message ${message.id} is shared by sessions ${owner} and ${session.id}.`);
      }
      messageOwners.set(message.id, session.id);
    }
  }
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      if (sessionsById.size === 0) return resolve();
      const transaction = db.transaction(["sessions", "messages"], "readwrite");
      const sessionsStore = transaction.objectStore("sessions");
      const messagesStore = transaction.objectStore("messages");

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      bindTransactionAbort(ctx, transaction, reject);
      const fail = (error: unknown) => {
        try { transaction.abort(); } catch { /* 事务可能已结束 */ }
        reject(error);
      };

      for (const session of sessionsById.values()) {
        // 备份恢复和导入语义是“完整替换会话”，必须先在同一事务内清除旧消息。
        // 等游标结束后再 PUT，避免游标把刚写入的新消息一并扫掉。
        const deleteCursor = messagesStore.index("sessionId")
          .openCursor(IDBKeyRange.only(session.id));
        deleteCursor.onsuccess = () => {
          const cursor = deleteCursor.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
            return;
          }

          const uniqueMessages = Array.from(
            new Map(session.messages.map((message) => [message.id, message])).values(),
          );
          const writeSession = () => {
            sessionsStore.put({
              ...toSessionStorageRecord(session),
              ...calculateSessionMessageStats(uniqueMessages),
            });
            uniqueMessages.forEach((message, index) => {
              const persisted = message as PersistableMessage;
              messagesStore.put(toStoredMessageRecord(
                session.id,
                persisted,
                persisted.turnIndex ?? index,
              ));
            });
          };
          if (uniqueMessages.length === 0) {
            writeSession();
            return;
          }

          let pendingChecks = uniqueMessages.length;
          for (const message of uniqueMessages) {
            const ownerRequest = messagesStore.get(message.id);
            ownerRequest.onsuccess = () => {
              const existing = ownerRequest.result as { sessionId?: string } | undefined;
              if (existing?.sessionId && existing.sessionId !== session.id) {
                fail(new Error(
                  `[localDB] Message ${message.id} already belongs to session ${existing.sessionId}.`,
                ));
                return;
              }
              pendingChecks--;
              if (pendingChecks === 0) writeSession();
            };
            ownerRequest.onerror = () => fail(ownerRequest.error);
          }
        };
        deleteCursor.onerror = () => reject(deleteCursor.error);
      }
    });
  }, undefined, signal);
}
