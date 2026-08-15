/**
 * 故事年表边界一致性纯函数回归测试。
 *
 * 覆盖 reconcileSummaryBoundary：重发/删除截断后同步维护年表卡片与
 * 最后总结位置，避免边界悬空导致总结服务把已归档内容从头重复总结。
 */

import { describe, expect, it } from "vitest";
import { reconcileSummaryBoundary } from "../../src/hooks/useChat/helpers/archival";
import type { SummaryCard } from "../../src/types";

function summary(id: string, lastMessageId: string): SummaryCard {
  return { id, timeTag: `第${id}幕`, location: "营地", content: `摘要-${id}`, lastMessageId };
}

describe("reconcileSummaryBoundary", () => {
  it("重发截断在边界之后时保持边界与卡片不变", () => {
    const summaries = [summary("s1", "m1")];
    const result = reconcileSummaryBoundary(["m2"], summaries, "m1");
    expect(result.summaries).toHaveLength(1);
    expect(result.lastSummarizedMessageId).toBe("m1");
  });

  it("重发移除边界消息时回退到最后一张保留卡片的边界", () => {
    const summaries = [summary("s1", "m0"), summary("s2", "m2")];
    const result = reconcileSummaryBoundary(["m2"], summaries, "m2");
    expect(result.summaries.map((s) => s.id)).toEqual(["s1"]);
    expect(result.lastSummarizedMessageId).toBe("m0");
  });

  it("所有卡片都失效时清空边界", () => {
    const summaries = [summary("s1", "m5")];
    const result = reconcileSummaryBoundary(["m5"], summaries, "m5");
    expect(result.summaries).toEqual([]);
    expect(result.lastSummarizedMessageId).toBeUndefined();
  });

  it("无原始边界时不主动创建边界", () => {
    const summaries = [summary("s1", "m0")];
    const result = reconcileSummaryBoundary([], summaries, undefined);
    expect(result.summaries).toHaveLength(1);
    expect(result.lastSummarizedMessageId).toBeUndefined();
  });

  it("保留 lastMessageId 缺失的旧数据卡片但不作为边界依据", () => {
    const legacy: SummaryCard = {
      id: "legacy",
      timeTag: "旧卡",
      location: "营地",
      content: "旧数据",
    };
    const result = reconcileSummaryBoundary([], [legacy], undefined);
    expect(result.summaries).toEqual([legacy]);
    expect(result.lastSummarizedMessageId).toBeUndefined();
  });

  it("懒加载下未加载到内存的早期摘要卡片不应被误删", () => {
    // 边界 m1/m5 在内存中不可见（只加载了最近一页），但不应因此被当作失效删除。
    const summaries = [summary("s1", "m1"), summary("s2", "m5")];
    const result = reconcileSummaryBoundary(["m9"], summaries, "m5");
    expect(result.summaries.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(result.lastSummarizedMessageId).toBe("m5");
  });
});
