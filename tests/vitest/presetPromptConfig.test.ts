import { describe, expect, it } from "vitest";
import {
  applyPresetCompositionToPromptConfig,
  createPromptPresetPlan,
  normalizeSavedPresetPromptPlan,
  resolvePromptPresetPlan,
  toPresetPromptConfig,
} from "../../src/application/useCases/presetPromptConfig";
import { DEFAULT_PROMPT_CONFIG, DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import type { SavedPresetBundle } from "../../src/types";

function createBundle(): SavedPresetBundle {
  return {
    id: "legacy-bundle",
    preset: { ...DEFAULT_SETTINGS.preset, id: "legacy-preset", name: "旧预设" },
    promptConfig: toPresetPromptConfig({
      ...DEFAULT_PROMPT_CONFIG,
      mainPrompt: "LEGACY MAIN",
      customPrompts: [{
        id: "custom",
        name: "自定义",
        role: "system",
        content: "CUSTOM",
        enabled: true,
      }],
    }),
  };
}

describe("版本化预设 Prompt 快照", () => {
  it("无版本旧预设明确降级为 legacy，并生成不依赖当前预设的迁移快照", () => {
    const bundle = createBundle();
    const plan = resolvePromptPresetPlan(bundle);

    expect(plan).toMatchObject({ version: 1, mode: "legacy", source: "mobile-tavern" });
    expect(plan.composition?.compatibility?.source).toBe("mobile-tavern-legacy");
    expect(plan.composition?.blocks).toContainEqual(expect.objectContaining({
      template: "CUSTOM",
      compatibility: expect.objectContaining({ originalIdentifier: "custom" }),
    }));

    const current = {
      ...DEFAULT_PROMPT_CONFIG,
      usePromptComposition: true,
      composition: { id: "other-preset", name: "其他预设", version: 1 as const, blocks: [] },
    };
    const applied = applyPresetCompositionToPromptConfig(current, bundle);
    expect(applied.usePromptComposition).toBe(false);
    expect(applied.composition?.id).not.toBe("other-preset");
  });

  it("旧版 composition 字段无损升级为 composition 模式", () => {
    const bundle = createBundle();
    bundle.composition = {
      id: "st-composition",
      name: "ST",
      version: 1,
      blocks: [],
      compatibility: { source: "sillytavern" },
    };
    bundle.usePromptComposition = true;

    expect(resolvePromptPresetPlan(bundle)).toEqual({
      version: 1,
      mode: "composition",
      source: "sillytavern",
      composition: bundle.composition,
    });
  });

  it("规范化后只保留 promptPlan 作为权威字段", () => {
    const bundle = createBundle();
    bundle.composition = DEFAULT_PROMPT_CONFIG.composition;
    bundle.usePromptComposition = false;

    const normalized = normalizeSavedPresetPromptPlan(bundle);
    expect(normalized.promptPlan).toMatchObject({ version: 1, mode: "legacy" });
    expect(normalized).not.toHaveProperty("composition");
    expect(normalized).not.toHaveProperty("usePromptComposition");
    expect(normalized.promptConfig).not.toHaveProperty("composition");
    expect(normalized.promptConfig).not.toHaveProperty("usePromptComposition");
  });

  it("新保存快照显式记录来源和运行模式", () => {
    expect(createPromptPresetPlan({
      ...DEFAULT_PROMPT_CONFIG,
      usePromptComposition: true,
    }, "native")).toMatchObject({
      version: 1,
      mode: "composition",
      source: "native",
    });
  });
});
