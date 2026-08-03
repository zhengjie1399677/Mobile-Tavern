import { describe, expect, it } from "vitest";
import {
  analyzeSillyTavernPreset,
  importSillyTavernPreset,
} from "../../src/infrastructure/compat/sillytavern";
import { SILLY_TAVERN_PRESET_ARCHETYPES } from "../fixtures/sillyTavernPresetArchetypes";

describe("SillyTavern 预设兼容分析", () => {
  it("将标准 Prompt 编排判定为完整兼容", () => {
    const analysis = analyzeSillyTavernPreset({
      prompts: [
        { identifier: "main", content: "MAIN" },
        { identifier: "chatHistory", marker: true },
      ],
      prompt_order: [{
        character_id: 100001,
        order: [
          { identifier: "main", enabled: true },
          { identifier: "chatHistory", enabled: true },
        ],
      }],
      extensions: { regex_scripts: [{ id: "r1" }] },
    });

    expect(analysis).toMatchObject({
      level: "full",
      promptCount: 2,
      orderedPromptCount: 2,
      enabledPromptCount: 2,
      markerCount: 1,
      regexCount: 1,
      tavernHelperScriptCount: 0,
    });
  });

  it("将启用的预设脚本和外部代码判定为核心兼容", () => {
    const analysis = analyzeSillyTavernPreset({
      prompts: [{ identifier: "main", content: "MAIN" }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
      extensions: {
        tavern_helper: {
          scripts: [{ enabled: true, content: "import 'https://cdn.example.test/runtime.js'" }],
        },
      },
    });

    expect(analysis.level).toBe("core");
    expect(analysis.remoteScriptCount).toBe(1);
    expect(analysis.diagnostics).toEqual(expect.arrayContaining([
      "PRESET_TAVERN_HELPER_SCRIPTS_NOT_EXECUTED",
      "REMOTE_SCRIPT_EXECUTION_BLOCKED",
    ]));
  });

  it("将数据库附着与 Agent Marker 判定为仅识别", () => {
    const analysis = analyzeSillyTavernPreset({
      prompts: [
        { identifier: "agentSystemPrompt", marker: true },
        { identifier: "database", content: "DB", attach_index: 1, attach_role: "user" },
      ],
      prompt_order: [{
        character_id: 100001,
        order: [
          { identifier: "agentSystemPrompt", enabled: true },
          { identifier: "database", enabled: true },
        ],
      }],
    });

    expect(analysis.level).toBe("recognize_only");
    expect(analysis.attachmentPromptCount).toBe(1);
    expect(analysis.diagnostics).toEqual(expect.arrayContaining([
      "UNSUPPORTED_ATTACHMENT_PROMPTS",
      "UNSUPPORTED_AGENT_MARKERS",
    ]));
  });

  it("统计对象映射和顶层正则集合", () => {
    const analysis = analyzeSillyTavernPreset({
      prompts: [{ identifier: "main", content: "MAIN" }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
      regex_scripts: {
        first: { scriptName: "A", findRegex: "/a/g" },
        second: { scriptName: "B", findRegex: "/b/g" },
      },
    });

    expect(analysis.level).toBe("full");
    expect(analysis.regexCount).toBe(2);
  });

  describe("社区主流形状回归矩阵", () => {
    it.each(SILLY_TAVERN_PRESET_ARCHETYPES)(
      "$id：$description",
      ({ preset, expected }) => {
        const analysis = analyzeSillyTavernPreset(preset);

        expect(analysis).toMatchObject({
          level: expected.level,
          promptCount: expected.promptCount,
          enabledPromptCount: expected.enabledPromptCount,
          regexCount: expected.regexCount,
        });
        expect(analysis.diagnostics).toEqual(expect.arrayContaining(expected.diagnostics));
        if (expected.diagnostics.length === 0) {
          expect(analysis.diagnostics).toEqual([]);
        }
      },
    );

    it.each(SILLY_TAVERN_PRESET_ARCHETYPES)(
      "$id：导入结果保留 Prompt 顺序，但不会把扩展脚本混入 Prompt",
      ({ preset, expected }) => {
        const result = importSillyTavernPreset(preset);
        const importedIdentifiers = result.composition.blocks.map(
          (block) => block.compatibility?.originalIdentifier,
        );
        const sourceOrder = (
          (preset.prompt_order as Array<{ order: Array<{ identifier: string }> }>)[0]?.order ?? []
        ).map((entry) => entry.identifier);

        expect(importedIdentifiers).toEqual(sourceOrder);
        expect(result.composition.blocks).toHaveLength(expected.promptCount);
        expect(result.composition.blocks.filter((block) => block.enabled)).toHaveLength(
          expected.importedEnabledPromptCount ?? expected.enabledPromptCount,
        );
        expect(result.composition.blocks.every(
          (block) => !block.template.includes("frontend-runtime.js"),
        )).toBe(true);
      },
    );

    it("通用轻量旧版和新版保持同一完整兼容等级", () => {
      const universalSamples = SILLY_TAVERN_PRESET_ARCHETYPES.filter(
        (fixture) => fixture.id.startsWith("universal-light-"),
      );

      expect(universalSamples).toHaveLength(2);
      expect(universalSamples.map((fixture) => analyzeSillyTavernPreset(fixture.preset).level))
        .toEqual(["full", "full"]);
    });
  });
});
