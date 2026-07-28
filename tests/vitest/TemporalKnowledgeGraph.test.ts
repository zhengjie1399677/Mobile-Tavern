import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  evolveTemporalFact,
  getTemporalFactsByEntities,
  getTemporalFactsBySession,
  updateTemporalFactStatus,
} from "../../src/infrastructure/storage/indexedDbMemoryStore";
import { validateExtraction } from "../../src/kernel/services/memory/MemoryExtractor";
import type { TemporalFact } from "../../src/kernel/services/memory/types";

function fact(overrides: Partial<TemporalFact> = {}): TemporalFact {
  return {
    id: "m1:fact:0",
    sessionId: "graph-session",
    subject: "爱丽丝",
    predicate: "当前所在地",
    object: "王都",
    tags: ["爱丽丝", "王都"],
    status: "active",
    validFromTurn: 3,
    sourceMessageId: "m1",
    confidence: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("实体关系图谱与时态事实", () => {
  beforeEach(async () => {
    const existing = await getTemporalFactsBySession("graph-session");
    await Promise.all(existing.map((item) => updateTemporalFactStatus(item.id, "invalid")));
  });

  it("原子关闭旧事实并建立可追溯的新事实", async () => {
    await evolveTemporalFact(fact());
    const evolved = await evolveTemporalFact(fact({
      id: "m2:fact:0",
      object: "港城",
      tags: ["爱丽丝", "港城"],
      validFromTurn: 8,
      sourceMessageId: "m2",
      updatedAt: 2,
    }));
    expect(evolved.changed).toBe(true);
    expect(evolved.fact.supersedesId).toBe("m1:fact:0");

    const all = await getTemporalFactsBySession("graph-session");
    const oldFact = all.find((item) => item.id === "m1:fact:0");
    const current = all.find((item) => item.id === "m2:fact:0");
    expect(oldFact).toMatchObject({
      status: "superseded",
      validToTurn: 7,
      supersededById: "m2:fact:0",
    });
    expect(current).toMatchObject({ status: "active", object: "港城" });
  });

  it("相同事实只强化置信度，不创建重复当前边", async () => {
    await evolveTemporalFact(fact({ confidence: 0.6 }));
    const repeated = await evolveTemporalFact(fact({
      id: "m3:fact:0",
      confidence: 0.9,
      sourceMessageId: "m3",
      validFromTurn: 9,
    }));
    expect(repeated.changed).toBe(false);
    const active = await getTemporalFactsBySession("graph-session", { activeOnly: true });
    expect(active).toHaveLength(1);
    expect(active[0].confidence).toBe(0.9);
  });

  it("按实体召回当前关系，不返回失效历史", async () => {
    await evolveTemporalFact(fact());
    await evolveTemporalFact(fact({
      id: "m2:fact:0", object: "港城", tags: ["爱丽丝", "港城"],
      sourceMessageId: "m2", validFromTurn: 8,
    }));
    const result = await getTemporalFactsByEntities("graph-session", ["爱丽丝"]);
    expect(result.map((item) => item.object)).toEqual(["港城"]);
  });

  it("兼容旧抽取格式并校验可选 relations", () => {
    expect(validateExtraction('{"entities":[],"events":[]}')).toEqual({
      entities: [], events: [], relations: [],
    });
    expect(validateExtraction(JSON.stringify({
      entities: [],
      events: [],
      relations: [{ subject: "爱丽丝", predicate: "持有", object: "银钥匙", confidence: 0.95 }],
    }))?.relations).toHaveLength(1);
    expect(validateExtraction(JSON.stringify({
      entities: [], events: [],
      relations: [{ subject: "爱丽丝", predicate: "持有", object: "银钥匙", confidence: 2 }],
    }))).toBeNull();
  });
});
