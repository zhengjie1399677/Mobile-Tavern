import { describe, expect, it } from "vitest";
import { analyzeSillyTavernPreset } from "../../src/infrastructure/compat/sillytavern";

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
});
