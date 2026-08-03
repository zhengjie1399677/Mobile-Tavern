import { describe, expect, it } from "vitest";
import { preparePresetBundleExport } from "../../src/application/useCases/preparePresetBundleExport";
import { preparePresetBundleImport } from "../../src/application/useCases/preparePresetBundleImport";
import { DEFAULT_PROMPT_CONFIG, DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import { SILLY_TAVERN_PRESET_ARCHETYPES } from "../fixtures/sillyTavernPresetArchetypes";

describe("preparePresetBundleExport", () => {
  it("自由编排正式导出保留顺序、注入、请求整形和安全正则", () => {
    const fixture = getFixture("universal-light-current");
    const imported = preparePresetBundleImport({
      input: fixture.preset,
      fallbackName: "fixture",
      currentPromptConfig: DEFAULT_PROMPT_CONFIG,
      createId: (kind) => `${kind}-id`,
    });
    if (!imported.composition) throw new Error("缺少导入编排");
    const promptConfig = {
      ...DEFAULT_PROMPT_CONFIG,
      usePromptComposition: true,
      composition: imported.composition,
      requestShaping: {
        enabled: true,
        mergeAdjacentMessages: true,
        squashSystemMessages: true,
        roleWrappers: { system: { prefix: "<s>", suffix: "</s>" } },
        assistantPrefill: "继续：",
        stopSequences: ["</turn>"],
      },
    };
    const result = preparePresetBundleExport({
      preset: { ...DEFAULT_SETTINGS.preset, name: "正式导出" },
      promptConfig,
      presetRegexScripts: imported.bundle.presetRegexScripts,
    });
    const order = result.data.prompt_order as Array<{
      character_id: number;
      order: Array<{ identifier: string; enabled: boolean }>;
    }>;
    const prompts = result.data.prompts as Array<Record<string, unknown>>;

    expect(order[0].character_id).toBe(100001);
    expect(order[0].order.map((entry) => entry.identifier)).toEqual([
      "main", "worldInfoBefore", "chatHistory", "format-tail",
    ]);
    expect(prompts.find((prompt) => prompt.identifier === "format-tail")).toMatchObject({
      injection_position: 1,
      injection_depth: 1,
      injection_order: 20,
    });
    expect(result.data).toMatchObject({
      name: "正式导出",
      assistant_prefill: "继续：",
      squash_system_messages: true,
      merge_adjacent_messages: true,
      custom_stop_strings: ["</turn>"],
      role_wrappers: { system: { prefix: "<s>", suffix: "</s>" } },
    });
    expect((result.data.extensions as { regex_scripts: unknown[] }).regex_scripts).toHaveLength(36);
    expect(JSON.stringify(result.data)).not.toContain("tavern_helper");
    expect(JSON.stringify(result.data)).not.toContain("fixture.invalid");
  });

  it("传统 Prompt 也补齐 100001 顺序容器", () => {
    const result = preparePresetBundleExport({
      preset: DEFAULT_SETTINGS.preset,
      promptConfig: {
        ...DEFAULT_PROMPT_CONFIG,
        usePromptComposition: false,
        customPrompts: [
          { id: "one", identifier: "first", name: "一", role: "system", content: "A", enabled: true },
          { id: "two", name: "二", role: "user", content: "B", enabled: false },
        ],
      },
    });
    const order = result.data.prompt_order as Array<{
      order: Array<{ identifier: string; enabled: boolean }>;
    }>;

    expect(order[0].order).toEqual([
      { identifier: "first", enabled: true },
      { identifier: "two", enabled: false },
    ]);
  });

  it("重前端来源导出时剥离保留的外部脚本", () => {
    const fixture = getFixture("frontend-heavy");
    const imported = preparePresetBundleImport({
      input: fixture.preset,
      fallbackName: "fixture",
      currentPromptConfig: DEFAULT_PROMPT_CONFIG,
    });
    if (!imported.composition) throw new Error("缺少导入编排");
    const result = preparePresetBundleExport({
      preset: DEFAULT_SETTINGS.preset,
      promptConfig: {
        ...DEFAULT_PROMPT_CONFIG,
        usePromptComposition: true,
        composition: imported.composition,
      },
      presetRegexScripts: imported.bundle.presetRegexScripts,
    });
    const serialized = JSON.stringify(result.data);

    expect(serialized).not.toContain("frontend-runtime.js");
    expect(serialized).not.toContain("tavern_helper");
    expect((result.data.extensions as { regex_scripts: unknown[] }).regex_scripts).toHaveLength(8);
  });

  it("导出结果可重新进入正式导入用例并保持请求整形", () => {
    const exported = preparePresetBundleExport({
      preset: DEFAULT_SETTINGS.preset,
      promptConfig: {
        ...DEFAULT_PROMPT_CONFIG,
        requestShaping: {
          enabled: true,
          mergeAdjacentMessages: true,
          squashSystemMessages: true,
          roleWrappers: { assistant: { prefix: "A:" } },
          assistantPrefill: "PREFILL",
          stopSequences: ["STOP"],
        },
      },
    });
    const imported = preparePresetBundleImport({
      input: exported.data,
      fallbackName: "roundtrip",
      currentPromptConfig: DEFAULT_PROMPT_CONFIG,
    });

    expect(imported.bundle.promptConfig.requestShaping).toEqual({
      enabled: true,
      mergeAdjacentMessages: true,
      squashSystemMessages: true,
      roleWrappers: { assistant: { prefix: "A:" } },
      assistantPrefill: "PREFILL",
      stopSequences: ["STOP"],
    });
  });
});

function getFixture(id: string) {
  const fixture = SILLY_TAVERN_PRESET_ARCHETYPES.find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`缺少测试形状：${id}`);
  return fixture;
}
