import { describe, expect, it } from "vitest";
import { readPresetBundle } from "../../src/domain/presets/bundleMigration";
import type { PromptConfig } from "../../src/types";
import {
  removePromptBlocksByIds,
  setPromptBlockEnabledById,
} from "../../src/domain/prompts/promptBlockIdentity";

const promptConfig = (overrides: Partial<PromptConfig> = {}): PromptConfig => ({
  mainPrompt: "MAIN",
  jailbreakPrompt: "JAIL",
  useJailbreak: false,
  instructTemplate: "default",
  systemPrefix: "",
  systemSuffix: "",
  userPrefix: "",
  userSuffix: "",
  assistantPrefix: "",
  assistantSuffix: "",
  ...overrides,
});

describe("预设实体 v1/v2 → v3 迁移", () => {
  it("v1 记录只保留传统 Prompt 字段，编排字段整体丢弃", () => {
    const result = readPresetBundle({
      id: "bundle_1",
      preset: { id: "preset_1", name: "旧预设" },
      promptConfig: promptConfig({ mainPrompt: "V1_MAIN" }),
      presetRegexScripts: [],
      // 编排时期的字段：迁移时必须丢弃而不是保留
      promptPlan: { version: 1, mode: "composition", source: "sillytavern", composition: { blocks: [] } },
      composition: { id: "composition_x", name: "编排", version: 1, blocks: [] },
      usePromptComposition: true,
    });

    expect(result).not.toBeNull();
    expect(result?.migrated).toBe(true);
    expect(result?.bundle.schemaVersion).toBe(3);
    expect(result?.bundle.promptConfig.mainPrompt).toBe("V1_MAIN");
    expect(result?.bundle).not.toHaveProperty("prompt");
    expect(result?.bundle.extensions ?? {}).not.toHaveProperty("composition");
  });

  it("v2 记录从 legacyPromptConfig 取传统字段，编排快照不再进入新实体", () => {
    const result = readPresetBundle({
      schemaVersion: 2,
      id: "bundle_2",
      sampler: { id: "preset_2", name: "v2 预设", temperature: 0.7 },
      prompt: { version: 2, mode: "composition", source: "sillytavern", composition: { blocks: [] } },
      legacyPromptConfig: promptConfig({ mainPrompt: "V2_MAIN" }),
      regexScripts: [],
    });

    expect(result?.bundle.schemaVersion).toBe(3);
    expect(result?.bundle.promptConfig.mainPrompt).toBe("V2_MAIN");
    expect(result?.bundle.sampler.temperature).toBe(0.7);
    expect(result?.bundle).not.toHaveProperty("prompt");
  });

  it("v3 记录原样通过校验，不产生迁移写入", () => {
    const result = readPresetBundle({
      schemaVersion: 3,
      id: "bundle_3",
      sampler: { id: "preset_3", name: "v3 预设" },
      promptConfig: promptConfig({ mainPrompt: "V3_MAIN" }),
      regexScripts: [],
    });

    expect(result?.migrated).toBe(false);
    expect(result?.bundle.promptConfig.mainPrompt).toBe("V3_MAIN");
  });
});

describe("提示词列表的身份口径", () => {
  const blocks = [
    { id: "style", identifier: "style", name: "甲", role: "system" as const, content: "A", enabled: true },
    { id: "style_2", identifier: "style", name: "乙", role: "system" as const, content: "B", enabled: true },
  ];

  it("同 identifier 的兄弟条目不再被一起开关或删除", () => {
    const toggled = setPromptBlockEnabledById(blocks, "style_2", false);
    expect(toggled.map((item) => item.enabled)).toEqual([true, false]);

    const removed = removePromptBlocksByIds(blocks, ["style_2"]);
    expect(removed.map((item) => item.id)).toEqual(["style"]);
  });

  it("缺 id 的历史条目按 identifier 命中，未命中时返回原数组", () => {
    // 历史数据里 `id` 可能整条缺失：用空 id 建模，与运行期 `id ? ... : identifier` 判定一致。
    const legacy = [{ id: "", identifier: "legacy", name: "旧", role: "system" as const, content: "C", enabled: true }];

    const toggled = setPromptBlockEnabledById(legacy, "legacy", false);
    expect(toggled[0]).toMatchObject({ id: "legacy", enabled: false });
    expect(setPromptBlockEnabledById(toggled, "legacy", false)).toBe(toggled);
    expect(removePromptBlocksByIds(toggled, ["missing"])).toBe(toggled);
  });
});
