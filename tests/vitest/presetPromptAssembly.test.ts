import { describe, expect, it } from "vitest";
import { PromptService } from "../../src/application/services/PromptService";
import { DEFAULT_PROMPT_CONFIG, DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import { createBasicPromptComposition } from "../../src/domain/prompt-composition";
import {
  buildPresetBundleSnapshot,
  resolvePresetBundleActivation,
} from "../../src/application/useCases/presetBundleLifecycle";
import type {
  CharacterCard,
  ChatSession,
  PromptConfig,
  SavedPresetBundle,
  UserSettings,
} from "../../src/types";

const CHARACTER = {
  id: "preset-assembly-character",
  name: "核查角色",
  description: "角色资料",
  personality: "",
  scenario: "",
  first_mes: "",
  mes_example: "",
  extensions: {},
  lorebookEntries: [],
} as CharacterCard;

const CHAT = {
  id: "preset-assembly-chat",
  characterId: CHARACTER.id,
  title: "预设装配核查",
  createdAt: 1,
  summaries: [],
  messages: [
    { id: "m1", sender: "user", content: "开场", timestamp: 1 },
    { id: "m2", sender: "assistant", content: "回应", timestamp: 2 },
  ],
} as unknown as ChatSession;

function createBundle(
  id: string,
  promptConfig: PromptConfig,
): SavedPresetBundle {
  return buildPresetBundleSnapshot(
    {
      preset: { ...DEFAULT_SETTINGS.preset, id: `preset_${id}`, name: id },
      promptConfig,
      presetRegexScripts: [],
    },
    { id: `bundle_${id}`, planSource: "native" },
  );
}

/** 用给定的预设包激活设置，模拟下拉框里的真实切换路径。 */
function activate(
  current: UserSettings,
  bundle: SavedPresetBundle,
): UserSettings {
  return {
    ...current,
    ...resolvePresetBundleActivation(current.promptConfig, bundle, DEFAULT_SETTINGS.preset),
  };
}

interface AssemblyResult {
  messages: Array<{ content: string }>;
  systemInstruction?: string;
  stopSequences?: string[];
}

function assemble(settings: UserSettings): AssemblyResult {
  const service = new PromptService();
  return service.assemblePrompt({
    character: CHARACTER,
    chat: CHAT,
    userInput: "继续",
    settings,
  }) as AssemblyResult;
}

function promptText(result: AssemblyResult): string {
  return [result.systemInstruction ?? "", ...result.messages.map((message) => message.content)].join("\n");
}

describe("预设整体提示词装配", () => {
  it("切换传统预设时只出现当前预设的主提示词与区块", () => {
    const presetA = createBundle("A", {
      ...DEFAULT_PROMPT_CONFIG,
      mainPrompt: "AAA 主提示词",
      customPrompts: [
        { id: "block_a", name: "A 区块", role: "system", content: "AAA 区块内容", enabled: true },
      ],
    });
    const presetB = createBundle("B", {
      ...DEFAULT_PROMPT_CONFIG,
      mainPrompt: "BBB 主提示词",
      customPrompts: [
        { id: "block_b", name: "B 区块", role: "system", content: "BBB 区块内容", enabled: true },
      ],
    });

    const base = structuredClone(DEFAULT_SETTINGS);
    const withA = activate(base, presetA);
    const textA = promptText(assemble(withA));
    expect(textA).toContain("AAA 主提示词");
    expect(textA).toContain("AAA 区块内容");
    expect(textA).not.toContain("BBB");

    const withB = activate(withA, presetB);
    const textB = promptText(assemble(withB));
    expect(textB).toContain("BBB 主提示词");
    expect(textB).toContain("BBB 区块内容");
    expect(textB).not.toContain("AAA");

    const backToA = activate(withB, presetA);
    const textBackToA = promptText(assemble(backToA));
    expect(textBackToA).toContain("AAA 主提示词");
    expect(textBackToA).not.toContain("BBB");
  });

  it("未声明请求整形的预设不会继承上一个预设的整形配置", () => {
    // 模拟早期保存、完全没有 requestShaping 字段的预设。
    const { requestShaping: _omitted, ...legacyPromptConfig } = DEFAULT_PROMPT_CONFIG;
    const plainPreset = createBundle("PLAIN", {
      ...legacyPromptConfig,
      mainPrompt: "普通预设主提示词",
    } as PromptConfig);
    const shapingPreset = createBundle("SHAPING", {
      ...DEFAULT_PROMPT_CONFIG,
      mainPrompt: "带请求整形的预设",
      requestShaping: {
        enabled: true,
        mergeAdjacentMessages: true,
        squashSystemMessages: true,
        assistantPrefill: "上一个预设的预填充",
        stopSequences: ["STOP_FROM_PREVIOUS_PRESET"],
      },
    });

    const base = structuredClone(DEFAULT_SETTINGS);
    const withShaping = activate(base, shapingPreset);
    const shapedResult = assemble(withShaping);
    expect(shapedResult.stopSequences).toEqual(["STOP_FROM_PREVIOUS_PRESET"]);
    expect(promptText(shapedResult)).toContain("上一个预设的预填充");

    const backToPlain = activate(withShaping, plainPreset);
    const plainResult = assemble(backToPlain);
    expect(plainResult.stopSequences).toBeUndefined();
    expect(promptText(plainResult)).not.toContain("上一个预设的预填充");
    expect(promptText(plainResult)).toContain("普通预设主提示词");
  });

  it("传统预设与自由编排预设互相切换时运行模式与内容整体切换", () => {
    const legacyPreset = createBundle("LEGACY", {
      ...DEFAULT_PROMPT_CONFIG,
      mainPrompt: "LEGACY 主提示词",
    });
    const compositionPreset = createBundle("COMPOSED", {
      ...DEFAULT_PROMPT_CONFIG,
      mainPrompt: "COMPOSED 主提示词",
      usePromptComposition: true,
      composition: {
        ...createBasicPromptComposition(),
        id: "composition_switch",
        name: "切换核查编排",
        blocks: [{
          id: "composed-block",
          name: "编排区块",
          enabled: true,
          role: "system",
          source: { type: "template" },
          template: "COMPOSED 编排区块",
          order: 100,
          placement: { type: "ordered" },
        }],
      },
    });

    const base = structuredClone(DEFAULT_SETTINGS);
    const withLegacy = activate(base, legacyPreset);
    expect(promptText(assemble(withLegacy))).toContain("LEGACY 主提示词");

    const withComposition = activate(withLegacy, compositionPreset);
    expect(withComposition.promptConfig.usePromptComposition).toBe(true);
    const composedText = promptText(assemble(withComposition));
    expect(composedText).toContain("COMPOSED 编排区块");
    expect(composedText).not.toContain("LEGACY 主提示词");

    const backToLegacy = activate(withComposition, legacyPreset);
    expect(backToLegacy.promptConfig.usePromptComposition).toBe(false);
    const legacyText = promptText(assemble(backToLegacy));
    expect(legacyText).toContain("LEGACY 主提示词");
    expect(legacyText).not.toContain("COMPOSED 编排区块");
  });
});
