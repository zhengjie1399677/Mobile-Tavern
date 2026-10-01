import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { guardSourceMessages } from "../../src/infrastructure/storage/memorySourceGuard";
import { getDB } from "../../src/infrastructure/storage/idbConnection";
import { __resetDBInstanceForTesting } from "../../src/utils/localDB";
import {
  getFragmentById,
  upsertFragment,
} from "../../src/infrastructure/storage/indexedDbMemoryStore";
import {
  evolveTemporalFact,
  getTemporalFactsBySession,
} from "../../src/infrastructure/storage/repositories/memoryFactsRepository";
import type { MemoryFragment, TemporalFact } from "../../src/application/services/memory/types";

/**
 * 回归测试：记忆写入的来源消息校验不得静默成功。
 *
 * 背景（P1 数据静默丢失）：`requireSourceMessages` / `requireSourceMessage` 为真时，
 * 分片与事实的写入会先校验来源消息。历史实现校验不通过时既不写库也不 reject，
 * 事务因没有写请求而正常 complete，`transaction.oncomplete` 照常 resolve，
 * 调用方拿到"写入成功"的假信号，记忆实际从未落库且没有任何日志。
 *
 * 修复后的语义边界：
 *  - 来源消息不存在 / 属于其他会话 → 删除竞态的正常结果：跳过写入并记录 warn（可观测），
 *    调用方仍拿到 resolve，但数据确实没有落库。
 *  - 要求校验却未绑定任何来源 → 调用方缺陷，必须显式 reject。
 */

const sessionId = "guard-session";
const otherSessionId = "guard-session-other";

// ===== 单元层：用最小事务替身锁定校验语义 =====

type FakeRequest = {
  result?: unknown;
  error?: unknown;
  onsuccess?: () => void;
  onerror?: () => void;
};

function fakeTransaction(
  messages: Record<string, { sessionId: string } | undefined>,
  options?: { failReadIds?: readonly string[] },
) {
  const requests: FakeRequest[] = [];
  const failReadIds = new Set(options?.failReadIds ?? []);
  const transaction = {
    objectStore(name: string) {
      if (name !== "messages") throw new Error(`unexpected store: ${name}`);
      return {
        get(id: string): FakeRequest {
          const fails = failReadIds.has(id);
          const request: FakeRequest = fails
            ? { error: new Error(`read failed: ${id}`) }
            : { result: messages[id] };
          requests.push(request);
          // 以微任务模拟 IDB 事件时序：onsuccess/onerror 由调用方同步注册后再触发。
          queueMicrotask(() => {
            if (fails) request.onerror?.();
            else request.onsuccess?.();
          });
          return request;
        },
      };
    },
  } as unknown as IDBTransaction;
  return { transaction, requests };
}

function runGuard(options: {
  messages?: Record<string, { sessionId: string } | undefined>;
  failReadIds?: readonly string[];
  sessionId?: string;
  sourceMessageIds: readonly string[];
}) {
  const { transaction, requests } = fakeTransaction(options.messages ?? {}, {
    failReadIds: options.failReadIds,
  });
  const rejections: unknown[] = [];
  let validCalls = 0;
  guardSourceMessages(
    transaction,
    {
      ownerKind: "Fragment",
      ownerId: "frag-1",
      sessionId: options.sessionId ?? sessionId,
      sourceMessageIds: options.sourceMessageIds,
    },
    () => {
      validCalls += 1;
    },
    (error) => {
      rejections.push(error);
    },
  );
  return { requests, rejections, validCalls: () => validCalls };
}

describe("guardSourceMessages 校验语义", () => {
  it("来源消息存在且同会话时回调 onValid 且不 reject", async () => {
    const result = runGuard({
      messages: { "msg-1": { sessionId } },
      sourceMessageIds: ["msg-1"],
    });
    await Promise.resolve();

    expect(result.rejections).toHaveLength(0);
    expect(result.validCalls()).toBe(1);
  });

  it("来源消息不存在时跳过写入但不 reject（删除竞态的正常结果）", async () => {
    const result = runGuard({ sourceMessageIds: ["msg-missing"] });
    await Promise.resolve();

    expect(result.validCalls()).toBe(0);
    expect(result.rejections).toHaveLength(0);
  });

  it("来源消息属于其他会话时跳过写入但不 reject", async () => {
    const result = runGuard({
      messages: { "msg-1": { sessionId: otherSessionId } },
      sourceMessageIds: ["msg-1"],
    });
    await Promise.resolve();

    expect(result.validCalls()).toBe(0);
    expect(result.rejections).toHaveLength(0);
  });

  it("多来源中存在跨会话项时不写入，也不 reject", async () => {
    const result = runGuard({
      messages: { "msg-1": { sessionId }, "msg-2": { sessionId: otherSessionId } },
      sourceMessageIds: ["msg-1", "msg-2"],
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(result.validCalls()).toBe(0);
    expect(result.rejections).toHaveLength(0);
  });

  it("要求校验却未绑定来源时立即 reject，且不发起消息读取", () => {
    const result = runGuard({
      messages: { "msg-1": { sessionId } },
      sourceMessageIds: [],
    });

    expect(result.requests).toHaveLength(0);
    expect(result.validCalls()).toBe(0);
    expect(result.rejections).toHaveLength(1);
    expect(String(result.rejections[0])).toMatch(/sourceMessageIds is empty/);
  });

  it("来源消息读取报错时走 reject 通路且不写入", async () => {
    const result = runGuard({
      messages: { "msg-1": { sessionId } },
      failReadIds: ["msg-1"],
      sourceMessageIds: ["msg-1"],
    });
    await Promise.resolve();

    expect(result.validCalls()).toBe(0);
    expect(result.rejections).toHaveLength(1);
  });
});

// ===== 集成层：走真实 IndexedDB（fake-indexeddb）验证落库结果 =====

function makeFragment(id: string, sourceMessageIds: string[], targetSession = sessionId): MemoryFragment {
  const now = Date.now();
  return {
    id,
    sessionId: targetSession,
    content: `分片 ${id}`,
    participants: [],
    tags: [],
    sourceMessageIds,
    sourceRole: "assistant",
    sourceTurnStart: 0,
    sourceTurnEnd: 0,
    status: "active",
    importance: 0.5,
    confidence: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function makeFact(id: string, sourceMessageId: string, targetSession = sessionId): TemporalFact {
  const now = Date.now();
  return {
    id,
    sessionId: targetSession,
    subject: "甲",
    predicate: "来自",
    object: "乙",
    tags: [],
    status: "active",
    validFromTurn: 0,
    sourceMessageId,
    confidence: 1,
    createdAt: now,
    updatedAt: now,
  };
}

async function seedSessionMessage(): Promise<void> {
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(["sessions", "messages"], "readwrite");
    transaction.objectStore("sessions").put({
      id: sessionId,
      characterId: "character-1",
      title: "来源校验会话",
      createdAt: 1,
      summaries: [],
    });
    transaction.objectStore("messages").put({
      id: "live-message",
      sessionId,
      role: "assistant",
      content: "存在且属于本会话的消息",
      createdAt: 2,
      turnIndex: 0,
      tags: [],
      extractSource: "none",
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

describe("记忆写入来源校验落库行为", () => {
  beforeEach(async () => {
    __resetDBInstanceForTesting();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("MobileTavernLiteDB");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
    await seedSessionMessage();
  });

  afterEach(() => {
    __resetDBInstanceForTesting();
  });

  it("来源消息有效时正常写入分片", async () => {
    await upsertFragment(makeFragment("frag-live", ["live-message"]), undefined, {
      requireSourceMessages: true,
    });

    expect(await getFragmentById("frag-live")).not.toBeNull();
  });

  it("来源消息已不存在时跳过写入但正常 resolve（不产生幽灵分片）", async () => {
    await expect(
      upsertFragment(makeFragment("frag-ghost", ["deleted-message"]), undefined, {
        requireSourceMessages: true,
      }),
    ).resolves.toBeUndefined();

    expect(await getFragmentById("frag-ghost")).toBeNull();
  });

  it("来源消息属于其他会话时跳过写入（跨会话引用不落库）", async () => {
    await expect(
      upsertFragment(makeFragment("frag-cross", ["live-message"], otherSessionId), undefined, {
        requireSourceMessages: true,
      }),
    ).resolves.toBeUndefined();

    expect(await getFragmentById("frag-cross")).toBeNull();
  });

  it("要求校验却未绑定来源时 reject，而不是静默成功", async () => {
    await expect(
      upsertFragment(makeFragment("frag-unbound", []), undefined, { requireSourceMessages: true }),
    ).rejects.toThrow(/sourceMessageIds is empty/);

    expect(await getFragmentById("frag-unbound")).toBeNull();
  });

  it("不要求校验时仍允许写入未绑定来源的手动分片", async () => {
    await upsertFragment(makeFragment("frag-manual", []));

    expect(await getFragmentById("frag-manual")).not.toBeNull();
  });

  it("来源有效的时态事实正常写入", async () => {
    const result = await evolveTemporalFact(makeFact("fact-live", "live-message"), undefined, {
      requireSourceMessage: true,
    });

    expect(result.changed).toBe(true);
    expect((await getTemporalFactsBySession(sessionId)).map((fact) => fact.id)).toEqual(["fact-live"]);
  });

  it("来源已删除的时态事实跳过写入且 changed 保持 false", async () => {
    const result = await evolveTemporalFact(makeFact("fact-ghost", "deleted-message"), undefined, {
      requireSourceMessage: true,
    });

    expect(result.changed).toBe(false);
    expect(await getTemporalFactsBySession(sessionId)).toEqual([]);
  });

  it("时态事实未绑定来源时 reject", async () => {
    await expect(
      evolveTemporalFact(makeFact("fact-unbound", ""), undefined, { requireSourceMessage: true }),
    ).rejects.toThrow(/sourceMessageIds is empty/);

    expect(await getTemporalFactsBySession(sessionId)).toEqual([]);
  });
});
