import { describe, expect, it } from "vitest";
import {
  createBasicPromptComposition,
  createPromptCompositionTemplateRecord,
  parsePromptComposition,
  serializePromptComposition,
} from "../../src/domain/prompt-composition";

describe("PromptComposition 模板库与预算编解码", () => {
  it("创建独立的用户与 SillyTavern 模板记录快照", () => {
    const composition = createBasicPromptComposition();
    const user = createPromptCompositionTemplateRecord(composition, "user", 100);
    const sillyTavern = createPromptCompositionTemplateRecord(composition, "external", 200);

    composition.blocks[0].name = "已修改";
    expect(user).toMatchObject({ source: "user", createdAt: 100, updatedAt: 100 });
    expect(sillyTavern).toMatchObject({ source: "external", createdAt: 200, updatedAt: 200 });
    expect(user.composition.blocks[0].name).not.toBe("已修改");
  });

  it("JSON 往返保留组合级 Token 预算", () => {
    const composition = createBasicPromptComposition();
    composition.tokenBudget = { enabled: true, mode: "custom", maxTokens: 4096 };

    expect(parsePromptComposition(serializePromptComposition(composition)).tokenBudget).toEqual({
      enabled: true,
      mode: "custom",
      maxTokens: 4096,
    });
  });
});
