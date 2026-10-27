import { describe, expect, it } from "vitest";
import type { LorebookEntry } from "../../src/types";
import {
  buildPromptAuditSnapshot,
  PROMPT_AUDIT_SECTION_MAX_CHARS,
} from "../../src/domain/promptAudit";
import { createLorebookAuditReport, recordLorebookBudgetDrop, recordLorebookHit } from "../../src/domain/lorebookAudit";
import { matchWorldInfoEntries } from "../../src/application/services/prompt/promptWorldInfo";

function entry(id: string, overrides: Partial<LorebookEntry> = {}): LorebookEntry {
  return {
    id,
    keys: [],
    content: id,
    constant: false,
    enabled: true,
    ...overrides,
  };
}

describe("本轮提示词审计快照", () => {
  it("按命中原因与来源整理世界书，并把被预算挤掉的条目单列", () => {
    const report = createLorebookAuditReport(1200, 3);
    recordLorebookHit(report, { entryId: "常驻", trigger: "constant" });
    recordLorebookHit(report, { entryId: "城门", trigger: "keyword", matchedKey: "城门" });
    recordLorebookBudgetDrop(report, "长文", 9000);

    const snapshot = buildPromptAuditSnapshot({
      sessionId: "s1",
      capturedAt: 1_700_000_000_000,
      generationType: "normal",
      report,
      allEntries: [
        entry("常驻", { comment: "世界背景", constant: true, content: "背景正文" }),
        entry("城门", { keys: "城门, 守卫" as unknown as string[], content: "城门正文" }),
        entry("长文", { content: "x".repeat(9000) }),
      ],
      characterEntryIds: new Set(["常驻"]),
      sections: [],
      systemChars: 10,
      historyChars: 20,
      userInputChars: 5,
    });

    expect(snapshot.lorebook.candidateCount).toBe(3);
    expect(snapshot.lorebook.budgetChars).toBe(1200);
    expect(snapshot.lorebook.entries).toEqual([
      expect.objectContaining({ id: "常驻", title: "世界背景", source: "character", trigger: "constant" }),
      expect.objectContaining({
        id: "城门",
        source: "global",
        trigger: "keyword",
        matchedKey: "城门",
        // 历史数据里 keys 可能是逗号字符串，展示层必须归一成数组
        keys: ["城门", "守卫"],
      }),
    ]);
    expect(snapshot.lorebook.budgetDropped).toEqual([{ id: "长文", title: "长文", chars: 9000 }]);
  });

  it("截断超长分区正文，避免快照撑爆运行时内存", () => {
    const snapshot = buildPromptAuditSnapshot({
      sessionId: "s1",
      capturedAt: 0,
      report: createLorebookAuditReport(6000),
      allEntries: [],
      characterEntryIds: new Set(),
      sections: [{
        id: "system",
        title: "系统",
        phase: "system",
        chars: PROMPT_AUDIT_SECTION_MAX_CHARS + 50,
        content: "a".repeat(PROMPT_AUDIT_SECTION_MAX_CHARS + 50),
      }],
      systemChars: 1,
      historyChars: 2,
      userInputChars: 3,
    });

    const section = snapshot.prompt.sections[0]!;
    expect(section.content.length).toBeLessThan(PROMPT_AUDIT_SECTION_MAX_CHARS + 100);
    expect(section.content).toContain("已截断");
  });
});

describe("matchWorldInfoEntries 审计收集", () => {
  it("兼容解析器启用时把关键词命中写入同一份报告", () => {
    const report = createLorebookAuditReport(6000, 2);
    const resolver = {
      resolve: (request: { entries: LorebookEntry[]; audit?: typeof report }) => {
        if (request.audit) recordLorebookHit(request.audit, { entryId: "城门", trigger: "keyword", matchedKey: "城门" });
        return [entry("城门")];
      },
    } as unknown as Parameters<typeof matchWorldInfoEntries>[4];

    const result = matchWorldInfoEntries(
      [],
      "城门",
      [entry("城门", { keys: ["城门"] }), entry("常驻", { constant: true })],
      { budgetChars: 6000, audit: report },
      resolver,
    );

    expect(result.map((item) => item.id)).toEqual(["城门"]);
    expect(report.hits).toEqual([{ entryId: "城门", trigger: "keyword", matchedKey: "城门" }]);
  });

  it("无兼容解析器时走通用解析器，并容忍字符串形式的 keys", () => {
    const report = createLorebookAuditReport(6000, 2);
    const result = matchWorldInfoEntries(
      [],
      "城门",
      [entry("城门", { keys: "城门, 守卫" as unknown as string[] })],
      { budgetChars: 6000, audit: report },
      null,
    );

    expect(result.map((item) => item.id)).toEqual(["城门"]);
    expect(report.hits).toEqual([{ entryId: "城门", trigger: "keyword", matchedKey: "城门" }]);
  });
});
