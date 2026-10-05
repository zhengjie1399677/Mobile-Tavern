import { describe, expect, it } from "vitest";
import type { CustomPromptBlock } from "../../src/types";
import {
  dedupeTopLevelPromptBlocks,
  isSameSourcePromptBlock,
  selectActivePromptBlocks,
} from "../../src/domain/prompts/promptSourceBlocks";

const block = (overrides: Partial<CustomPromptBlock>): CustomPromptBlock => ({
  id: "custom_1",
  name: "模组",
  role: "system",
  content: "内容",
  enabled: true,
  ...overrides,
});

describe("promptSourceBlocks 同源去重", () => {
  it("核心槽位空占位或完全同文视为同源，内容不同则保留", () => {
    expect(isSameSourcePromptBlock(block({ identifier: "main", content: "" }), "main", "ROOT")).toBe(true);
    expect(isSameSourcePromptBlock(block({ identifier: "main", content: " ROOT " }), "main", "ROOT")).toBe(true);
    expect(isSameSourcePromptBlock(block({ identifier: "main", content: "别的正文" }), "main", "ROOT")).toBe(false);
    expect(isSameSourcePromptBlock(block({ identifier: "chatHistory", content: "" }), "main", "ROOT")).toBe(false);
    // 顶层字段为空时没有任何可去重的对象。
    expect(isSameSourcePromptBlock(block({ identifier: "main", content: "" }), "main", "")).toBe(false);
    // id 兜底：没有 identifier 的旧记录按 id 识别。
    expect(isSameSourcePromptBlock(block({ id: "jailbreak", content: "JAIL" }), "jailbreak", "JAIL")).toBe(true);
  });

  it("dedupeTopLevelPromptBlocks 只剔除同源项，保留真实模组", () => {
    const blocks = [
      block({ identifier: "main", content: "ROOT" }),
      block({ id: "custom_a", identifier: "custom_a", content: "A" }),
      block({ identifier: "jailbreak", content: "" }),
    ];
    expect(dedupeTopLevelPromptBlocks(blocks, { mainPrompt: "ROOT", jailbreakPrompt: "JAIL" }))
      .toEqual([blocks[1]]);
  });

  it("运行期选择：过滤未启用、按注入顺序排序，并且只对生效中的顶层字段去重", () => {
    const blocks = [
      block({ id: "off", identifier: "off", content: "OFF", enabled: false }),
      block({ id: "main", identifier: "main", content: "ROOT" }),
      block({ id: "late", identifier: "late", content: "LATE", injection_order: 20 }),
      block({ id: "early", identifier: "early", content: "EARLY", order: 10 }),
    ];
    const config = {
      mainPrompt: "ROOT",
      jailbreakPrompt: "JAIL",
      useMainPrompt: true,
      useJailbreak: false,
    };

    expect(selectActivePromptBlocks(blocks, config).map((item) => item.id))
      .toEqual(["early", "late"]);

    // 顶层 mainPrompt 被显式关闭时不去重：同源区块是该正文唯一载体。
    expect(selectActivePromptBlocks(blocks, { ...config, useMainPrompt: false }).map((item) => item.id))
      .toEqual(["main", "early", "late"]);
  });
});
