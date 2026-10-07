// @vitest-environment node
/**
 * 分支回溯的状态语义（用户钦定，2026-10-07）：
 *   - 完全回退到分叉节点：变量 / 状态表 / 摘要 / 回忆控制都回到该节点；
 *   - 不回退外部长期记忆：源会话当前的词典 / 片段 / 事实原样带入新分支；
 *   - 快照缺失时按消息回放 MVU，而不是伪造默认状态表。
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DB_NAME } from "@/src/infrastructure/storage/dbSchema";
import { __resetConnectionForTesting, getDB } from "@/src/infrastructure/storage/idbConnection";
import { __resetWriteQueueForTesting } from "@/src/infrastructure/storage/idbQueue";
import { replaceCompleteSessions } from "@/src/infrastructure/storage/repositories/sessionsWriteRepository";
import { restoreSessionMemorySnapshot } from "@/src/infrastructure/storage/repositories/sessionMemorySnapshotRepository";
import {
  getDictBySession,
  getFragmentsBySession,
  getTemporalFactsBySession,
} from "@/src/infrastructure/storage/indexedDbMemoryStore";
import { DatabaseService } from "@/src/application/services/DatabaseService";
import { SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID } from "@/src/application/compatibility/contracts";
import { attachSessionStateSnapshot } from "@/src/domain/chat/sessionStateSnapshot";
import { IndexedDbMemoryPersistenceService } from "@/src/infrastructure/storage/IndexedDbMemoryPersistenceService";
import type { IKernel } from "@/src/kernel/types";
import type { CharacterCard, ChatSession, Message } from "@/src/types";
import type { MemoryServiceTyped } from "@/src/application/services/memory";
import type { MemoryPersistencePort } from "@/src/application/services/memory/types";

const CHARACTER: CharacterCard = {
  id: "char-1",
  name: "测试角色",
  description: "",
  personality: "",
  scenario: "",
  first_mes: "",
  mes_example: "",
  extensions: { mvu_settings: { enabled: true } },
} as unknown as CharacterCard;

function message(id: string, sender: Message["sender"], content: string, turnIndex: number): Message {
  return { id, sender, content, timestamp: 1000 + turnIndex, turnIndex };
}

interface Harness {
  readonly db: DatabaseService;
  readonly replayMvuState: ReturnType<typeof vi.fn>;
  readonly storage: MemoryPersistencePort & {
    getDictBySession: (sessionId: string) => Promise<unknown[]>;
    getFragmentsBySession: (sessionId: string) => Promise<unknown[]>;
    getTemporalFactsBySession: (sessionId: string) => Promise<unknown[]>;
  };
}

function createHarness(options?: { storageOverrides?: Record<string, unknown> }): Harness {
  const replayMvuState = vi.fn(async () => ({ hp: 42 }));
  // 真实记忆分轨（fake-indexeddb），保证"读源会话 → 写新分支"整条链路被测到。
  const persistence = new IndexedDbMemoryPersistenceService();
  const storage = {
    getDictBySession: (sessionId: string) => persistence.getDictBySession(sessionId),
    getFragmentsBySession: (sessionId: string) => persistence.getFragmentsBySession(sessionId),
    getTemporalFactsBySession: (sessionId: string) => persistence.getTemporalFactsBySession(sessionId),
    ...options?.storageOverrides,
  };
  const kernel = {
    hasService: (name: string) =>
      name === "script"
      || name === "compatibilityRuntime"
      || name === "memory"
      || name === "attachments",
    getService: (name: string) => {
      if (name === "script") return { replayMvuState };
      if (name === "compatibilityRuntime") {
        return { isEnabled: () => true, transformText: (request: { text: string }) => request.text };
      }
      if (name === "memory") return { getStorage: () => storage } as unknown as MemoryServiceTyped;
      if (name === "attachments") {
        return {
          getMetadata: async () => ({ id: "unused" }),
          reconcileReferences: async () => undefined,
          collectGarbage: async () => undefined,
        };
      }
      throw new Error(`unexpected service ${name}`);
    },
  } as unknown as IKernel;

  const db = new DatabaseService();
  (db as unknown as { kernel: IKernel }).kernel = kernel;
  const characterSpy = vi.spyOn(db, "getCharacterById").mockResolvedValue(CHARACTER);
  void characterSpy;
  return { db, replayMvuState, storage: storage as unknown as Harness["storage"] };
}

async function seedSourceSession(messages: Message[], overrides: Partial<ChatSession> = {}): Promise<ChatSession> {
  const session: ChatSession = {
    id: "session-src",
    characterId: CHARACTER.id,
    title: "源会话",
    createdAt: 1,
    messages,
    summaries: [],
    runtimePluginState: { "sillytavern.compat": { hp: 999 } },
    tableMemory: [{ id: "current", name: "当前表", enable: true, columns: ["a"], rows: [["现"]] }],
    pinnedMessageIds: ["m1", "m3"],
    mutedMessageIds: ["m2"],
    activePromptSceneProfileId: "scene-1",
    ...overrides,
  };
  await replaceCompleteSessions([session]);
  return session;
}

beforeEach(async () => {
  __resetWriteQueueForTesting();
  __resetConnectionForTesting();
  await new Promise<void>((resolve) => {
    const deletion = indexedDB.deleteDatabase(DB_NAME);
    deletion.onsuccess = () => resolve();
    deletion.onerror = () => resolve();
    deletion.onblocked = () => resolve();
  });
});

describe("createBacktrackBranch 状态回退", () => {
  it("中段分叉使用节点快照的变量与状态表，而不是当前会话状态", async () => {
    const snapshotVars = { "sillytavern.compat": { hp: 55 } };
    const snapshotTable = [{ id: "node", name: "节点表", enable: true, columns: ["a"], rows: [["节点"]] }];
    const m0 = message("m0", "assistant", "开场", 0);
    const m1 = attachSessionStateSnapshot(
      { ...message("m1", "assistant", "第一轮", 1) },
      { runtimePluginState: snapshotVars, tableMemory: snapshotTable },
    );
    const m2 = message("m2", "user", "之后", 2);
    const source = await seedSourceSession([m0, m1, m2]);
    const { db } = createHarness();

    const branch = await db.createBacktrackBranch(source, "回溯分支", "m1");

    expect(branch.runtimePluginState).toEqual(snapshotVars);
    expect(branch.tableMemory).toEqual(snapshotTable);
    expect(branch.messages.map((item) => item.id)).toEqual([
      `${branch.id}_msg_0`,
      `${branch.id}_msg_1`,
    ]);
    expect(branch.messages.map((item) => item.turnIndex)).toEqual([0, 1]);
  });

  it("快照缺失时回放 MVU 到分叉节点，且不伪造默认状态表", async () => {
    const m0 = message("m0", "assistant", "开场", 0);
    const m1 = message("m1", "assistant", "第一轮 <UpdateVariable/>", 1);
    const m2 = message("m2", "user", "之后", 2);
    const source = await seedSourceSession([m0, m1, m2]);
    const { db, replayMvuState } = createHarness();

    const branch = await db.createBacktrackBranch(source, "回溯分支", "m1");

    expect(replayMvuState).toHaveBeenCalledTimes(1);
    const [characterArg, messagesArg] = replayMvuState.mock.calls[0] as [CharacterCard, Message[]];
    expect(characterArg.id).toBe(CHARACTER.id);
    expect(messagesArg.map((item) => item.id)).toEqual(["m0", "m1"]);
    expect(branch.runtimePluginState).toEqual({
      [SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID]: { hp: 42 },
    });
    // 中段分叉且无节点快照时不得凭空造表
    expect(branch.tableMemory).toBeUndefined();
  });

  it("回退回忆控制与 Prompt 场景，并携带长期记忆到新分支", async () => {
    const m0 = message("m0", "assistant", "开场", 0);
    const m1 = message("m1", "assistant", "第一轮", 1);
    const m2 = message("m2", "user", "之后", 2);
    const source = await seedSourceSession([m0, m1, m2]);
    await restoreSessionMemorySnapshot({
      dictEntries: [{
        id: "session-src:老张",
        sessionId: "session-src",
        entity: "老张",
        aliases: [],
        type: "character",
        firstSeenMsgId: "m1",
        firstSeenTurn: 1,
        count: 2,
        createdAt: 10,
        updatedAt: 20,
      }],
      fragments: [{
        id: "frag-1",
        sessionId: "session-src",
        content: "老张给出了钥匙",
        participants: ["老张"],
        tags: [],
        sourceMessageIds: ["m1"],
        sourceRole: "assistant",
        sourceTurnStart: 1,
        sourceTurnEnd: 1,
        status: "active",
        importance: 0.5,
        confidence: 1,
        createdAt: 10,
        updatedAt: 20,
      }],
      facts: [{
        id: "fact-1",
        sessionId: "session-src",
        subject: "老张",
        predicate: "持有",
        object: "钥匙",
        tags: [],
        status: "active",
        validFromTurn: 1,
        sourceMessageId: "m1",
        confidence: 0.9,
        createdAt: 10,
        updatedAt: 20,
      }],
    });
    const { db } = createHarness();

    const branch = await db.createBacktrackBranch(source, "回溯分支", "m1");

    // m1/m2 在分叉点之后（只复制 m0/m1）→ 只有 m1 被重映射
    expect(branch.pinnedMessageIds).toEqual([`${branch.id}_msg_1`, "m3"]);
    expect(branch.mutedMessageIds).toEqual(["m2"]);
    expect(branch.activePromptSceneProfileId).toBe("scene-1");

    const [dict, fragments, facts] = await Promise.all([
      getDictBySession(branch.id),
      getFragmentsBySession(branch.id),
      getTemporalFactsBySession(branch.id),
    ]);
    expect(dict).toHaveLength(1);
    expect(dict[0]).toMatchObject({
      id: `${branch.id}:老张`,
      sessionId: branch.id,
      firstSeenMsgId: `${branch.id}_msg_1`,
    });
    expect(fragments).toHaveLength(1);
    expect(fragments[0]).toMatchObject({
      sessionId: branch.id,
      sourceMessageIds: [`${branch.id}_msg_1`],
      content: "老张给出了钥匙",
    });
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      sessionId: branch.id,
      sourceMessageId: `${branch.id}_msg_1`,
    });
    // 源会话记忆保持原样，不被改写
    expect((await getFragmentsBySession("session-src"))[0].id).toBe("frag-1");
  });

  it("长期记忆携带失败时回滚整个分支，不留下半成品会话", async () => {
    const m0 = message("m0", "assistant", "开场", 0);
    const m1 = message("m1", "assistant", "第一轮", 1);
    const source = await seedSourceSession([m0, m1]);
    const { db } = createHarness({
      storageOverrides: {
        getFragmentsBySession: vi.fn(async () => {
          throw new Error("IDB_READ_FAILED");
        }),
      },
    });

    await expect(db.createBacktrackBranch(source, "回溯分支", "m1")).rejects.toThrow("IDB_READ_FAILED");
    const sessions = await db.getAllSessions();
    expect(sessions.some((session) => session.title === "回溯分支")).toBe(false);
    // 源会话不受影响
    expect(sessions.some((session) => session.id === "session-src")).toBe(true);
  });
});
