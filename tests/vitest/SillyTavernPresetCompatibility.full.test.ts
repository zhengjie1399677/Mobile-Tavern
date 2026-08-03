import { describe, expect, it } from "vitest";
import { shapePromptRequest } from "../../src/application/services/prompt/PromptRequestShaper";
import {
  applyPromptSceneProfile,
  compilePromptComposition,
  type PromptComposition,
  type PromptCompositionRuntimeData,
} from "../../src/domain/prompt-composition";
import {
  analyzeSillyTavernPreset,
  exportSillyTavernComposition,
  importSillyTavernPreset,
} from "../../src/infrastructure/compat/sillytavern";
import {
  SILLY_TAVERN_PRESET_ARCHETYPES,
  type SillyTavernPresetArchetype,
} from "../fixtures/sillyTavernPresetArchetypes";

const RUNTIME: PromptCompositionRuntimeData = {
  values: {
    "worldbook.before": "LORE BEFORE",
    "character.description": "CHARACTER",
  },
  history: [
    { role: "user", content: "U1" },
    { role: "assistant", content: "A1" },
  ],
};

describe("SillyTavern 预设完整兼容链路", () => {
  it("通用轻量新版从分析、导入到编译均保持完整语义", () => {
    const fixture = getFixture("universal-light-current");
    const analysis = analyzeSillyTavernPreset(fixture.preset);
    const imported = importSillyTavernPreset(fixture.preset);
    const compiled = compilePromptComposition(imported.composition, RUNTIME);

    expect(analysis).toMatchObject({
      level: "full",
      promptCount: 4,
      regexCount: 36,
      inChatPromptCount: 1,
    });
    expect(imported.report.errors).toEqual([]);
    expect(compiled.messages).toEqual([
      { role: "system", content: "MAIN" },
      { role: "system", content: "LORE BEFORE" },
      { role: "user", content: "U1" },
      { role: "system", content: "FORMAT" },
      { role: "assistant", content: "A1" },
    ]);
    expect(compiled.diagnostics.filter((item) => item.level === "error")).toEqual([]);
    expect(compiled.traces).toEqual(expect.arrayContaining([
      expect.objectContaining({ blockName: "格式尾注", messageIndexes: [3] }),
      expect.objectContaining({ sourceType: "chat_history", messageIndexes: [2, 4] }),
    ]));
  });

  it("数据库依赖型只保留可移植核心，不模拟数据库附着生命周期", () => {
    const fixture = getFixture("database-dependent");
    const analysis = analyzeSillyTavernPreset(fixture.preset);
    const imported = importSillyTavernPreset(fixture.preset);
    const compiled = compilePromptComposition(imported.composition, RUNTIME);
    const agentBlock = findImportedBlock(imported.composition, "agentSystemPrompt");
    const databaseBlock = findImportedBlock(imported.composition, "database-context");

    expect(analysis.level).toBe("recognize_only");
    expect(analysis.diagnostics).toEqual(expect.arrayContaining([
      "UNSUPPORTED_ATTACHMENT_PROMPTS",
      "UNSUPPORTED_AGENT_MARKERS",
    ]));
    expect(agentBlock.enabled).toBe(false);
    expect(databaseBlock.compatibility?.originalFields).toMatchObject({
      attach_index: 1,
      attach_role: "user",
      attach_side: "before",
    });
    expect(databaseBlock.placement).toEqual({ type: "ordered" });
    expect(compiled.messages).toEqual([
      { role: "system", content: "MAIN" },
      { role: "user", content: "DATABASE CONTEXT" },
      { role: "user", content: "U1" },
      { role: "assistant", content: "A1" },
    ]);
  });

  it("重前端型可运行 Prompt 核心，但外部脚本不会进入消息链", () => {
    const fixture = getFixture("frontend-heavy");
    const analysis = analyzeSillyTavernPreset(fixture.preset);
    const imported = importSillyTavernPreset(fixture.preset);
    const compiled = compilePromptComposition(imported.composition, RUNTIME);
    const serializedMessages = JSON.stringify(compiled.messages);

    expect(analysis).toMatchObject({
      level: "core",
      tavernHelperScriptCount: 1,
      enabledTavernHelperScriptCount: 1,
      remoteScriptCount: 1,
    });
    expect(analysis.diagnostics).toContain("REMOTE_SCRIPT_EXECUTION_BLOCKED");
    expect(compiled.messages.map((message) => message.content)).toEqual([
      "MAIN",
      "U1",
      "A1",
      "OUTPUT CONTRACT",
    ]);
    expect(serializedMessages).not.toContain("frontend-runtime.js");
    expect(serializedMessages).not.toContain("fixture.invalid");
  });

  it.each(SILLY_TAVERN_PRESET_ARCHETYPES)(
    "$id：导入、导出、再导入保持区块顺序、角色和安全分级",
    ({ preset, expected }) => {
      const first = importSillyTavernPreset(preset);
      const exported = exportSillyTavernComposition(first.composition);
      const second = importSillyTavernPreset(exported.data);

      expect(blockSignature(second.composition)).toEqual(blockSignature(first.composition));
      expect(exported.report.errors).toEqual([]);
      expect(analyzeSillyTavernPreset(exported.data).level).toBe(expected.level);
    },
  );

  it("编译结果继续经过类型化请求整形，且不修改导入编排", () => {
    const fixture = getFixture("universal-light-current");
    const imported = importSillyTavernPreset(fixture.preset);
    const before = structuredClone(imported.composition);
    const compiled = compilePromptComposition(imported.composition, RUNTIME);
    const shaped = shapePromptRequest(compiled.messages, {
      enabled: true,
      squashSystemMessages: true,
      mergeAdjacentMessages: true,
      roleWrappers: {
        system: { prefix: "<system>", suffix: "</system>" },
        assistant: { prefix: "<assistant>", suffix: "</assistant>" },
      },
      assistantPrefill: "PREFILL",
      stopSequences: ["</turn>", "</turn>", ""],
    });

    expect(shaped.messages).toEqual([
      {
        role: "system",
        content: [
          "<system>MAIN</system>",
          "<system>LORE BEFORE</system>",
          "<system>FORMAT</system>",
        ].join("\n\n"),
      },
      { role: "user", content: "U1" },
      { role: "assistant", content: "<assistant>A1</assistant>PREFILL" },
    ]);
    expect(shaped.stopSequences).toEqual(["</turn>"]);
    expect(shaped.report).toMatchObject({
      originalMessageCount: 5,
      finalMessageCount: 3,
      squashedSystemMessageCount: 2,
      assistantPrefillAdded: true,
    });
    expect(imported.composition).toEqual(before);
  });

  it("场景覆盖和 Token 预算可以叠加在导入编排之上且不破坏基础配置", () => {
    const fixture = getFixture("universal-light-current");
    const imported = importSillyTavernPreset(fixture.preset);
    const worldbookBlock = findImportedBlock(imported.composition, "worldInfoBefore");
    const formatBlock = findImportedBlock(imported.composition, "format-tail");
    const composition: PromptComposition = {
      ...imported.composition,
      blocks: imported.composition.blocks.map((block) => block.id === formatBlock.id
        ? { ...block, tokenPolicy: { priority: 10, overflow: "drop" } }
        : block),
      sceneProfiles: [{
        id: "minimal",
        name: "精简",
        blockStates: { [worldbookBlock.id]: false },
      }],
    };
    const scene = applyPromptSceneProfile(composition, "minimal");
    const compiled = compilePromptComposition(scene.composition, RUNTIME, {
      tokenBudget: 8,
      estimateTokens: (text) => text.length,
    });

    expect(scene.diagnostics).toEqual([]);
    expect(compiled.messages.map((message) => message.content)).toEqual(["MAIN", "U1", "A1"]);
    expect(compiled.budget).toMatchObject({
      limit: 8,
      used: 8,
      droppedBlockIds: [formatBlock.id],
    });
    expect(compiled.diagnostics).toContainEqual(expect.objectContaining({
      code: "TOKEN_BUDGET_DROPPED_BLOCK",
      blockId: formatBlock.id,
    }));
    expect(findImportedBlock(composition, "worldInfoBefore").enabled).toBe(true);
  });

  it("无效根结构与超大脚本载荷分别快速失败和降级识别", () => {
    expect(analyzeSillyTavernPreset({ name: "missing prompts" }).level).toBe("invalid");
    expect(() => importSillyTavernPreset(null)).toThrow("SILLYTAVERN_PRESET_INVALID_ROOT");

    const oversized = {
      prompts: [{ identifier: "main", content: "MAIN" }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
      extensions: {
        tavern_helper: {
          scripts: [{ enabled: true, content: "x".repeat(2 * 1024 * 1024 + 1) }],
        },
      },
    };
    const analysis = analyzeSillyTavernPreset(oversized);

    expect(analysis.level).toBe("recognize_only");
    expect(analysis.diagnostics).toContain("SCRIPT_PAYLOAD_TOO_LARGE");
  });
});

function getFixture(id: string): SillyTavernPresetArchetype {
  const fixture = SILLY_TAVERN_PRESET_ARCHETYPES.find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`缺少测试形状：${id}`);
  return fixture;
}

function findImportedBlock(composition: PromptComposition, identifier: string) {
  const block = composition.blocks.find(
    (candidate) => candidate.compatibility?.originalIdentifier === identifier,
  );
  if (!block) throw new Error(`缺少导入区块：${identifier}`);
  return block;
}

function blockSignature(composition: PromptComposition) {
  return composition.blocks.map((block) => ({
    identifier: block.compatibility?.originalIdentifier,
    role: block.role,
    enabled: block.enabled,
    source: block.source.type,
    placement: block.placement.type,
  }));
}
