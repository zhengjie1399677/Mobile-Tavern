import { describe, expect, it } from "vitest";
import {
  carryOverBranchMemory,
  remapBranchMessageIds,
} from "../../src/domain/chat/branchState";
import type {
  MemoryDictEntry,
  MemoryFragment,
  TemporalFact,
} from "../../src/application/services/memory/types";

const dictEntry: MemoryDictEntry = {
  id: "session-src:老张",
  sessionId: "session-src",
  entity: "老张",
  aliases: ["张老板"],
  type: "character",
  firstSeenMsgId: "m1",
  firstSeenTurn: 1,
  count: 3,
  createdAt: 10,
  updatedAt: 20,
};

const fragment: MemoryFragment = {
  id: "frag-1",
  sessionId: "session-src",
  content: "老张把钥匙交给了主角",
  participants: ["老张"],
  tags: ["道具"],
  sourceMessageIds: ["m1"],
  sourceRole: "assistant",
  sourceTurnStart: 1,
  sourceTurnEnd: 1,
  status: "active",
  supersedesId: undefined,
  importance: 0.6,
  confidence: 0.9,
  createdAt: 10,
  updatedAt: 20,
};

const fact: TemporalFact = {
  id: "fact-1",
  sessionId: "session-src",
  subject: "老张",
  predicate: "持有",
  object: "仓库钥匙",
  tags: ["道具"],
  status: "active",
  validFromTurn: 1,
  sourceMessageId: "m1",
  confidence: 0.8,
  createdAt: 10,
  updatedAt: 20,
};

describe("分支长期记忆携带", () => {
  it("重映射会话、主键与来源消息，保留时间戳与内容", () => {
    let counter = 0;
    const result = carryOverBranchMemory(
      { dictEntries: [dictEntry], fragments: [fragment], facts: [fact] },
      {
        sourceSessionId: "session-src",
        branchSessionId: "session-branch",
        messageIdMap: new Map([["m1", "session-branch_msg_1"]]),
        createId: () => `id${++counter}`,
      },
    );

    expect(result.dictEntries[0]).toMatchObject({
      id: "session-branch:老张",
      sessionId: "session-branch",
      firstSeenMsgId: "session-branch_msg_1",
      count: 3,
      createdAt: 10,
    });
    expect(result.fragments[0]).toMatchObject({
      id: "session-branch_fragment_id1",
      sessionId: "session-branch",
      sourceMessageIds: ["session-branch_msg_1"],
      content: fragment.content,
    });
    expect(result.facts[0]).toMatchObject({
      id: "session-branch_fact_id2",
      sessionId: "session-branch",
      sourceMessageId: "session-branch_msg_1",
    });
    // 原对象不得被就地修改
    expect(dictEntry.id).toBe("session-src:老张");
    expect(fragment.sessionId).toBe("session-src");
  });

  it("supersede 链在分支内保持指向关系", () => {
    let counter = 0;
    const replaced: MemoryFragment = {
      ...fragment,
      id: "frag-2",
      supersedesId: "frag-1",
      status: "active",
    };
    const result = carryOverBranchMemory(
      { dictEntries: [], fragments: [fragment, replaced], facts: [] },
      {
        sourceSessionId: "session-src",
        branchSessionId: "session-branch",
        messageIdMap: new Map(),
        createId: () => `id${++counter}`,
      },
    );

    expect(result.fragments[1].supersedesId).toBe(result.fragments[0].id);
    expect(result.fragments[0].id).not.toBe("frag-1");
  });

  it("分叉点之后的消息引用保持原样（长期记忆不回退）", () => {
    const later: MemoryFragment = {
      ...fragment,
      id: "frag-later",
      sourceMessageIds: ["m9"],
      sourceTurnEnd: 9,
    };
    const result = carryOverBranchMemory(
      { dictEntries: [], fragments: [later], facts: [] },
      {
        sourceSessionId: "session-src",
        branchSessionId: "session-branch",
        messageIdMap: new Map([["m1", "branch-1"]]),
        createId: () => "x",
      },
    );
    expect(result.fragments[0].sourceMessageIds).toEqual(["m9"]);
  });
});

describe("分支消息 ID 重映射", () => {
  it("列表为空或无值时按原语义返回", () => {
    expect(remapBranchMessageIds(undefined, new Map())).toBeUndefined();
    expect(remapBranchMessageIds([], new Map())).toEqual([]);
  });

  it("只映射分叉点之前的消息，其余保持原 ID", () => {
    const map = new Map([["m1", "b1"]]);
    expect(remapBranchMessageIds(["m1", "m2"], map)).toEqual(["b1", "m2"]);
  });
});
