import { describe, expect, it } from "vitest";
import {
  compilePromptComposition,
  listPromptCompositionScenePresets,
  validatePromptComposition,
} from "../../src/domain/prompt-composition";
import { PROMPT_DATA_SOURCE_KEYS } from "../../src/components/presetForm/promptDataSources";

describe("PromptComposition 场景化预设", () => {
  it("提供五个可直接编辑的中立场景预设", () => {
    const presets = listPromptCompositionScenePresets();

    expect(presets.map((preset) => preset.id)).toEqual([
      "lightweight_chat",
      "long_chat_budget",
      "worldbook_priority",
      "memory_enhanced",
      "character_card_compatible",
    ]);
    for (const preset of presets) {
      expect(preset.composition.version).toBe(1);
      expect(preset.composition.blocks.length).toBeGreaterThan(0);
      expect(validatePromptComposition(preset.composition, {
        availableDataKeys: [...PROMPT_DATA_SOURCE_KEYS],
      })).toEqual([]);
    }
  });

  it("每次读取返回独立副本，加载后修改不会污染内置预设", () => {
    const first = listPromptCompositionScenePresets();
    first[0].composition.blocks[0].name = "用户修改";

    expect(listPromptCompositionScenePresets()[0].composition.blocks[0].name).not.toBe("用户修改");
  });

  it("数据源为空时不会生成任何内置行为引导文本", () => {
    const emptyValues = Object.fromEntries(PROMPT_DATA_SOURCE_KEYS.map((key) => [key, ""]));
    for (const preset of listPromptCompositionScenePresets()) {
      const result = compilePromptComposition(preset.composition, { values: emptyValues, history: [] });
      expect(result.messages).toEqual([]);
    }
  });
});
