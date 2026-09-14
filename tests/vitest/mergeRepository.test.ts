/**
 * 合并写入通道的集成测试（真实 IndexedDB）。
 *
 * 与整体覆盖的差别容易被说成"不清空 Store"，但真正要守住的是：
 * 合并结果里缺失的会话被**精确**删除（而不是全库清空），且随会话消失的记忆分轨
 * 必须一并清理，否则会留下指向不存在会话的孤儿数据。
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDB } from "../../src/infrastructure/storage/idbConnection";
import { __resetDBInstanceForTesting } from "../../src/utils/localDB";
import { mergeLocalDataFromBackup } from "../../src/infrastructure/storage/repositories/mergeRepository";
import { listSyncTombstones } from "../../src/infrastructure/storage/repositories/tombstoneRepository";
import { mergeBackupPayloads } from "../../src/application/useCases/backupMerge";
import { buildUnifiedBackupPayload } from "../../src/application/useCases/dataMigrationUseCases";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import type { SyncTombstone } from "../../src/domain/sync/tombstones";
import type { ChatSession, Message } from "../../src/types";
import type { MemoryFragment } from "../../src/application/services/memory/types";

function makeMessage(id: string, timestamp: number): Message {
  return { id, sender: "user", content: `内容 ${id}`, timestamp };
}

function makeSession(id: string, messages: Message[], updatedAt = 100): ChatSession {
  return {
    id,
    characterId: "character-1",
    title: `会话 ${id}`,
    createdAt: 1,
    messages,
    summaries: [],
    lifecycle: "active",
    updatedAt,
    contentRevision: 1,
  };
}

function makeFragment(id: string, sessionId: string): MemoryFragment {
  return {
    id,
    sessionId,
    content: `片段 ${id}`,
    participants: [],
    tags: [],
    sourceMessageIds: [],
    sourceRole: "assistant",
    sourceTurnStart: 0,
    sourceTurnEnd: 0,
    status: "active",
    importance: 0.5,
    confidence: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makePayload(
  sessions: ChatSession[],
  tombstones: SyncTombstone[] = [],
) {
  return buildUnifiedBackupPayload({
    characters: [],
    sessions,
    memoryDictEntries: [],
    memoryFragments: [],
    memoryFacts: [],
    settings: DEFAULT_SETTINGS,
    savedPresets: [],
    globalLorebook: [],
    customWorldbooks: {},
    tombstones,
    backupDate: "2026-09-14T00:00:00.000Z",
    isEncrypted: false,
  });
}

async function readSessionIds(): Promise<string[]> {
  const db = await getDB();
  return new Promise<string[]>((resolve, reject) => {
    const request = db.transaction("sessions", "readonly").objectStore("sessions").getAllKeys();
    request.onsuccess = () => resolve((request.result as string[]).sort());
    request.onerror = () => reject(request.error);
  });
}

async function readMessageIds(): Promise<string[]> {
  const db = await getDB();
  return new Promise<string[]>((resolve, reject) => {
    const request = db.transaction("messages", "readonly").objectStore("messages").getAllKeys();
    request.onsuccess = () => resolve((request.result as string[]).sort());
    request.onerror = () => reject(request.error);
  });
}

async function readFragmentIds(): Promise<string[]> {
  const db = await getDB();
  return new Promise<string[]>((resolve, reject) => {
    const request = db.transaction("memory_fragments", "readonly")
      .objectStore("memory_fragments").getAllKeys();
    request.onsuccess = () => resolve((request.result as string[]).sort());
    request.onerror = () => reject(request.error);
  });
}

/** 本地种子：会话 a（m1、m2）+ 记忆片段 f1，会话 b（m3）。 */
async function seedLocal(): Promise<void> {
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(
      ["sessions", "messages", "memory_fragments"],
      "readwrite",
    );
    transaction.objectStore("sessions").put(makeSession("a", []));
    transaction.objectStore("sessions").put(makeSession("b", []));
    for (const [sessionId, messageIds] of [["a", ["m1", "m2"]], ["b", ["m3"]]] as const) {
      messageIds.forEach((messageId, turnIndex) => {
        transaction.objectStore("messages").put({
          id: messageId,
          sessionId,
          role: "user",
          content: `内容 ${messageId}`,
          createdAt: 100 + turnIndex,
          turnIndex,
          tags: [],
          extractSource: "none",
        });
      });
    }
    transaction.objectStore("memory_fragments").put(makeFragment("f1", "a"));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

describe("合并写入通道", () => {
  beforeEach(async () => {
    __resetDBInstanceForTesting();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("MobileTavernLiteDB");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
    await seedLocal();
  });

  afterEach(() => {
    __resetDBInstanceForTesting();
  });

  it("以合并结果为准：新会话写入、缺失的会话删除、其余保留", async () => {
    const merged = makePayload([
      makeSession("a", [makeMessage("m1", 100), makeMessage("m2", 101)]),
      makeSession("c", [makeMessage("m4", 200)]),
    ]);

    await mergeLocalDataFromBackup(merged);

    // b 不在合并结果里 => 被精确删除（不是清空整库后重灌）。
    expect(await readSessionIds()).toEqual(["a", "c"]);
    expect(await readMessageIds()).toEqual(["m1", "m2", "m4"]);
  });

  it("合并算法的输出可直接落库，消息轮次连续无重复", async () => {
    const local = makePayload([
      makeSession("a", [{ ...makeMessage("m1", 100), turnIndex: 0 }]),
    ]);
    const remote = makePayload([
      makeSession("a", [
        { ...makeMessage("m1", 100), turnIndex: 0 },
        { ...makeMessage("m5", 150), turnIndex: 1 },
      ]),
    ]);

    // 两条路径的契约：算法产出的信封必须能被写入通道原样接受。
    const plan = mergeBackupPayloads({ local, remote });
    await mergeLocalDataFromBackup(plan.merged);

    const db = await getDB();
    const records = await new Promise<Array<{ id: string; turnIndex: number }>>((resolve, reject) => {
      const request = db.transaction("messages", "readonly")
        .objectStore("messages").index("sessionId").getAll("a");
      request.onsuccess = () => resolve(request.result as Array<{ id: string; turnIndex: number }>);
      request.onerror = () => reject(request.error);
    });
    const ordered = [...records]
      .sort((left, right) => left.turnIndex - right.turnIndex)
      .map((record) => record.id);
    expect(ordered).toEqual(["m1", "m5"]);
    expect(records.map((record) => record.turnIndex).sort()).toEqual([0, 1]);
  });

  it("会话被合并结果移除时其记忆分轨一并清理，不留下孤儿", async () => {
    const merged = makePayload(
      [makeSession("c", [makeMessage("m4", 200)])],
      [{ entity: "session", targetId: "a", sessionId: "a", deletedAt: 500 }],
    );

    await mergeLocalDataFromBackup(merged);

    expect(await readSessionIds()).toEqual(["c"]);
    expect(await readMessageIds()).toEqual(["m4"]);
    expect(await readFragmentIds()).toEqual([]);
  });

  it("墓碑以合并结果整体覆盖，本地旧墓碑不会残留", async () => {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("sync_tombstones", "readwrite");
      transaction.objectStore("sync_tombstones").put(
        { entity: "session", targetId: "stale", sessionId: "stale", deletedAt: 1 },
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    const merged = makePayload(
      [makeSession("a", [makeMessage("m1", 100)])],
      [{ entity: "message", targetId: "m9", sessionId: "a", deletedAt: 900 }],
    );
    await mergeLocalDataFromBackup(merged);

    const tombstones = await listSyncTombstones();
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].targetId).toBe("m9");
  });

  it("合并结果没有墓碑时清空本地墓碑集合", async () => {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("sync_tombstones", "readwrite");
      transaction.objectStore("sync_tombstones").put(
        { entity: "session", targetId: "stale", sessionId: "stale", deletedAt: 1 },
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    await mergeLocalDataFromBackup(makePayload([makeSession("a", [makeMessage("m1", 100)])]));
    expect(await listSyncTombstones()).toEqual([]);
  });
});
