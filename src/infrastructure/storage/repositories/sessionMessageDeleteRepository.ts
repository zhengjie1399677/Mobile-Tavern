import type { ChatSession, SummaryCard } from "../../../types";
import type { MemoryFragment, TemporalFact } from "../../../application/services/memory/types";
import { getDB } from "../idbConnection";
import { bindTransactionAbort, enqueueWrite } from "../idbQueue";
import {
  deriveTurnCount,
  fromSessionStorageRecord,
  stripLegacySessionMessages,
  type SessionStorageRecord,
} from "../sessionRecord";
import {
  getStoredMessageText,
  type StoredChatMessageRecord,
} from "../messageRecord";

/**
 * 原子删除单条会话消息并清理所有可能引用该消息之后状态的派生记忆。
 * 原始消息是权威来源；无法证明仍有效的摘要、事件、事实和自动词典宁可失效重建，
 * 也不能在召回中继续泄漏已删除内容。
 */
export function deleteSessionMessage(
  sessionId: string,
  messageId: string,
  signal?: AbortSignal,
): Promise<ChatSession> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<ChatSession>((resolve, reject) => {
      const transaction = db.transaction(
        ["sessions", "messages", "memory_dict", "memory_fragments", "memory_facts"],
        "readwrite",
      );
      const sessionsStore = transaction.objectStore("sessions");
      const messagesStore = transaction.objectStore("messages");
      const dictStore = transaction.objectStore("memory_dict");
      const fragmentsStore = transaction.objectStore("memory_fragments");
      const factsStore = transaction.objectStore("memory_facts");
      const sessionRequest = sessionsStore.get(sessionId);
      const messageRequest = messagesStore.get(messageId);
      let session: SessionStorageRecord | undefined;
      let target: StoredChatMessageRecord | undefined;
      let updatedSession: ChatSession | undefined;
      let pendingInitialReads = 2;

      const fail = (error: unknown) => {
        try { transaction.abort(); } catch { /* 事务可能已终止 */ }
        reject(error);
      };

      const sweepDerivedMemory = (turnIndex: number, nextRecord: SessionStorageRecord) => {
        const invalidPinnedIds = new Set([messageId]);
        const dictCursor = dictStore.index("sessionId").openCursor(IDBKeyRange.only(sessionId));
        dictCursor.onsuccess = () => {
          const cursor = dictCursor.result;
          if (!cursor) return;
          cursor.delete();
          cursor.continue();
        };
        dictCursor.onerror = () => fail(dictCursor.error);

        const fragmentCursor = fragmentsStore.index("sessionId").openCursor(IDBKeyRange.only(sessionId));
        fragmentCursor.onsuccess = () => {
          const cursor = fragmentCursor.result;
          if (!cursor) {
            const reconciledRecord: SessionStorageRecord = {
              ...nextRecord,
              pinnedMessageIds: nextRecord.pinnedMessageIds?.filter((id) => !invalidPinnedIds.has(id)),
              mutedMessageIds: nextRecord.mutedMessageIds?.filter((id) => !invalidPinnedIds.has(id)),
            };
            sessionsStore.put(reconciledRecord);
            updatedSession = fromSessionStorageRecord(reconciledRecord);
            return;
          }
          const fragment = cursor.value as MemoryFragment;
          if (fragment.sourceTurnEnd >= turnIndex) {
            invalidPinnedIds.add(fragment.id);
            cursor.delete();
          }
          cursor.continue();
        };
        fragmentCursor.onerror = () => fail(fragmentCursor.error);

        const factCursor = factsStore.index("sessionId").openCursor(IDBKeyRange.only(sessionId));
        factCursor.onsuccess = () => {
          const cursor = factCursor.result;
          if (!cursor) return;
          const fact = cursor.value as TemporalFact;
          if (fact.validFromTurn >= turnIndex || fact.sourceMessageId === messageId) cursor.delete();
          cursor.continue();
        };
        factCursor.onerror = () => fail(factCursor.error);
      };

      const persistDeletion = (
        messageCount: number,
        userMessageCount: number,
        charCount: number,
        summaries: SummaryCard[],
      ) => {
        if (!session || !target) return;
        const nextMessageCount = Math.max(0, messageCount - 1);
        const nextUserMessageCount = Math.max(
          0,
          userMessageCount - (target.role === "user" ? 1 : 0),
        );
        const nextRecord: SessionStorageRecord = {
          ...stripLegacySessionMessages(session),
          summaries,
          lastSummarizedMessageId: summaries.at(-1)?.lastMessageId,
          pinnedMessageIds: session.pinnedMessageIds?.filter((id) => id !== messageId),
          mutedMessageIds: session.mutedMessageIds?.filter((id) => id !== messageId),
          messageCount: nextMessageCount,
          userMessageCount: nextUserMessageCount,
          turnCount: deriveTurnCount(nextMessageCount, nextUserMessageCount),
          charCount: Math.max(0, charCount - getStoredMessageText(target).length),
        };
        messagesStore.delete(messageId);
        sessionsStore.put(nextRecord);
        sweepDerivedMemory(target.turnIndex, nextRecord);
        updatedSession = fromSessionStorageRecord(nextRecord);
      };

      const reconcileSummaries = (
        messageCount: number,
        userMessageCount: number,
        charCount: number,
      ) => {
        if (!session || !target) return;
        const summaries = Array.isArray(session.summaries) ? session.summaries : [];
        if (summaries.length === 0) {
          persistDeletion(messageCount, userMessageCount, charCount, summaries);
          return;
        }
        const boundaryTurns = new Map<string, number>();
        let pending = 0;
        const finish = () => {
          pending--;
          if (pending > 0) return;
          const retainedSummaries = summaries.filter((summary) => {
            if (summary.lastMessageId === messageId) return false;
            const boundary = summary.lastMessageId
              ? boundaryTurns.get(summary.lastMessageId)
              : undefined;
            return boundary === undefined || boundary < target!.turnIndex;
          });
          persistDeletion(
            messageCount,
            userMessageCount,
            charCount,
            retainedSummaries,
          );
        };
        for (const summary of summaries) {
          if (!summary.lastMessageId) continue;
          pending++;
          const request = messagesStore.get(summary.lastMessageId);
          request.onsuccess = () => {
            const record = request.result as StoredChatMessageRecord | undefined;
            if (record && Number.isInteger(record.turnIndex)) {
              boundaryTurns.set(summary.lastMessageId!, record.turnIndex);
            }
            finish();
          };
          request.onerror = () => fail(request.error);
        }
        if (pending === 0) persistDeletion(messageCount, userMessageCount, charCount, summaries);
      };

      const continueAfterInitialReads = () => {
        pendingInitialReads--;
        if (pendingInitialReads > 0) return;
        if (!session) {
          fail(new Error(`[localDB] Session ${sessionId} not found for message deletion.`));
          return;
        }
        if (!target) {
          updatedSession = fromSessionStorageRecord(session);
          return;
        }
        if (target.sessionId !== sessionId) {
          fail(new Error(`[localDB] Message ${messageId} belongs to another session.`));
          return;
        }
        const hasStats = Number.isInteger(session.messageCount)
          && Number.isInteger(session.userMessageCount)
          && Number.isInteger(session.charCount);
        if (hasStats) {
          reconcileSummaries(
            session.messageCount ?? 0,
            session.userMessageCount ?? 0,
            session.charCount ?? 0,
          );
          return;
        }

        let messageCount = 0;
        let userMessageCount = 0;
        let charCount = 0;
        const cursorRequest = messagesStore.index("sessionId").openCursor(IDBKeyRange.only(sessionId));
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (cursor) {
            const record = cursor.value as StoredChatMessageRecord;
            messageCount++;
            if (record.role === "user") userMessageCount++;
            charCount += getStoredMessageText(record).length;
            cursor.continue();
            return;
          }
          reconcileSummaries(messageCount, userMessageCount, charCount);
        };
        cursorRequest.onerror = () => fail(cursorRequest.error);
      };

      sessionRequest.onsuccess = () => {
        session = sessionRequest.result as SessionStorageRecord | undefined;
        continueAfterInitialReads();
      };
      sessionRequest.onerror = () => fail(sessionRequest.error);
      messageRequest.onsuccess = () => {
        target = messageRequest.result as StoredChatMessageRecord | undefined;
        continueAfterInitialReads();
      };
      messageRequest.onerror = () => fail(messageRequest.error);
      transaction.oncomplete = () => resolve(updatedSession ?? fromSessionStorageRecord(session!));
      transaction.onerror = () => reject(transaction.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `session:${sessionId}:delete-message`, signal);
}
