import { describe, expect, it } from "vitest";
import { applyAgentProfilePresetBinding } from "../../src/application/useCases/agentProfilePresetBinding";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import type { SavedPresetBundle, UserSettings } from "../../src/types";

const PRESET_DEFAULTS = DEFAULT_SETTINGS.preset;

function createSettings(): UserSettings {
  return structuredClone(DEFAULT_SETTINGS) as UserSettings;
}

function createBundle(id: string): SavedPresetBundle {
  const base = createSettings();
  return {
    id,
    preset: {
      ...base.preset,
      id: "sampler-guide",
      name: "向导行为",
      temperature: 0.9,
    },
    promptConfig: {
      ...base.promptConfig,
      mainPrompt: "固定向导行为",
    },
    presetRegexScripts: [{
      id: "regex-guide",
      scriptName: "向导清理",
      findRegex: "foo",
      replaceString: "bar",
      placement: [2],
      disabled: false,
      markdownOnly: false,
      promptOnly: false,
      runOnEdit: false,
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
    }],
  };
}

const SAMPLING = {
  temperature: 0.55,
  topP: 0.8,
  topK: 30,
  repetitionPenalty: 1.1,
  maxTokens: 700,
};

describe("applyAgentProfilePresetBinding", () => {
  it("没有绑定时返回原设置引用，不产生设置写入", () => {
    const settings = createSettings();

    expect(applyAgentProfilePresetBinding(settings, undefined, PRESET_DEFAULTS)).toEqual({
      outcome: "none",
      settings,
    });
    expect(applyAgentProfilePresetBinding(settings, {}, PRESET_DEFAULTS).settings).toBe(settings);
  });

  it("绑定的行为预设整体套用，采样叠加在预设采样之上", () => {
    const settings = createSettings();
    settings.savedPresets = [createBundle("preset-guide")];

    const result = applyAgentProfilePresetBinding(settings, {
      promptPresetId: "preset-guide",
      sampling: SAMPLING,
    }, PRESET_DEFAULTS);

    expect(result.outcome).toBe("applied");
    expect(result.settings.promptConfig.mainPrompt).toBe("固定向导行为");
    expect(result.settings.preset).toMatchObject({
      id: "sampler-guide",
      temperature: 0.55,
      topP: 0.8,
      maxTokens: 700,
    });
    expect(result.settings.presetRegexScripts).toEqual(createBundle("preset-guide").presetRegexScripts);
    // 纯函数：不得就地改写入参
    expect(settings.promptConfig.mainPrompt).not.toBe("固定向导行为");
  });

  it("绑定预设已删除时不静默换用其他预设，只套用采样并报告缺失", () => {
    const settings = createSettings();
    settings.savedPresets = [createBundle("preset-other")];
    const originalPromptConfig = settings.promptConfig;

    const result = applyAgentProfilePresetBinding(settings, {
      promptPresetId: "preset-missing",
      sampling: SAMPLING,
    }, PRESET_DEFAULTS);

    expect(result.outcome).toBe("preset-missing");
    expect(result.missingPresetId).toBe("preset-missing");
    expect(result.settings.preset.temperature).toBe(0.55);
    expect(result.settings.promptConfig).toBe(originalPromptConfig);
  });

  it("只绑定采样时套用采样而不改动提示词", () => {
    const settings = createSettings();
    const originalPromptConfig = settings.promptConfig;

    const result = applyAgentProfilePresetBinding(settings, { sampling: SAMPLING }, PRESET_DEFAULTS);

    expect(result.outcome).toBe("applied");
    expect(result.settings.preset.temperature).toBe(0.55);
    expect(result.settings.promptConfig).toBe(originalPromptConfig);
  });
});
