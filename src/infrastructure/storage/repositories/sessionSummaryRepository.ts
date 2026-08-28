import type { ChatSession, SummaryCard } from "../../../types";
import { bindTransactionAbort, enqueueWrite } from "../idbQueue";
import { getDB } from "../idbConnection";
import {
  advanceSessionContentRevision,
  fromSessionStorageRecord,
  stripLegacySessionMessages,
  type SessionStorageRecord,
} from "../sessionRecord";

/**
 * 原子化地向指定会话追加一条时间轴总结卡片（SummaryCard）。
 * 该操作完全在 enqueueWrite 队列中串行执行，确保在高频对话并发写入时不会发生“写覆盖”导致的消息丢失。
 *
 * @returns Promise<ChatSession> 返回更新后的会话（不含 messages，供写入后由上层重新装配）
 */
export async function appendSessionSummary(
  sessionId: string,
  newCard: SummaryCard,
  signal?: AbortSignal
): Promise<ChatSession> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<ChatSession>((resolve, reject) => {
      const transaction = db.transaction("sessions", "readwrite");
      const store = transaction.objectStore("sessions");
      const getReq = store.get(sessionId);
      // updatedSession 提升至外层作用域，供 transaction.oncomplete 在 getReq.onsuccess 之外读取。
      let updatedSession: ChatSession | undefined;

      getReq.onsuccess = () => {
        const existingSession = getReq.result as SessionStorageRecord | undefined;
        if (!existingSession) {
          reject(new Error(`[localDB] Session ${sessionId} not found for appending summary.`));
          return;
        }

        const updatedRecord = advanceSessionContentRevision({
          ...stripLegacySessionMessages(existingSession),
          summaries: [...(existingSession.summaries || []), newCard],
          lastSummarizedMessageId: newCard.lastMessageId,
        });
        updatedSession = fromSessionStorageRecord(updatedRecord);

        const putReq = store.put(updatedRecord);
        putReq.onerror = () => reject(putReq.error);
      };

      getReq.onerror = () => reject(getReq.error);
      transaction.oncomplete = () => resolve(updatedSession as ChatSession);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, undefined, signal);
}
/** 原子更新指定摘要，避免用完整会话快照覆盖并发追加的时间线节点。 */
export async function updateSessionSummary(
  sessionId: string,
  summary: SummaryCard,
  signal?: AbortSignal
): Promise<ChatSession> {
  return mutateSessionSummaries(
    sessionId,
    (summaries) => summaries.map((item) => item.id === summary.id ? summary : item),
    signal
  );
}

/** 原子删除指定摘要，并把归档指针回退到剩余时间线的最后一项。 */
export async function deleteSessionSummary(
  sessionId: string,
  summaryId: string,
  signal?: AbortSignal
): Promise<ChatSession> {
  return mutateSessionSummaries(
    sessionId,
    (summaries) => summaries.filter((item) => item.id !== summaryId),
    signal
  );
}

function mutateSessionSummaries(
  sessionId: string,
  mutate: (summaries: SummaryCard[]) => SummaryCard[],
  signal?: AbortSignal
): Promise<ChatSession> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<ChatSession>((resolve, reject) => {
      const transaction = db.transaction("sessions", "readwrite");
      const store = transaction.objectStore("sessions");
      const getRequest = store.get(sessionId);
      let updatedSession: ChatSession | undefined;

      getRequest.onsuccess = () => {
        const existing = getRequest.result as SessionStorageRecord | undefined;
        if (!existing) {
          reject(new Error(`[localDB] Session ${sessionId} not found for mutating summary.`));
          return;
        }
        const summaries = mutate(Array.isArray(existing.summaries) ? existing.summaries : []);
        const updatedRecord = advanceSessionContentRevision({
          ...stripLegacySessionMessages(existing),
          summaries,
          lastSummarizedMessageId: summaries[summaries.length - 1]?.lastMessageId,
        });
        updatedSession = fromSessionStorageRecord(updatedRecord);
        const putRequest = store.put(updatedRecord);
        putRequest.onerror = () => reject(putRequest.error);
      };
      getRequest.onerror = () => reject(getRequest.error);
      transaction.oncomplete = () => resolve(updatedSession as ChatSession);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, undefined, signal);
}
