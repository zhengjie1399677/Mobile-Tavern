import { describe, expect, it } from "vitest";
import type { PromptComposition } from "../../src/domain/prompt-composition";
import { removePromptBlocks } from "../../src/domain/prompt-composition";

const composition: PromptComposition = {
  id: "editing",
  name: "编辑操作测试",
  version: 1,
  blocks: [
    { id: "system", name: "世界规则", enabled: true, role: "system", source: { type: "template" }, template: "WORLD", order: 100, placement: { type: "ordered" } },
    { id: "history", name: "聊天记录", enabled: true, role: "system", source: { type: "chat_history" }, template: "", order: 200, placement: { type: "ordered" } },
    { id: "style", name: "写作风格", enabled: false, role: "user", source: { type: "template" }, template: "STYLE", order: 300, placement: { type: "in_chat", depth: 1 } },
  ],
  sceneProfiles: [{ id: "scene", name: "场景", blockStates: { system: true, style: true } }],
};

describe("removePromptBlocks", () => {
  it("删除区块并清理场景方案里对它的开关覆盖", () => {
    const result = removePromptBlocks(composition, new Set(["style"]));

    expect(result.blocks.map((block) => block.id)).toEqual(["system", "history"]);
    expect(result.sceneProfiles?.[0].blockStates).toEqual({ system: true });
  });

  it("未被删除的场景方案引用必须原样保留", () => {
    const result = removePromptBlocks(composition, new Set(["history"]));

    expect(result.blocks.map((block) => block.id)).toEqual(["system", "style"]);
    expect(result.sceneProfiles?.[0].blockStates).toEqual({ system: true, style: true });
  });
});
