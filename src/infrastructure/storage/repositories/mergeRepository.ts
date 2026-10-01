/**
 * 以合并结果增量更新本地数据的写入通道。
 *
 * 与 `dataMigrationRepository` 的整体覆盖相对：覆盖的语义是"本地世界从此等于备份世界"，
 * 这里则是"把对端独有内容并进来、把已删除内容去掉"，本地独有数据必须原样保留。
 * 两者是不同职责，因此分文件维护，避免共用一份 Store 清单与清空假设。
 */
import type { UnifiedBackupPayload } from "../../../application/useCases/dataMigrationUseCases";
import { getDB } from "../idbConnection";
import { bindTransactionAbort, enqueueWrite } from "../idbQueue";
import { toCharacterCatalogRecord } from "../dbSchema";
import { toSessionStorageRecord } from "../sessionRecord";
import { toStoredMessageRecord } from "../messageRecord";
import { prepareSettingsStorageRecords } from "./settingsRepository";
import { putTombstones } from "./tombstoneRepository";

/** 合并涉及的 Store 集合；与整体覆盖一致，区别仅在于不做 clear()。 */
const MERGED_STORES = [
  "characters",
  "character_catalog",
  "sessions",
  "messages",
  "memory_dict",
  "memory_fragments",
  "memory_facts",
  "settings",
  "lorebooks",
  "worldbooks",
  "sync_tombstones",
] as const;

/**
 * 以合并结果增量更新本地数据，**不清空任何 Store**。
 *
 * 两条关键约束：
 *  - 不做 clear()：本地独有、对端没有的数据必须留下来，这正是"合并"与"覆盖"的全部区别；
 *  - 只删除确定应当消失的实体：合并结果里不再存在的会话与消息。它们之所以消失，是因为
 *    删除墓碑判定其应当被删除 —— 合并算法本身只求并集，不会丢数据。
 *
 * 因此本函数只接受 `mergeBackupPayloads` 产出的信封，不能用于普通备份导入。
 */
export async function mergeLocalDataFromBackup(
  payload: UnifiedBackupPayload,
  signal?: AbortSignal,
): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    const preparedSettings = await prepareSettingsStorageRecords(payload.settings, db);
    const liveSessionIds = new Set(payload.sessions.map((session) => session.id));
    const liveMessageIds = new Set(
      payload.sessions.flatMap((session) =>
        session.messages.map((message) => message.id)),
    );

    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([...MERGED_STORES], "readwrite");
      const charactersStore = transaction.objectStore("characters");
      const catalogStore = transaction.objectStore("character_catalog");
      const sessionsStore = transaction.objectStore("sessions");
      const messagesStore = transaction.objectStore("messages");
      const dictStore = transaction.objectStore("memory_dict");
      const fragmentsStore = transaction.objectStore("memory_fragments");
      const factsStore = transaction.objectStore("memory_facts");
      const settingsStore = transaction.objectStore("settings");
      const lorebooksStore = transaction.objectStore("lorebooks");
      const worldbooksStore = transaction.objectStore("worldbooks");
      const tombstonesStore = transaction.objectStore("sync_tombstones");

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("数据合并事务失败"));
      bindTransactionAbort(ctx, transaction, reject);

      const fail = (error: unknown) => {
        try { transaction.abort(); } catch { /* 事务可能已自动中止 */ }
        reject(error);
      };

      /** 删除某会话在记忆分轨中的全部残留；会话消失后这些数据不再有归属。 */
      const deleteMemoryBySession = (store: IDBObjectStore, sessionId: string) => {
        const request = store.index("sessionId").openCursor(IDBKeyRange.only(sessionId));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          cursor.delete();
          cursor.continue();
        };
        request.onerror = () => fail(request.error);
      };

      // 两个读取结果都到齐后再提交，避免任一侧先到就按不完整的差集删数据。
      const sessionKeysRequest = sessionsStore.getAllKeys();
      const messageKeysRequest = messagesStore.getAllKeys();
      let pendingReads = 2;
      let staleSessionIds: string[] = [];
      let staleMessageIds: string[] = [];

      const commitMerge = () => {
        pendingReads -= 1;
        if (pendingReads > 0) return;

        try {
          for (const sessionId of staleSessionIds) {
            sessionsStore.delete(sessionId);
            deleteMemoryBySession(dictStore, sessionId);
            deleteMemoryBySession(fragmentsStore, sessionId);
            deleteMemoryBySession(factsStore, sessionId);
          }
          for (const messageId of staleMessageIds) messagesStore.delete(messageId);

          for (const character of payload.characters) {
            charactersStore.put(character);
            catalogStore.put(toCharacterCatalogRecord(character));
          }

          for (const session of payload.sessions) {
            sessionsStore.put(toSessionStorageRecord(session));
            session.messages.forEach((message, index) => {
              messagesStore.put(toStoredMessageRecord(
                session.id,
                message,
                message.turnIndex ?? index,
              ));
            });
          }

          for (const entry of payload.memoryDictEntries) dictStore.put(entry);
          for (const fragment of payload.memoryFragments) fragmentsStore.put(fragment);
          for (const fact of payload.memoryFacts) factsStore.put(fact);

          settingsStore.put(preparedSettings.largePrompts, "user_settings_large_prompts");
          settingsStore.put(preparedSettings.settings, "user_settings");
          settingsStore.put(payload.savedPresets, "saved_presets_bundle");
          lorebooksStore.put(payload.globalLorebook, "global_lorebook");
          worldbooksStore.put(payload.customWorldbooks, "custom_worldbooks");

          // 墓碑以合并结果为权威：它既含双方的删除事实，也已剔除被复活的条目。
          tombstonesStore.clear();
          putTombstones(tombstonesStore, payload.tombstones ?? []);
        } catch (error: unknown) {
          fail(error);
        }
      };

      sessionKeysRequest.onsuccess = () => {
        staleSessionIds = (sessionKeysRequest.result as string[])
          .filter((id) => !liveSessionIds.has(id));
        commitMerge();
      };
      sessionKeysRequest.onerror = () => fail(sessionKeysRequest.error);
      messageKeysRequest.onsuccess = () => {
        staleMessageIds = (messageKeysRequest.result as string[])
          .filter((id) => !liveMessageIds.has(id));
        commitMerge();
      };
      messageKeysRequest.onerror = () => fail(messageKeysRequest.error);
    });
  }, "data-migration:merge", signal);
}
