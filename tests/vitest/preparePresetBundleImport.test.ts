import { describe, expect, it } from "vitest";
import {
  formatSillyTavernCompatibilityAnalysis,
  preparePresetBundleImport,
} from "../../src/application/useCases/preparePresetBundleImport";
import { DEFAULT_PROMPT_CONFIG } from "../../src/hooks/settings/defaults";
import { SILLY_TAVERN_PRESET_ARCHETYPES } from "../fixtures/sillyTavernPresetArchetypes";

const createId = (kind: "preset" | "regex" | "bundle") => `${kind}-fixture-id`;

describe("preparePresetBundleImport", () => {
  it("拒绝非对象根结构", () => {
    expect(() => preparePresetBundleImport({
      input: [],
      fallbackName: "invalid",
      currentPromptConfig: DEFAULT_PROMPT_CONFIG,
    })).toThrow("PRESET_INVALID_ROOT");
  });

  it("普通采样预设使用文件名兜底且不覆盖现有 Prompt", () => {
    const result = preparePresetBundleImport({
      input: { temp: 0.66, topP: 0.92, maxTokens: 4096 },
      fallbackName: "文件名预设",
      currentPromptConfig: DEFAULT_PROMPT_CONFIG,
      createId,
    });

    expect(result.name).toBe("文件名预设");
    expect(result.bundle).toMatchObject({
      id: "bundle-fixture-id",
      preset: {
        id: "preset-fixture-id",
        name: "文件名预设",
        temperature: 0.66,
        topP: 0.92,
        maxTokens: 4096,
      },
      promptConfig: {
        mainPrompt: DEFAULT_PROMPT_CONFIG.mainPrompt,
        jailbreakPrompt: DEFAULT_PROMPT_CONFIG.jailbreakPrompt,
      },
      presetRegexScripts: [],
    });
    expect(result.composition).toBeUndefined();
    expect(result.compatibilityAnalysis).toBeUndefined();
    expect(result.bundle.promptConfig).not.toHaveProperty("composition");
    expect(result.bundle.promptConfig).not.toHaveProperty("usePromptComposition");
  });

  it("统一解析 100001 顺序、扩展 Prompt 字段、请求整形和正则", () => {
    const result = preparePresetBundleImport({
      input: {
        name: "完整导入",
        openai_max_tokens: 32000,
        assistant_prefill: "继续：",
        squash_system_messages: true,
        custom_stop_strings: ["User:", "<END>"],
        prompts: [
          { identifier: "main", name: "Main", role: "system", content: "MAIN", injection_order: 100 },
          { identifier: "chatHistory", name: "History", role: "user", marker: true },
          { identifier: "optional", name: "Optional", role: "user", content: "OFF" },
        ],
        prompt_order: [
          { character_id: 100000, order: [{ identifier: "main", enabled: false }] },
          { character_id: 100001, order: [
            { identifier: "chatHistory", enabled: true },
            { identifier: "main", enabled: true },
          ] },
        ],
        extensions: { regex_scripts: [{
          scriptName: "Depth regex",
          findRegex: "/x/g",
          replaceString: "y",
          minDepth: 1,
          maxDepth: 9,
          trimStrings: ["trim-me"],
        }] },
      },
      fallbackName: "fallback",
      currentPromptConfig: DEFAULT_PROMPT_CONFIG,
      createId,
    });

    expect(result.bundle.preset.maxTokens).toBe(32000);
    expect(result.bundle.promptConfig.customPrompts?.map((prompt) => prompt.identifier)).toEqual([
      "chatHistory", "main", "optional",
    ]);
    expect(result.bundle.promptConfig.customPrompts?.map((prompt) => prompt.enabled)).toEqual([
      true, true, false,
    ]);
    expect(result.bundle.promptConfig.customPrompts?.[0].marker).toBe(true);
    expect(result.bundle.promptConfig.customPrompts?.[1].injection_order).toBe(100);
    expect(result.bundle.promptConfig.requestShaping).toEqual({
      enabled: true,
      mergeAdjacentMessages: false,
      squashSystemMessages: true,
      assistantPrefill: "继续：",
      stopSequences: ["User:", "<END>"],
    });
    expect(result.bundle.presetRegexScripts?.[0]).toMatchObject({
      id: "regex-fixture-id",
      minDepth: 1,
      maxDepth: 9,
      trimStrings: ["trim-me"],
    });
    expect(result.composition?.blocks.map(
      (block) => block.compatibility?.originalIdentifier,
    )).toEqual(["chatHistory", "main", "optional"]);
    expect(result.compatibilityAnalysis?.level).toBe("full");
  });

  it.each(SILLY_TAVERN_PRESET_ARCHETYPES)(
    "$id：真实导入用例与兼容矩阵保持同一分级",
    ({ preset, expected }) => {
      const result = preparePresetBundleImport({
        input: preset,
        fallbackName: "fixture",
        currentPromptConfig: DEFAULT_PROMPT_CONFIG,
        createId,
      });

      expect(result.compatibilityAnalysis?.level).toBe(expected.level);
      expect(result.bundle.presetRegexScripts).toHaveLength(expected.regexCount);
      expect(result.composition?.blocks).toHaveLength(expected.promptCount);
    },
  );

  it("兼容顶层对象映射正则并明确报告无效项目", () => {
    const result = preparePresetBundleImport({
      input: {
        regex_scripts: {
          valid: { scriptName: "有效", findRegex: "/ok/g", replaceString: "yes" },
          invalid: { scriptName: "缺少表达式" },
          primitive: "bad",
        },
      },
      fallbackName: "对象正则",
      currentPromptConfig: DEFAULT_PROMPT_CONFIG,
      createId,
    });

    expect(result.bundle.presetRegexScripts).toHaveLength(1);
    expect(result.bundle.presetRegexScripts?.[0]).toMatchObject({
      scriptName: "有效",
      findRegex: "/ok/g",
    });
    expect(result.report.warnings).toEqual([
      expect.objectContaining({ code: "SKIPPED_INVALID_REGEX_SCRIPT" }),
      expect.objectContaining({ code: "SKIPPED_INVALID_REGEX_SCRIPT" }),
    ]);
  });

  it("将社区预设常用的 model role 统一映射为 assistant", () => {
    const result = preparePresetBundleImport({
      input: {
        prompts: [{ identifier: "reply", role: "model", content: "REPLY" }],
        prompt_order: [{
          character_id: 100001,
          order: [{ identifier: "reply", enabled: true }],
        }],
      },
      fallbackName: "model role",
      currentPromptConfig: DEFAULT_PROMPT_CONFIG,
      createId,
    });

    expect(result.bundle.promptConfig.customPrompts?.[0].role).toBe("assistant");
    expect(result.composition?.blocks[0].role).toBe("assistant");
    expect(result.report.warnings).not.toContainEqual(
      expect.objectContaining({ code: "INVALID_ROLE_FALLBACK" }),
    );
  });

  it("兼容摘要明确展示脚本隔离和数据库语义降级", () => {
    const frontend = prepareFixture("frontend-heavy");
    const database = prepareFixture("database-dependent");

    expect(formatSillyTavernCompatibilityAnalysis(frontend)).toContain("外部网络脚本：1 个（不执行）");
    expect(formatSillyTavernCompatibilityAnalysis(database)).toContain(
      "数据库附着 Prompt 不执行附着语义",
    );
  });
});

function prepareFixture(id: string) {
  const fixture = SILLY_TAVERN_PRESET_ARCHETYPES.find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`缺少测试形状：${id}`);
  const result = preparePresetBundleImport({
    input: fixture.preset,
    fallbackName: "fixture",
    currentPromptConfig: DEFAULT_PROMPT_CONFIG,
    createId,
  });
  if (!result.compatibilityAnalysis) throw new Error(`缺少兼容分析：${id}`);
  return result.compatibilityAnalysis;
}
