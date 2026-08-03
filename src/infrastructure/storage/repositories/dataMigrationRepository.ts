import type { Message } from "../../../types";
import type { UnifiedBackupPayload } from "../../../application/useCases/dataMigrationUseCases";
import type { ExtractSource } from "../../../application/services/memory/types";
import { getDB } from "../idbConnection";
import { bindTransactionAbort, enqueueWrite } from "../idbQueue";
import { toCharacterCatalogRecord } from "../dbSchema";
import { toSessionStorageRecord } from "../sessionRecord";
import { prepareSettingsStorageRecords } from "./settingsRepository";

type PersistedImportMessage = Message & {
  turnIndex?: number;
  tags?: string[];
  extractSource?: ExtractSource;
  metadata?: Record<string, unknown>;
};

const REPLACED_STORES = [
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
] as const;

/**
 * 以单个 IndexedDB 事务原子替换备份覆盖范围内的全部用户数据。
 * settings Store 仅更新用户设置记录，保留设备本地 CryptoKey、用量与初始化标记。
 */
export async function replaceLocalDataFromBackup(
  payload: UnifiedBackupPayload,
  signal?: AbortSignal,
): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    const preparedSettings = await prepareSettingsStorageRecords(payload.settings, db);

    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([...REPLACED_STORES], "readwrite");
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

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("数据覆盖事务失败"));
      bindTransactionAbort(ctx, transaction, reject);

      try {
        for (const store of [
          charactersStore,
          catalogStore,
          sessionsStore,
          messagesStore,
          dictStore,
          fragmentsStore,
          factsStore,
          lorebooksStore,
          worldbooksStore,
        ]) {
          store.clear();
        }

        for (const character of payload.characters) {
          charactersStore.put(character);
          catalogStore.put(toCharacterCatalogRecord(character));
        }

        for (const session of payload.sessions) {
          sessionsStore.put(toSessionStorageRecord(session));
          session.messages.forEach((message, index) => {
            const persisted = message as PersistedImportMessage;
            messagesStore.put({
              id: message.id,
              sessionId: session.id,
              role: message.sender,
              content: message.content,
              createdAt: message.timestamp || Date.now(),
              turnIndex: persisted.turnIndex ?? index,
              tags: persisted.tags || [],
              extractSource: persisted.extractSource || "none",
              metadata: persisted.metadata || message.extra,
            });
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
      } catch (error: unknown) {
        try { transaction.abort(); } catch { /* 事务可能已自动中止 */ }
        reject(error);
      }
    });
  }, "data-migration:replace-all", signal);
}
