/**
 * Sessions Store 写入仓库。
 *
 * 从 localDB.ts 抽离，职责单一化：本模块只关心 sessions Store 的写入与级联删除，
 * 不涉及连接管理、写队列、加密或 schema。
 *
 * 会话查询（getAllSessions/getSessionById/getSessionsCount/getSessionsPaginated）
 * 仍由 indexedDbSessionQueries.ts 提供，本模块仅负责写入路径。
 */

import type { ChatSession, Message } from "../../../types";
import { getDB } from "../idbConnection";
import { enqueueWrite, bindTransactionAbort } from "../idbQueue";
import { toSessionStorageRecord } from "../sessionRecord";

// 内存 Message 在持久化到 messages Store 时可能携带的额外字段。
// 这些字段由记忆系统写入，但未纳入 Message 接口契约，故在此显式声明以避免类型逃逸。
type PersistedMessage = Message & {
  turnIndex?: number;
  tags?: string[];
  extractSource?: string;
  metadata?: Record<string, unknown>;
};

/**
 * 保存会话元数据到 sessions Store。
 *
 * **职责边界（2026-07-11 重构）**：
 *   - 只写入 sessions Store（会话元数据），不触碰 messages Store。
 *   - 从 messages 计算 turnCount / charCount 缓存字段，供前台懒加载分页使用。
 *   - 不再做消息全量同步（旧实现的 N 次 GET+PUT 已废弃，消除"多存"问题）。
 *   - 不再做孤儿清理（旧实现的 cursor.delete 已废弃，消除"遗漏"风险）。
 *
 * 新消息的持久化由调用方通过 appendSessionMessage / appendMessage 单条写入。
 * 消息删除由调用方通过 deleteMessageById 显式删除。
 * 批量同步（备份恢复/分支创建）使用 syncSessionMessages。
 */
export async function saveSession(session: ChatSession, signal?: AbortSignal): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("sessions", "readwrite");
      const sessionsStore = transaction.objectStore("sessions");

      const sessionToSave = toSessionStorageRecord(session);

      const request = sessionsStore.put(sessionToSave);
      // 用 oncomplete 判定成功（详见 charactersRepository.saveCharacter 注释）
      transaction.oncomplete = () => resolve();
      request.onerror = () => reject(request.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `session:${session.id}`, signal);  // P1-11: 同会话多次保存合并为一次落盘
}

export async function deleteSession(id: string, signal?: AbortSignal): Promise<void> {
  // 会话删除时级联清理所有记忆分轨，使用单事务保证原子性
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      // 跨 Store 事务：sessions + messages + memory_dict + memory_fragments
      const transaction = db.transaction(
        ["sessions", "messages", "memory_dict", "memory_fragments"],
        "readwrite"
      );
      const sessionsStore = transaction.objectStore("sessions");
      const messagesStore = transaction.objectStore("messages");
      const dictStore = transaction.objectStore("memory_dict");
      const fragmentsStore = transaction.objectStore("memory_fragments");

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

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `session:${id}:cascade`, signal);  // 同会话级联删除合并为一次写入
}

export async function bulkSaveSessions(sessionsList: ChatSession[], signal?: AbortSignal): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      if (sessionsList.length === 0) return resolve();
      const transaction = db.transaction(["sessions", "messages"], "readwrite");
      const sessionsStore = transaction.objectStore("sessions");
      const messagesStore = transaction.objectStore("messages");

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      bindTransactionAbort(ctx, transaction, reject);

      for (const session of sessionsList) {
        // 统一走 toSessionStorageRecord：与 saveSession 共用同一字段映射逻辑，
        // 避免两处手工计算 turnCount/charCount 出现偏差。
        const sessionToSave = toSessionStorageRecord(session);
        const messages = session.messages;

        sessionsStore.put(sessionToSave);

        if (messages && Array.isArray(messages)) {
          messages.forEach((msg, idx) => {
            const persisted = msg as PersistedMessage;
            const record = {
              id: msg.id,
              sessionId: session.id,
              // 保留原始 sender 三态（user/assistant/system）：
              // 旧实现把 system 一律映射为 assistant，导致备份恢复后系统消息变成助手回复，
              // 破坏对话上下文与记忆提取逻辑。chatMessageHydration 读取时已支持三态 role。
              role: msg.sender,
              content: msg.content,
              createdAt: msg.timestamp || Date.now(),
              turnIndex: persisted.turnIndex !== undefined ? persisted.turnIndex : idx,
              tags: persisted.tags || [],
              extractSource: persisted.extractSource || "none",
              metadata: persisted.metadata || msg.extra,
            };
            messagesStore.put(record);
          });
        }
      }
    });
  }, undefined, signal);
}
