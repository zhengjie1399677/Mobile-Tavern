import { describe, expect, it } from "vitest";
import { ensureUniquePromptBlockIds } from "../../src/domain/prompts/promptBlockIdentity";
import {
  applyLegacyPromptRemoval,
  applyLegacyPromptSwitch,
} from "../../src/application/useCases/promptSwitchSync";
import type { CustomPromptBlock, PromptConfig } from "../../src/types";

/**
 * 历史数据里 `id` 可能整条缺失（类型声明是必填，实际来自外部 JSON 导入），
 * 这里显式用空 id 建模"没有 id"，与运行期 `id ? ... : identifier` 的判定一致。
 */
function block(overrides: Partial<CustomPromptBlock>): CustomPromptBlock {
  return {
    id: "",
    name: "模组",
    role: "system",
    content: "内容",
    enabled: true,
    ...overrides,
  } as CustomPromptBlock;
}

function promptConfig(customPrompts: CustomPromptBlock[]): PromptConfig {
  return {
    mainPrompt: "",
    jailbreakPrompt: "",
    useJailbreak: false,
    instructTemplate: "default",
    systemPrefix: "",
    systemSuffix: "",
    userPrefix: "",
    userSuffix: "",
    assistantPrefix: "",
    assistantSuffix: "",
    customPrompts,
  };
}

describe("提示词区块身份归一 (promptBlockIdentity)", () => {
  it("重复 identifier 的条目各自获得唯一 id，并保留 identifier 作为兼容别名", () => {
    const source = [
      block({ identifier: "writing_style", name: "甲" }),
      block({ identifier: "writing_style", name: "乙" }),
    ];

    const normalized = ensureUniquePromptBlockIds(source);

    expect(normalized.map((item) => item.id)).toEqual(["writing_style", "writing_style_2"]);
    expect(normalized.map((item) => item.identifier)).toEqual(["writing_style", "writing_style"]);
  });

  it("已有唯一 id 时原对象返回，保证重复归一不产生写入", () => {
    const source = [
      block({ id: "a", name: "甲" }),
      block({ id: "b", identifier: "b", name: "乙" }),
    ];

    const once = ensureUniquePromptBlockIds(source);
    const twice = ensureUniquePromptBlockIds(once);

    expect(once[0]).toBe(source[0]);
    expect(once[1]).toBe(source[1]);
    expect(twice[0]).toBe(once[0]);
    expect(twice[1]).toBe(once[1]);
  });

  it("缺失 id 且重复的条目按位置补齐确定性 id，避免脏检查抖动", () => {
    const source = [block({ name: "甲" }), block({ name: "乙" })];

    const first = ensureUniquePromptBlockIds(source).map((item) => item.id);
    const second = ensureUniquePromptBlockIds(source).map((item) => item.id);

    expect(first).toEqual(["comp_1", "comp_2"]);
    expect(second).toEqual(first);
  });

  it("开关与删除只命中 id 精确匹配的条目，不再牵连同 identifier 的兄弟条目", () => {
    const config = promptConfig([
      block({ id: "writing_style", identifier: "writing_style", name: "甲" }),
      block({ id: "writing_style_2", identifier: "writing_style", name: "乙" }),
    ]);

    const toggled = applyLegacyPromptSwitch(config, "writing_style_2", false);
    expect(toggled.customPrompts?.map((item) => item.enabled)).toEqual([true, false]);

    const removed = applyLegacyPromptRemoval(config, ["writing_style_2"]);
    expect(removed.customPrompts?.map((item) => item.id)).toEqual(["writing_style"]);
  });

  it("没有 id 的历史条目仍可按 identifier 开关与删除", () => {
    const config = promptConfig([block({ identifier: "legacy_only", name: "旧条目" })]);

    expect(applyLegacyPromptSwitch(config, "legacy_only", false).customPrompts?.[0].enabled).toBe(false);
    expect(applyLegacyPromptRemoval(config, ["legacy_only"]).customPrompts).toHaveLength(0);
  });
});
