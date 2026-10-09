/**
 * C2 回归：上下文审计泛化。
 *
 * 记忆之外通过通用来源缝进入提示词的贡献，必须出现在同一份审计快照的 `sources` 里，
 * 既有记忆条目与 UI 入口保持不变。
 */
import { describe, expect, it } from "vitest";
import type { ChatSession, UserSettings } from "@/src/types";
import type { ContextContribution } from "@/src/domain/contextSources/contracts";
import { buildMemoryAuditSnapshot } from "@/src/application/services/memory/MemoryAudit";
import type { RecalledMessage } from "@/src/application/services/memory/types";

const session = {
  id: "session",
  summaries: [],
  tableMemory: [],
} as unknown as ChatSession;

const settings = {
  promptConfig: {},
  enableTableMemory: false,
} as unknown as UserSettings;

const recalled = [
  {
    memoryId: "m1",
    messageId: "msg1",
    turnIndex: 1,
    role: "user",
    content: "记忆正文",
    hitCount: 1,
    hitTags: ["t"],
    score: 1,
  },
] as unknown as RecalledMessage[];

function contribution(overrides: Partial<ContextContribution> & { macroName: string }): ContextContribution {
  return { sourceId: overrides.macroName, content: "", status: "ok", characters: 0, ...overrides };
}

function audit(contextContributions: readonly ContextContribution[]) {
  return buildMemoryAuditSnapshot({
    session,
    query: "输入",
    recalled,
    settings,
    contextContributions,
    estimateTokens: (text) => text.length,
  });
}

describe("上下文审计泛化", () => {
  it("未接入来源时行为与泛化前一致（仅三条记忆数据源）", () => {
    const snapshot = audit([]);
    expect(snapshot.sources.map((item) => item.key)).toEqual([
      "memory.summaries",
      "memory.recalled",
      "memory.tables",
    ]);
  });

  it("记忆之外的贡献进入同一审计列表并计入 Token", () => {
    const snapshot = buildMemoryAuditSnapshot({
      session,
      query: "输入",
      recalled,
      settings,
      contextContributions: [
        contribution({
          macroName: "context.kb",
          sourceId: "kb",
          content: "知识库正文",
          characters: 5,
        }),
      ],
      estimateTokens: (text) => text.length,
    });

    const kb = snapshot.sources.find((item) => item.key === "context.kb");
    expect(kb).toMatchObject({
      label: "context.kb",
      included: true,
      count: 1,
      characters: 5,
      estimatedTokens: 5,
    });
    // 纳入的贡献与记忆源一样按内容计入 Token（不再有编排轨迹裁剪）。
    expect(snapshot.totalEstimatedTokens).toBe(9);
  });

  it("空贡献不占审计版面，失败贡献保留为未纳入", () => {
    const snapshot = audit([
      contribution({ macroName: "context.empty", sourceId: "e", status: "empty" }),
      contribution({ macroName: "context.failed", sourceId: "f", status: "failed", detail: "boom" }),
    ]);

    // 内建时钟来源每轮都有内容，若把「未纳入且无问题」的来源也列出来会刷满记忆抽屉。
    expect(snapshot.sources.find((item) => item.key === "context.empty")).toBeUndefined();
    expect(snapshot.sources.find((item) => item.key === "context.failed")).toMatchObject({
      included: false,
      estimatedTokens: 0,
    });
  });

  it("记忆贡献不重复计入（已由内建条目呈现）", () => {
    const snapshot = audit([
      contribution({
        macroName: "memory.recalled",
        sourceId: "memory.recall",
        content: "记忆正文",
        characters: 4,
      }),
    ]);

    expect(snapshot.sources.filter((item) => item.key === "memory.recalled")).toHaveLength(1);
    expect(snapshot.sources).toHaveLength(3);
  });

});
