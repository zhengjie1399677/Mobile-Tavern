import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { FavoriteSessionBackupPayload } from "../../src/domain/session-management";
import {
  __sessionBackupStorageTest,
  loadFavoriteSessionBackup,
  listFavoriteSessionBackups,
  saveFavoriteSessionBackup,
} from "../../src/infrastructure/sessionBackups/sessionBackupStorage";
import type { CharacterCard, ChatSession } from "../../src/types";

const DB_NAME = "MobileTavernSessionBackupDB";

function payload(title = "旅程"): FavoriteSessionBackupPayload {
  return {
    version: 1,
    session: {
      id: "session-1",
      characterId: "character-1",
      title,
      createdAt: 1,
      updatedAt: 2,
      lifecycle: "active",
      contentRevision: 1,
      messages: [{ id: "message-1", sender: "user", content: "你好", timestamp: 2 }],
      summaries: [],
    } satisfies ChatSession,
    character: {
      id: "character-1",
      name: "角色",
      first_mes: "",
      description: "",
      personality: "",
      avatar: "",
    } as unknown as CharacterCard,
    memoryDictEntries: [],
    memoryFragments: [],
    memoryFacts: [],
    attachments: [],
    agentJournal: [],
  };
}

async function resetDatabase(): Promise<void> {
  __sessionBackupStorageTest.close();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("backup database deletion blocked"));
  });
}

describe("收藏会话备份存储", () => {
  beforeEach(resetDatabase);

  it("更新时先写新版本并只保留一个元数据指针", async () => {
    const base = {
      id: "backup-1",
      sourceSessionId: "session-1",
      sourceRevision: 1,
      sourceUpdatedAt: 2,
      createdAt: 3,
      updatedAt: 3,
      title: "旅程",
      characterName: "角色",
      messageCount: 1,
    };
    const first = await saveFavoriteSessionBackup(base, payload());
    const second = await saveFavoriteSessionBackup({
      ...base,
      sourceRevision: 2,
      updatedAt: 4,
      title: "旅程续章",
    }, payload("旅程续章"));

    expect(second.versionId).not.toBe(first.versionId);
    expect(await listFavoriteSessionBackups()).toEqual([second]);
    expect((await loadFavoriteSessionBackup("backup-1")).payload.session.title).toBe("旅程续章");
  });

  it("回读时拒绝被篡改的备份版本", async () => {
    const metadata = await saveFavoriteSessionBackup({
      id: "backup-1",
      sourceSessionId: "session-1",
      sourceRevision: 1,
      sourceUpdatedAt: 2,
      createdAt: 3,
      updatedAt: 3,
      title: "旅程",
      characterName: "角色",
      messageCount: 1,
    }, payload());
    __sessionBackupStorageTest.close();
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("versions", "readwrite");
    const store = transaction.objectStore("versions");
    const record = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = store.get(metadata.versionId);
      request.onsuccess = () => resolve(request.result as Record<string, unknown>);
      request.onerror = () => reject(request.error);
    });
    store.put({
      ...record,
      payload: { ...(record.payload as FavoriteSessionBackupPayload), session: payload("已篡改").session },
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();

    await expect(loadFavoriteSessionBackup("backup-1")).rejects.toThrow("SESSION_BACKUP_INTEGRITY_FAILED");
  });
});
