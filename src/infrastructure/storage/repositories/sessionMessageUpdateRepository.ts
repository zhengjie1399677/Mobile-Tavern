import type {
  ChatSession,
  ChatSessionMetadataPatch,
  Message,
  SummaryCard,
} from "../../../types";
import type {
  MemoryFragment,
  TemporalFact,
} from "../../../application/services/memory/types";
import { SESSION_STATE_SNAPSHOT_KEY } from "../../../domain/chat/sessionStateSnapshot";
import { getDB } from "../idbConnection";
import { bindTransactionAbort, enqueueWrite } from "../idbQueue";
import {
  fromStoredMessageRecord,
  toStoredMessageRecord,
  type StoredChatMessageRecord,
} from "../messageRecord";
import {
  deriveTurnCount,
  fromSessionStorageRecord,
  stripLegacySessionMessages,
  type SessionStorageRecord,
} from "../sessionRecord";

function withoutStateSnapshot(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata || !(SESSION_STATE_SNAPSHOT_KEY in metadata)) return metadata;
  const next = { ...metadata };
  delete next[SESSION_STATE_SNAPSHOT_KEY];
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * 原子编辑一条历史消息，并失效该轮次之后无法再证明正确的摘要、状态快照和派生记忆。
 * 编辑是低频操作，允许在事务内读取该会话完整消息以统一重算统计与摘要边界。
 */
export function updateSessionMessage(
  sessionId: string,
  message: Message,
  metadataPatch: ChatSessionMetadataPatch,
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
      let result: ChatSession | undefined;

      const fail = (error: unknown) => {
        try { transaction.abort(); } catch { /* 事务可能已结束 */ }
        reject(error);
      };

      const sessionRequest = sessionsStore.get(sessionId);
      const messagesRequest = messagesStore.index("sessionId")
        .getAll(IDBKeyRange.only(sessionId));
      const fragmentsRequest = fragmentsStore.index("sessionId")
        .getAll(IDBKeyRange.only(sessionId));
      const factsRequest = factsStore.index("sessionId")
        .getAll(IDBKeyRange.only(sessionId));

      let pending = 4;
      let session: SessionStorageRecord | undefined;
      let records: StoredChatMessageRecord[] = [];
      let fragments: MemoryFragment[] = [];
      let facts: TemporalFact[] = [];
      const finishRead = () => {
        pending--;
        if (pending !== 0) return;
        if (!session) {
          fail(new Error(`[localDB] Session ${sessionId} not found for message update.`));
          return;
        }
        const existing = records.find((record) => record.id === message.id);
        if (!existing) {
          fail(new Error(`[localDB] Message ${message.id} not found for update.`));
          return;
        }
        if (existing.sessionId !== sessionId) {
          fail(new Error(`[localDB] Message ${message.id} belongs to another session.`));
          return;
        }

        const invalidFragmentIds = new Set(
          fragments
            .filter((fragment) => fragment.sourceTurnEnd >= existing.turnIndex)
            .map((fragment) => fragment.id),
        );
        for (const fragment of fragments) {
          if (invalidFragmentIds.has(fragment.id)) fragmentsStore.delete(fragment.id);
        }
        for (const fact of facts) {
          if (fact.validFromTurn >= existing.turnIndex || fact.sourceMessageId === message.id) {
            factsStore.delete(fact.id);
          }
        }

        const dictCursor = dictStore.index("sessionId").openCursor(IDBKeyRange.only(sessionId));
        dictCursor.onsuccess = () => {
          const cursor = dictCursor.result;
          if (!cursor) return;
          cursor.delete();
          cursor.continue();
        };
        dictCursor.onerror = () => fail(dictCursor.error);

        const hydratedExisting = fromStoredMessageRecord(existing);
        const mergedMetadata = withoutStateSnapshot({
          ...(existing.metadata ?? {}),
          ...(message.extra ?? {}),
          ...(message.metadata ?? {}),
        });
        const updatedRecord = toStoredMessageRecord(
          sessionId,
          {
            ...hydratedExisting,
            ...message,
            extra: mergedMetadata,
            metadata: mergedMetadata,
            tags: existing.content === message.content ? existing.tags : [],
            extractSource: existing.content === message.content ? existing.extractSource : "none",
          },
          existing.turnIndex,
        );

        const nextRecords = records.map((record) =>
          record.id === message.id ? updatedRecord : record
        );
        for (const record of nextRecords) {
          if (record.id === message.id) {
            messagesStore.put(record);
            continue;
          }
          if (record.turnIndex < existing.turnIndex) continue;
          const metadata = withoutStateSnapshot(record.metadata);
          if (metadata !== record.metadata) messagesStore.put({ ...record, metadata });
        }

        const boundaryTurns = new Map(nextRecords.map((record) => [record.id, record.turnIndex]));
        const summaries = (session.summaries ?? []).filter((summary: SummaryCard) => {
          if (!summary.lastMessageId) return false;
          const boundaryTurn = boundaryTurns.get(summary.lastMessageId);
          return boundaryTurn !== undefined && boundaryTurn < existing.turnIndex;
        });
        const messageCount = nextRecords.length;
        const userMessageCount = nextRecords.filter((record) => record.role === "user").length;
        const nextRecord: SessionStorageRecord = {
          ...stripLegacySessionMessages(session),
          ...metadataPatch,
          summaries,
          lastSummarizedMessageId: summaries.at(-1)?.lastMessageId,
          pinnedMessageIds: session.pinnedMessageIds?.filter((id) => !invalidFragmentIds.has(id)),
          mutedMessageIds: session.mutedMessageIds?.filter((id) => !invalidFragmentIds.has(id)),
          messageCount,
          userMessageCount,
          turnCount: deriveTurnCount(messageCount, userMessageCount),
          charCount: nextRecords.reduce((total, record) => total + record.content.length, 0),
        };
        sessionsStore.put(nextRecord);
        result = fromSessionStorageRecord(nextRecord);
      };

      sessionRequest.onsuccess = () => {
        session = sessionRequest.result as SessionStorageRecord | undefined;
        finishRead();
      };
      messagesRequest.onsuccess = () => {
        records = messagesRequest.result as StoredChatMessageRecord[];
        finishRead();
      };
      fragmentsRequest.onsuccess = () => {
        fragments = fragmentsRequest.result as MemoryFragment[];
        finishRead();
      };
      factsRequest.onsuccess = () => {
        facts = factsRequest.result as TemporalFact[];
        finishRead();
      };
      sessionRequest.onerror = () => fail(sessionRequest.error);
      messagesRequest.onerror = () => fail(messagesRequest.error);
      fragmentsRequest.onerror = () => fail(fragmentsRequest.error);
      factsRequest.onerror = () => fail(factsRequest.error);
      transaction.oncomplete = () => {
        if (result) resolve(result);
        else reject(new Error(`[localDB] Message update for ${message.id} completed without result.`));
      };
      transaction.onerror = () => reject(transaction.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `session:${sessionId}:message:${message.id}:update`, signal);
}
