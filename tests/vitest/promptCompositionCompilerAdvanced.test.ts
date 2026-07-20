import { describe, expect, it } from "vitest";
import {
  compilePromptComposition,
  validatePromptComposition,
  type PromptComposition,
} from "../../src/domain/prompt-composition";

describe("PromptComposition 高阶校验与 Token 预算", () => {
  it("同时报告空模板、重复 ID、无效深度目标与不可用数据源", () => {
    const composition: PromptComposition = {
      id: "invalid-composition",
      name: "校验测试",
      version: 1,
      blocks: [
        block("duplicate", "空模板", ""),
        block("duplicate", "未知宏", "{{missing.source}}"),
        {
          ...block("injection", "错误注入", "内容"),
          placement: { type: "in_chat", depth: 2, historyBlockId: "not-found" },
        },
      ],
    };

    const diagnostics = validatePromptComposition(composition, { availableDataKeys: ["character.name"] });
    expect(diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      "EMPTY_TEMPLATE",
      "DUPLICATE_BLOCK_ID",
      "INVALID_HISTORY_TARGET",
      "UNAVAILABLE_DATA_SOURCE",
    ]));
  });

  it("超出预算时仅按优先级裁剪显式 drop 区块", () => {
    const composition: PromptComposition = {
      id: "budget-composition",
      name: "预算测试",
      version: 1,
      blocks: [
        { ...block("keep", "必须保留", "KEEP"), tokenPolicy: { priority: 100, overflow: "keep" } },
        { ...block("drop-first", "低优先级", "1234567890"), tokenPolicy: { priority: 10, overflow: "drop" } },
        { ...block("drop-second", "高优先级", "abcdefghij"), tokenPolicy: { priority: 80, overflow: "drop" } },
      ],
    };

    const result = compilePromptComposition(composition, { values: {}, history: [] }, {
      tokenBudget: 14,
      estimateTokens: (text) => text.length,
    });

    expect(result.messages.map((message) => message.content)).toEqual(["KEEP", "abcdefghij"]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "TOKEN_BUDGET_DROPPED_BLOCK", blockId: "drop-first" }),
    ]));
    expect(result.budget).toMatchObject({ limit: 14, used: 14, droppedBlockIds: ["drop-first"] });
  });

  it("不可裁剪内容仍超限时保留内容并产生错误诊断", () => {
    const composition: PromptComposition = {
      id: "keep-over-budget",
      name: "保留测试",
      version: 1,
      blocks: [{ ...block("keep", "保留", "123456"), tokenPolicy: { priority: 1, overflow: "keep" } }],
    };
    const result = compilePromptComposition(composition, { values: {}, history: [] }, {
      tokenBudget: 3,
      estimateTokens: (text) => text.length,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "TOKEN_BUDGET_EXCEEDED" }));
  });

  it("记录每条最终消息由哪个区块和哪些真实数据源生成", () => {
    const composition: PromptComposition = {
      id: "trace-composition",
      name: "链路测试",
      version: 1,
      blocks: [block("context", "上下文", "{{character.description}}\n{{worldbook.triggered}}")],
    };
    const result = compilePromptComposition(composition, {
      values: { "character.description": "角色", "worldbook.triggered": "世界书" },
      history: [],
    });

    expect(result.traces).toContainEqual(expect.objectContaining({
      blockId: "context",
      messageIndexes: [0],
      dataKeys: ["character.description", "worldbook.triggered"],
      resolvedDataKeys: ["character.description", "worldbook.triggered"],
      dropped: false,
    }));
  });
});

function block(id: string, name: string, template: string) {
  return {
    id,
    name,
    enabled: true,
    role: "system" as const,
    source: { type: "template" as const },
    template,
    order: 100,
    placement: { type: "ordered" as const },
  };
}
