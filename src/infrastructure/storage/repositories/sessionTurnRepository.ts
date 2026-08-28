import type {
  ChatSessionMetadataPatch,
  Message,
} from "../../../types";
import { getDB } from "../idbConnection";
import { bindTransactionAbort, enqueueWrite } from "../idbQueue";
import {
  advanceSessionContentRevision,
  deriveTurnCount,
  stripLegacySessionMessages,
  type SessionStorageRecord,
} from "../sessionRecord";
import {
  getStoredMessageText,
  toStoredMessageRecord,
  type PersistableMessage,
  type StoredChatMessageRecord,
} from "../messageRecord";

/**
 * 原子提交一次输出流水线产生的消息及会话状态。
 *
 * 多条消息（例如 AI 回复与 Bison 系统提取结果）共享一个事务；消息总计数、变量和
 * 状态表只在全部消息写入成功后一起生效。旧会话缺少内部计数基线时执行一次读修复，
 * 后续提交走 O(新增消息数) 快速路径。
 */
export function commitSessionTurn(
  sessionId: string,
  metadataPatch: ChatSessionMetadataPatch,
  messages: Message[],
  signal?: AbortSignal,
): Promise<void> {
  const uniqueMessages = Array.from(
    new Map(messages.map((message) => [message.id, message])).values(),
  );
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(["sessions", "messages"], "readwrite");
      const sessionsStore = transaction.objectStore("sessions");
      const messagesStore = transaction.objectStore("messages");
      const sessionRequest = sessionsStore.get(sessionId);

      const fail = (error: unknown) => {
        try { transaction.abort(); } catch { /* 事务可能已终止 */ }
        reject(error);
      };

      const write = (
        session: SessionStorageRecord,
        existingById: ReadonlyMap<string, StoredChatMessageRecord>,
        baseMessageCount: number,
        baseUserMessageCount: number,
        baseCharCount: number,
        initialMaxTurnIndex: number,
      ) => {
        let messageCount = baseMessageCount;
        let userMessageCount = baseUserMessageCount;
        let charCount = baseCharCount;
        let maxTurnIndex = initialMaxTurnIndex;

        for (const message of uniqueMessages) {
          const persisted = message as PersistableMessage;
          const existing = existingById.get(message.id);
          if (existing && existing.sessionId !== sessionId) {
            fail(new Error(`[localDB] Message ${message.id} belongs to another session.`));
            return;
          }
          if (existing) {
            charCount -= getStoredMessageText(existing).length;
            if (existing.role === "user") userMessageCount--;
          } else {
            messageCount++;
          }
          charCount += message.content.length;
          if (message.sender === "user") userMessageCount++;

          const turnIndex = existing?.turnIndex
            ?? persisted.turnIndex
            ?? ++maxTurnIndex;
          maxTurnIndex = Math.max(maxTurnIndex, turnIndex);
          messagesStore.put(toStoredMessageRecord(sessionId, persisted, turnIndex));
        }

        const latestMessage = uniqueMessages.reduce<Message | undefined>((latest, message) =>
          !latest || message.timestamp > latest.timestamp ? message : latest,
        undefined);
        sessionsStore.put(advanceSessionContentRevision({
          ...stripLegacySessionMessages(session),
          ...metadataPatch,
          messageCount,
          userMessageCount,
          turnCount: deriveTurnCount(messageCount, userMessageCount),
          charCount,
        }, latestMessage ? {
          activityTime: latestMessage.timestamp,
          lastMessagePreview: latestMessage.content,
        } : undefined));
      };

      sessionRequest.onsuccess = () => {
        const session = sessionRequest.result as SessionStorageRecord | undefined;
        if (!session) {
          fail(new Error(`[localDB] Session ${sessionId} not found for turn commit.`));
          return;
        }

        const hasStats = Number.isInteger(session.messageCount)
          && Number.isInteger(session.userMessageCount)
          && Number.isInteger(session.charCount);
        if (!hasStats) {
          const existingById = new Map<string, StoredChatMessageRecord>();
          let messageCount = 0;
          let userMessageCount = 0;
          let charCount = 0;
          let maxTurnIndex = -1;
          const cursorRequest = messagesStore.index("sessionId")
            .openCursor(IDBKeyRange.only(sessionId));
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (cursor) {
              const record = cursor.value as StoredChatMessageRecord;
              existingById.set(record.id, record);
              messageCount++;
              if (record.role === "user") userMessageCount++;
              charCount += getStoredMessageText(record).length;
              if (Number.isInteger(record.turnIndex)) {
                maxTurnIndex = Math.max(maxTurnIndex, record.turnIndex);
              }
              cursor.continue();
              return;
            }
            write(session, existingById, messageCount, userMessageCount, charCount, maxTurnIndex);
          };
          cursorRequest.onerror = () => fail(cursorRequest.error);
          return;
        }

        const existingById = new Map<string, StoredChatMessageRecord>();
        let pending = uniqueMessages.length + 1;
        let maxTurnIndex = -1;
        const finishRead = () => {
          pending--;
          if (pending !== 0) return;
          write(
            session,
            existingById,
            session.messageCount ?? 0,
            session.userMessageCount ?? 0,
            session.charCount ?? 0,
            maxTurnIndex,
          );
        };

        for (const message of uniqueMessages) {
          const request = messagesStore.get(message.id);
          request.onsuccess = () => {
            if (request.result) {
              existingById.set(message.id, request.result as StoredChatMessageRecord);
            }
            finishRead();
          };
          request.onerror = () => fail(request.error);
        }

        const maxRequest = messagesStore.index("sessionId_turnIndex_createdAt").openCursor(
          IDBKeyRange.bound(
            [sessionId, -Infinity, -Infinity],
            [sessionId, Infinity, Infinity],
          ),
          "prev",
        );
        maxRequest.onsuccess = () => {
          const value = maxRequest.result?.value as StoredChatMessageRecord | undefined;
          maxTurnIndex = Number.isInteger(value?.turnIndex) ? value?.turnIndex ?? -1 : -1;
          finishRead();
        };
        maxRequest.onerror = () => fail(maxRequest.error);
      };
      sessionRequest.onerror = () => fail(sessionRequest.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `session:${sessionId}:turn`, signal);
}
