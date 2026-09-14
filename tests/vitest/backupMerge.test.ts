/**
 * 覆盖式同步之外的合并语义测试。
 *
 * 最关键的一条性质是**收敛**：裁决规则不能依赖"谁是本地"，否则两台设备各自合并后
 * 会得到不同结果，每次同步都产生新的差异。因此这里显式断言交换参数后结果相同。
 */
import { describe, expect, it } from "vitest";
import { mergeBackupPayloads } from "../../src/application/useCases/backupMerge";
import {
  buildUnifiedBackupPayload,
  type UnifiedBackupPayload,
  type UnifiedBackupPayloadInput,
} from "../../src/application/useCases/dataMigrationUseCases";
import type { SyncTombstone } from "../../src/domain/sync/tombstones";
import type { ChatSession, Message, UserSettings } from "../../src/types";

const SETTINGS = { api: { apiKey: "local-key" } } as unknown as UserSettings;
const REMOTE_SETTINGS = { api: { apiKey: "remote-key" } } as unknown as UserSettings;

function makePayload(
  overrides: Partial<UnifiedBackupPayloadInput> = {},
): UnifiedBackupPayload {
  return buildUnifiedBackupPayload({
    characters: [],
    sessions: [],
    memoryDictEntries: [],
    memoryFragments: [],
    memoryFacts: [],
    settings: SETTINGS,
    savedPresets: [],
    globalLorebook: [],
    customWorldbooks: {},
    backupDate: "2026-09-14T00:00:00.000Z",
    isEncrypted: false,
    ...overrides,
  });
}

function makeMessage(id: string, timestamp: number, content = `内容 ${id}`): Message {
  return { id, sender: "user", content, timestamp };
}

function makeSession(
  id: string,
  updatedAt: number,
  messages: Message[],
  title = `会话 ${id}`,
): ChatSession {
  return {
    id,
    characterId: "character-1",
    title,
    createdAt: 1,
    messages,
    summaries: [],
    lifecycle: "active",
    updatedAt,
    contentRevision: 1,
  };
}

function makeTombstone(
  entity: SyncTombstone["entity"],
  targetId: string,
  deletedAt: number,
  sessionId = targetId,
): SyncTombstone {
  return { entity, targetId, sessionId, deletedAt };
}

/** 剥离设置后比较：设置按设计只取接收端，不参与收敛。 */
function comparable(payload: UnifiedBackupPayload) {
  const { settings: _settings, ...rest } = payload;
  return rest;
}

describe("合并：并集与收敛", () => {
  it("两侧独有的会话都会保留", () => {
    const local = makePayload({ sessions: [makeSession("a", 10, [makeMessage("m1", 1)])] });
    const remote = makePayload({ sessions: [makeSession("b", 20, [makeMessage("m2", 2)])] });

    const { merged, stats } = mergeBackupPayloads({ local, remote });
    expect(merged.sessions.map((session) => session.id).sort()).toEqual(["a", "b"]);
    expect(stats.sessions.added).toBe(1);
    expect(stats.sessions.unchanged).toBe(1);
    expect(stats.sessions.removed).toBe(0);
  });

  it("交换本地与远端得到完全相同的合并结果", () => {
    const local = makePayload({
      sessions: [makeSession("a", 10, [makeMessage("m1", 1), makeMessage("m3", 3)])],
      settings: SETTINGS,
    });
    const remote = makePayload({
      sessions: [makeSession("a", 40, [makeMessage("m2", 2)]), makeSession("b", 20, [makeMessage("m4", 4)])],
      settings: REMOTE_SETTINGS,
    });

    const forward = mergeBackupPayloads({ local, remote });
    const backward = mergeBackupPayloads({ local: remote, remote: local });

    expect(comparable(forward.merged)).toEqual(comparable(backward.merged));
  });

  it("同一会话内两侧独有的消息都保留并按时间重排轮次", () => {
    const local = makePayload({
      sessions: [makeSession("a", 10, [makeMessage("m1", 1), makeMessage("m3", 3)])],
    });
    const remote = makePayload({
      sessions: [makeSession("a", 10, [makeMessage("m1", 1), makeMessage("m2", 2)])],
    });

    const { merged } = mergeBackupPayloads({ local, remote });
    const messages = merged.sessions[0].messages;
    expect(messages.map((message) => message.id)).toEqual(["m1", "m2", "m3"]);
    expect(messages.map((message) => message.turnIndex)).toEqual([0, 1, 2]);
  });

  it("同一条消息时间戳相同时双向裁决到同一侧", () => {
    const local = makePayload({
      sessions: [makeSession("a", 10, [makeMessage("m1", 1, "本地版本")])],
    });
    const remote = makePayload({
      sessions: [makeSession("a", 10, [makeMessage("m1", 1, "远端版本")])],
    });

    const { merged } = mergeBackupPayloads({ local, remote });
    const swapped = mergeBackupPayloads({ local: remote, remote: local });
    // 时间戳相同，回退到稳定序列化裁决；关键是双向必须一致，而不是取哪一侧。
    expect(merged.sessions[0].messages[0].content)
      .toBe(swapped.merged.sessions[0].messages[0].content);
    expect(["本地版本", "远端版本"]).toContain(merged.sessions[0].messages[0].content);
  });

  it("同一条消息时间戳较晚的一侧生效", () => {
    const local = makePayload({
      sessions: [makeSession("a", 10, [makeMessage("m1", 1, "旧")])],
    });
    const remote = makePayload({
      sessions: [makeSession("a", 10, [makeMessage("m1", 9, "新")])],
    });

    expect(mergeBackupPayloads({ local, remote }).merged.sessions[0].messages[0].content).toBe("新");
    expect(mergeBackupPayloads({ local: remote, remote: local }).merged.sessions[0].messages[0].content).toBe("新");
  });
});

describe("合并：删除传播", () => {
  it("会话墓碑命中时结果中不再包含该会话", () => {
    const local = makePayload({ sessions: [makeSession("a", 100, [makeMessage("m1", 1)])] });
    const remote = makePayload({ tombstones: [makeTombstone("session", "a", 200)] });

    const { merged, stats } = mergeBackupPayloads({ local, remote });
    expect(merged.sessions).toEqual([]);
    expect(stats.sessions.removed).toBe(1);
    // 会话已整体删除，其墓碑仍需保留以继续向其他设备传播该删除。
    expect(merged.tombstones.map((tombstone) => tombstone.targetId)).toEqual(["a"]);
  });

  it("删除之后重新写入的会话保留，且对应墓碑被剔除", () => {
    const local = makePayload({ sessions: [makeSession("a", 300, [makeMessage("m1", 1)])] });
    const remote = makePayload({ tombstones: [makeTombstone("session", "a", 200)] });

    const { merged } = mergeBackupPayloads({ local, remote });
    expect(merged.sessions.map((session) => session.id)).toEqual(["a"]);
    expect(merged.tombstones).toEqual([]);
  });

  it("消息墓碑命中时该消息从会话中移除", () => {
    const local = makePayload({
      sessions: [makeSession("a", 100, [makeMessage("m1", 1), makeMessage("m2", 2)])],
    });
    const remote = makePayload({ tombstones: [makeTombstone("message", "m1", 200, "a")] });

    const { merged, stats } = mergeBackupPayloads({ local, remote });
    expect(merged.sessions[0].messages.map((message) => message.id)).toEqual(["m2"]);
    expect(stats.messages.removed).toBe(1);
    expect(merged.tombstones.map((tombstone) => tombstone.targetId)).toEqual(["m1"]);
  });

  it("会话被整体删除后其消息墓碑不再保留", () => {
    const local = makePayload({
      sessions: [makeSession("a", 100, [makeMessage("m1", 1)])],
    });
    const remote = makePayload({
      tombstones: [
        makeTombstone("session", "a", 200),
        makeTombstone("message", "m1", 150, "a"),
      ],
    });

    const { merged } = mergeBackupPayloads({ local, remote });
    expect(merged.sessions).toEqual([]);
    expect(merged.tombstones.map((tombstone) => tombstone.entity)).toEqual(["session"]);
  });

  it("会话被整体删除时其记忆分轨一并移除，不留下指向不存在会话的孤儿", () => {
    const local = makePayload({
      sessions: [makeSession("a", 100, [makeMessage("m1", 1)])],
      memoryFragments: [
        {
          id: "f1",
          sessionId: "a",
          content: "片段",
          participants: [],
          tags: [],
          sourceMessageIds: ["m1"],
          sourceRole: "assistant",
          sourceTurnStart: 0,
          sourceTurnEnd: 0,
          status: "active",
          importance: 0.5,
          confidence: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    const remote = makePayload({ tombstones: [makeTombstone("session", "a", 200)] });

    const { merged } = mergeBackupPayloads({ local, remote });
    expect(merged.sessions).toEqual([]);
    // 孤儿记忆会让宿主的导入校验直接拒绝整次同步，因此必须随会话一并消失。
    expect(merged.memoryFragments).toEqual([]);
  });
});

describe("合并：元数据裁决与设置", () => {
  it("元数据不一致时按 updatedAt 后写者生效并记入冲突", () => {
    const local = makePayload({ sessions: [makeSession("a", 100, [], "本地标题")] });
    const remote = makePayload({ sessions: [makeSession("a", 500, [], "远端标题")] });

    const forward = mergeBackupPayloads({ local, remote });
    expect(forward.merged.sessions[0].title).toBe("远端标题");
    expect(forward.conflicts).toHaveLength(1);
    expect(forward.conflicts[0]).toMatchObject({
      sessionId: "a",
      resolution: "remote",
      remoteUpdatedAt: 500,
    });

    const backward = mergeBackupPayloads({ local: remote, remote: local });
    expect(backward.merged.sessions[0].title).toBe("远端标题");
    expect(backward.conflicts[0].resolution).toBe("local");
  });

  it("两侧元数据一致时不记入冲突", () => {
    const local = makePayload({ sessions: [makeSession("a", 100, [makeMessage("m1", 1)])] });
    const remote = makePayload({ sessions: [makeSession("a", 100, [makeMessage("m1", 1)])] });

    const { conflicts, merged } = mergeBackupPayloads({ local, remote });
    expect(conflicts).toEqual([]);
    // 目录字段取两侧较大值，不会因为合并而回退。
    expect(merged.sessions[0].updatedAt).toBe(100);
    expect(merged.sessions[0].contentRevision).toBe(1);
  });

  it("合并结果保留接收端设置，不被对端覆盖", () => {
    const local = makePayload({ settings: SETTINGS });
    const remote = makePayload({ settings: REMOTE_SETTINGS });

    // 信封构造会结构化克隆入参，因此这里比较值而非引用。
    expect(mergeBackupPayloads({ local, remote }).merged.settings.api.apiKey).toBe("local-key");
    expect(mergeBackupPayloads({ local: remote, remote: local }).merged.settings.api.apiKey)
      .toBe("remote-key");
  });
});

describe("合并：其余集合与统计", () => {
  it("角色、世界书、预设按标识求并集", () => {
    const local = makePayload({
      characters: [{ id: "c1", name: "本地角色" } as never],
      customWorldbooks: { w1: { id: "w1", name: "本地世界书", entries: [], enabled: true } },
      savedPresets: [{ id: "p1" } as never],
    });
    const remote = makePayload({
      characters: [{ id: "c2", name: "远端角色" } as never],
      customWorldbooks: { w2: { id: "w2", name: "远端世界书", entries: [], enabled: true } },
      savedPresets: [{ id: "p1" } as never, { id: "p2" } as never],
    });

    const { merged, stats } = mergeBackupPayloads({ local, remote });
    expect(merged.characters.map((character) => character.id).sort()).toEqual(["c1", "c2"]);
    expect(Object.keys(merged.customWorldbooks).sort()).toEqual(["w1", "w2"]);
    expect(merged.savedPresets.map((preset) => preset.id).sort()).toEqual(["p1", "p2"]);
    expect(stats.characters.added).toBe(1);
    expect(stats.savedPresets.added).toBe(1);
  });

  it("同一实体的多条墓碑收敛为删除时间较晚的一条", () => {
    const local = makePayload({ tombstones: [makeTombstone("session", "a", 100)] });
    const remote = makePayload({ tombstones: [makeTombstone("session", "a", 900)] });

    const { merged } = mergeBackupPayloads({ local, remote });
    expect(merged.tombstones).toHaveLength(1);
    expect(merged.tombstones[0].deletedAt).toBe(900);
  });

  it("预览摘要给出双方与合并后的规模", () => {
    const local = makePayload({ sessions: [makeSession("a", 10, [makeMessage("m1", 1)])] });
    const remote = makePayload({ sessions: [makeSession("b", 20, [makeMessage("m2", 2), makeMessage("m3", 3)])] });

    const plan = mergeBackupPayloads({ local, remote });
    expect(plan.localSummary.sessions).toBe(1);
    expect(plan.remoteSummary.sessions).toBe(1);
    expect(plan.remoteSummary.messages).toBe(2);
    expect(plan.mergedSummary.sessions).toBe(2);
    expect(plan.mergedSummary.messages).toBe(3);
  });
});
