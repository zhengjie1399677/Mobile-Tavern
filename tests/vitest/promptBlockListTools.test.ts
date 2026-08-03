import { describe, expect, it } from "vitest";
import type { PromptComposition } from "../../src/domain/prompt-composition";
import {
  buildPromptBlockListGroups,
  estimatePromptBlockTokens,
  patchSelectedBlockStates,
  removePromptBlocks,
} from "../../src/components/presetForm/promptBlockListTools";

const composition: PromptComposition = {
  id: "tools",
  name: "工具测试",
  version: 1,
  blocks: [
    { id: "system", name: "世界规则", enabled: true, role: "system", source: { type: "template" }, template: "WORLD", order: 100, placement: { type: "ordered" } },
    { id: "history", name: "聊天记录", enabled: true, role: "system", source: { type: "chat_history" }, template: "", order: 200, placement: { type: "ordered" } },
    { id: "style", name: "写作风格", enabled: false, role: "user", source: { type: "template" }, template: "STYLE", order: 300, placement: { type: "in_chat", depth: 1 } },
  ],
  sceneProfiles: [{ id: "scene", name: "场景", blockStates: { system: true, style: true } }],
};

describe("Prompt 大列表工具", () => {
  it("搜索、分组并按 Token 成本排序", () => {
    const groups = buildPromptBlockListGroups({
      blocks: composition.blocks,
      query: "",
      groupMode: "role",
      sortMode: "tokens",
      tokenByBlockId: new Map([["system", 20], ["history", 100], ["style", 50]]),
    });
    expect(groups.map((group) => group.key)).toEqual(["system", "user", "history"]);
    expect(groups.flatMap((group) => group.items).map((item) => item.block.id)).toEqual(["system", "style", "history"]);
    expect(buildPromptBlockListGroups({
      blocks: composition.blocks,
      query: "STYLE",
      groupMode: "none",
      sortMode: "order",
      tokenByBlockId: new Map(),
    })[0].items.map((item) => item.block.id)).toEqual(["style"]);
  });

  it("批量开关不会修改未选区块", () => {
    const result = patchSelectedBlockStates(composition, new Set(["style"]), true);
    expect(result.blocks.map((block) => block.enabled)).toEqual([true, true, true]);
  });

  it("批量删除同步清理场景方案引用", () => {
    const result = removePromptBlocks(composition, new Set(["style"]));
    expect(result.blocks.map((block) => block.id)).toEqual(["system", "history"]);
    expect(result.sceneProfiles?.[0].blockStates).toEqual({ system: true });
  });

  it("未启用区块也能按原始模板估算 Token", () => {
    expect(estimatePromptBlockTokens(composition.blocks[2])).toBeGreaterThan(0);
    expect(estimatePromptBlockTokens(composition.blocks[1])).toBe(0);
  });
});
