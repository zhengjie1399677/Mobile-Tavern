import { describe, expect, it, vi } from "vitest";
import { MemoryExtractor } from "../../src/kernel/services/memory/MemoryExtractor";
import { MemoryRecall } from "../../src/kernel/services/memory/MemoryRecall";
import { buildMemoryAuditSnapshot } from "../../src/kernel/services/memory/MemoryAudit";

function createStorage(overrides: Record<string, unknown> = {}) {
  return {
    updateMessageExtraction: vi.fn().mockResolvedValue(undefined),
    getDictBySession: vi.fn().mockResolvedValue([]),
    upsertDictEntry: vi.fn().mockResolvedValue(true),
    upsertFragment: vi.fn().mockResolvedValue(undefined),
    getFragmentsBySession: vi.fn().mockResolvedValue([]),
    getFragmentsByTags: vi.fn().mockResolvedValue([]),
    getFragmentById: vi.fn().mockResolvedValue(null),
    getMessagesBySession: vi.fn().mockResolvedValue([]),
    getMessagesByTag: vi.fn().mockResolvedValue([]),
    getMessageById: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("事件型记忆片段", () => {
  it("即使没有新实体，也会把合法事件保存为独立片段", async () => {
    const storage = createStorage();
    const extractor = new MemoryExtractor(storage as never);
    extractor.init();

    await extractor.extract({
      msgId: "msg-1",
      sessionId: "session-1",
      role: "assistant",
      message: "沈孤鸿答应三日后在渡口交剑。",
      turnIndex: 12,
      memoryContent: JSON.stringify({
        entities: [],
        events: [{ summary: "沈孤鸿答应三日后在渡口交剑", participants: ["沈孤鸿", "渡口"] }],
      }),
    });

    expect(storage.upsertFragment).toHaveBeenCalledWith(expect.objectContaining({
      id: "msg-1:event:0",
      sessionId: "session-1",
      content: "沈孤鸿答应三日后在渡口交剑",
      participants: ["沈孤鸿", "渡口"],
      sourceMessageIds: ["msg-1"],
      sourceTurnStart: 12,
      sourceTurnEnd: 12,
      status: "active",
    }));
  });

  it("重复抽取不会重新激活用户已纠错或失效的旧片段", async () => {
    const storage = createStorage({
      getFragmentById: vi.fn().mockResolvedValue({ id: "msg-1:event:0", status: "invalid" }),
    });
    const extractor = new MemoryExtractor(storage as never);
    extractor.init();

    await extractor.extract({
      msgId: "msg-1",
      sessionId: "session-1",
      role: "assistant",
      message: "旧事件",
      turnIndex: 2,
      memoryContent: JSON.stringify({ entities: [], events: ["旧事件"] }),
    });

    expect(storage.upsertFragment).not.toHaveBeenCalled();
  });

  it("无实体命中且没有 Pin 时默认不再随机召回旧消息", async () => {
    const storage = createStorage({
      getMessagesBySession: vi.fn().mockResolvedValue([
        { id: "old", sessionId: "session-1", role: "assistant", content: "无关旧消息", turnIndex: 1 },
      ]),
    });
    const recall = new MemoryRecall(storage as never);

    await expect(recall.recall("session-1", "今天天气如何？", { currentTurnIndex: 20 }))
      .resolves.toEqual([]);
  });

  it("优先召回简洁的活跃事件片段并保留可审计来源", async () => {
    const storage = createStorage({
      getDictBySession: vi.fn().mockResolvedValue([
        { entity: "沈孤鸿", aliases: [], type: "character" },
      ]),
      getFragmentsByTags: vi.fn().mockResolvedValue([
        {
          id: "fragment-1",
          sessionId: "session-1",
          content: "沈孤鸿答应三日后在渡口交剑",
          participants: ["沈孤鸿"],
          tags: ["沈孤鸿", "渡口"],
          sourceMessageIds: ["msg-1"],
          sourceTurnStart: 4,
          sourceTurnEnd: 4,
          status: "active",
          importance: 0.8,
          confidence: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    });
    const recall = new MemoryRecall(storage as never);

    const result = await recall.recall("session-1", "沈孤鸿答应过什么？", {
      currentTurnIndex: 20,
      excludeRecentN: 0,
    });

    expect(result[0]).toMatchObject({
      memoryId: "fragment-1",
      messageId: "msg-1",
      kind: "event",
      reason: "tag",
      content: "沈孤鸿答应三日后在渡口交剑",
      sourceMessageIds: ["msg-1"],
      hitTags: ["沈孤鸿"],
    });
  });

  it("按最终编排轨迹区分已注入与被预算裁剪的记忆源", () => {
    const snapshot = buildMemoryAuditSnapshot({
      session: {
        id: "session-1",
        summaries: [{ id: "summary-1", timeTag: "夜", location: "渡口", content: "二人约战" }],
        tableMemory: [{ id: "table-1", name: "关系", columns: ["人物"], rows: [["沈孤鸿"]], enable: true }],
      } as never,
      query: "此前发生了什么？",
      recalled: [],
      settings: { promptConfig: { usePromptComposition: true } } as never,
      traces: [
        {
          blockId: "summary",
          blockName: "摘要",
          sourceType: "template",
          dataKeys: ["memory.summaries"],
          resolvedDataKeys: ["memory.summaries"],
          missingDataKeys: [],
          messageIndexes: [0],
          renderedCharacters: 10,
          estimatedTokens: 5,
          dropped: false,
        },
        {
          blockId: "table",
          blockName: "状态",
          sourceType: "template",
          dataKeys: ["memory.tables"],
          resolvedDataKeys: ["memory.tables"],
          missingDataKeys: [],
          messageIndexes: [],
          renderedCharacters: 0,
          estimatedTokens: 0,
          dropped: true,
        },
      ],
      estimateTokens: (text) => text.length,
    });

    expect(snapshot.sources.find((source) => source.key === "memory.summaries"))
      .toMatchObject({ included: true, dropped: false });
    expect(snapshot.sources.find((source) => source.key === "memory.tables"))
      .toMatchObject({ included: false, dropped: true, estimatedTokens: 0 });
  });
});
