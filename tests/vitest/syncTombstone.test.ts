/**
 * 跨设备同步墓碑的回归测试。
 *
 * 墓碑是"删除能否传播到另一台设备"的唯一依据：一旦删除路径漏写墓碑，
 * 该次删除在下次同步时就会被对端数据覆盖回来。因此这里既覆盖纯领域规则，
 * 也用真实 IndexedDB 断言删除路径确实在同一事务内落下了墓碑。
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDB } from "../../src/infrastructure/storage/idbConnection";
import { __resetDBInstanceForTesting } from "../../src/utils/localDB";
import {
  buildMessageTombstone,
  buildSessionTombstone,
  listSyncTombstones,
  replaceSyncTombstones,
} from "../../src/infrastructure/storage/repositories/tombstoneRepository";
import { deleteSession } from "../../src/infrastructure/storage/repositories/sessionsWriteRepository";
import { deleteSessionMessage } from "../../src/infrastructure/storage/repositories/sessionMessageDeleteRepository";
import {
  dedupeSyncTombstones,
  isTombstoneEffective,
  syncTombstoneKey,
  type SyncTombstone,
} from "../../src/domain/sync/tombstones";
import {
  parseSyncTombstones,
  UNIFIED_BACKUP_VERSION,
} from "../../src/application/useCases/dataMigrationUseCases";
import { describeBackupVersionGap } from "../../src/application/useCases/backupPayloadRestore";
import type { Message } from "../../src/types";

const SESSION_ID = "tombstone-session";

function makeMessage(index: number): Message {
  return {
    id: `tombstone-message-${index}`,
    sender: index % 2 === 1 ? "user" : "assistant",
    content: `墓碑测试对话 ${index}`,
    timestamp: 100 + index,
  };
}

async function seedSession(): Promise<void> {
  const db = await getDB();
  const messages = [makeMessage(1), makeMessage(2), makeMessage(3)];
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(["sessions", "messages"], "readwrite");
    transaction.objectStore("sessions").put({
      id: SESSION_ID,
      characterId: "character-1",
      title: "墓碑测试会话",
      createdAt: 1,
      summaries: [],
      lifecycle: "active",
      updatedAt: 1,
      contentRevision: 1,
      messageCount: messages.length,
      userMessageCount: messages.filter((message) => message.sender === "user").length,
      charCount: messages.reduce((total, message) => total + message.content.length, 0),
    });
    messages.forEach((message, turnIndex) => {
      transaction.objectStore("messages").put({
        id: message.id,
        sessionId: SESSION_ID,
        role: message.sender,
        content: message.content,
        createdAt: message.timestamp,
        turnIndex,
        tags: [],
        extractSource: "none",
      });
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

describe("同步墓碑领域规则", () => {
  const tombstone = buildSessionTombstone("session-a", 1_000);

  it("记录不存在时墓碑生效，表示删除尚未被对端接受", () => {
    expect(isTombstoneEffective(tombstone, undefined)).toBe(true);
  });

  it("记录最后修改不晚于删除时间时墓碑生效", () => {
    expect(isTombstoneEffective(tombstone, 999)).toBe(true);
    expect(isTombstoneEffective(tombstone, 1_000)).toBe(true);
  });

  it("记录在删除之后被重新写入时墓碑失效，允许复活", () => {
    expect(isTombstoneEffective(tombstone, 1_001)).toBe(false);
  });

  it("非有限的时间戳按墓碑生效处理，避免脏数据抹掉删除事实", () => {
    expect(isTombstoneEffective(tombstone, Number.NaN)).toBe(true);
  });

  it("同一实体的多条墓碑收敛为删除时间较晚的一条", () => {
    const older: SyncTombstone = { ...tombstone, deletedAt: 500 };
    const newer: SyncTombstone = { ...tombstone, deletedAt: 2_000 };
    const merged = dedupeSyncTombstones([older, newer, { ...older }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].deletedAt).toBe(2_000);
  });

  it("不同实体或不同目标产生不同的去重键", () => {
    const keys = new Set([
      syncTombstoneKey("session", "a"),
      syncTombstoneKey("message", "a"),
      syncTombstoneKey("session", "b"),
    ]);
    expect(keys.size).toBe(3);
  });
});

describe("同步墓碑存储", () => {
  beforeEach(async () => {
    __resetDBInstanceForTesting();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("MobileTavernLiteDB");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
    await seedSession();
  });

  afterEach(() => {
    __resetDBInstanceForTesting();
  });

  it("删除会话会在同一事务内留下会话墓碑", async () => {
    await deleteSession(SESSION_ID);
    const tombstones = await listSyncTombstones();
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].entity).toBe("session");
    expect(tombstones[0].targetId).toBe(SESSION_ID);
    expect(tombstones[0].sessionId).toBe(SESSION_ID);
    expect(tombstones[0].deletedAt).toBeGreaterThan(0);
  });

  it("删除单条消息会留下带归属会话的消息墓碑", async () => {
    await deleteSessionMessage(SESSION_ID, "tombstone-message-2");
    const tombstones = await listSyncTombstones();
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].entity).toBe("message");
    expect(tombstones[0].targetId).toBe("tombstone-message-2");
    expect(tombstones[0].sessionId).toBe(SESSION_ID);
  });

  it("删除不存在的消息不会伪造墓碑", async () => {
    await deleteSessionMessage(SESSION_ID, "not-existing-message");
    expect(await listSyncTombstones()).toEqual([]);
  });

  it("墓碑替换会整体覆盖旧集合", async () => {
    await deleteSession(SESSION_ID);
    await replaceSyncTombstones([buildMessageTombstone("other", "m-1", 42)]);
    const tombstones = await listSyncTombstones();
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].targetId).toBe("m-1");
    expect(tombstones[0].deletedAt).toBe(42);
  });
});

describe("墓碑备份边界", () => {
  it("缺失 tombstones 字段的旧备份降级为空集合", () => {
    expect(parseSyncTombstones(undefined)).toEqual([]);
  });

  it("非数组结构直接拒绝，不做部分放行", () => {
    expect(() => parseSyncTombstones({ entity: "session" })).toThrow(/必须是数组/);
  });

  it("字段缺失或不合法时拒绝整份备份", () => {
    expect(() => parseSyncTombstones([{ entity: "unknown", targetId: "a", sessionId: "a", deletedAt: 1 }]))
      .toThrow(/基础字段无效/);
    expect(() => parseSyncTombstones([{ entity: "session", targetId: "", sessionId: "a", deletedAt: 1 }]))
      .toThrow(/基础字段无效/);
    expect(() => parseSyncTombstones([{ entity: "session", targetId: "a", sessionId: "a", deletedAt: "1" }]))
      .toThrow(/基础字段无效/);
  });

  it("同一实体重复出现视为损坏", () => {
    const entry = { entity: "session", targetId: "a", sessionId: "a", deletedAt: 1 };
    expect(() => parseSyncTombstones([entry, { ...entry, deletedAt: 2 }]))
      .toThrow(/重复/);
  });

  it("合法墓碑原样收口，deviceId 可选", () => {
    const parsed = parseSyncTombstones([
      { entity: "message", targetId: "m-1", sessionId: "s-1", deletedAt: 10, deviceId: "dev-1" },
      { entity: "session", targetId: "s-2", sessionId: "s-2", deletedAt: 20 },
    ]);
    expect(parsed).toEqual([
      { entity: "message", targetId: "m-1", sessionId: "s-1", deletedAt: 10, deviceId: "dev-1" },
      { entity: "session", targetId: "s-2", sessionId: "s-2", deletedAt: 20, deviceId: undefined },
    ]);
  });

  it("备份信封版本已升级并可区分缺失墓碑的旧备份", () => {
    expect(UNIFIED_BACKUP_VERSION).toBe(7);
    expect(describeBackupVersionGap(6).code).toBe("legacy_v6");
    expect(describeBackupVersionGap(6).missing).toContain("跨设备删除记录");
    expect(describeBackupVersionGap(7).code).toBe("current");
  });
});
