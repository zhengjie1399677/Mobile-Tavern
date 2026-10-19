import { describe, expect, it } from "vitest";
import { preparePresetBundleImport } from "../../src/application/useCases/preparePresetBundleImport";
import { preparePresetBundleExport } from "../../src/application/useCases/preparePresetBundleExport";
import { sillyTavernPromptPresetCodec } from "../../src/infrastructure/compat/sillytavern/promptPresetAdapter";
import {
  selectActivePromptBlocks,
  selectInChatPromptBlocks,
} from "../../src/domain/prompts/promptSourceBlocks";
import {
  buildPromptRequestMessages,
  shapePromptRequest,
} from "../../src/application/services/prompt/PromptRequestShaper";
import { DEFAULT_PROMPT_CONFIG, DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import { PromptService } from "../../src/application/services/PromptService";
import type { CharacterCard, ChatSession, UserSettings } from "../../src/types";

const ST_PRESET = {
  name: "参数兼容样本",
  temperature: 1.1,
  top_p: 0.9,
  top_k: 64,
  top_a: 1,
  min_p: 0.02,
  repetition_penalty: 1.05,
  frequency_penalty: 0.1,
  presence_penalty: 0.2,
  seed: 12345,
  max_tokens: 8000,
  names_behavior: 2,
  scenario_format: "[Circumstances: {{scenario}}]",
  personality_format: "[{{char}}'s personality: {{personality}}]",
  wi_format: "<world>{0}</world>",
  custom_prompt_post_processing: "semi",
  assistant_prefill: "继续",
  prompts: [
    {
      identifier: "main",
      name: "Main Prompt",
      role: "system",
      content: "main prompt",
      system_prompt: true,
    },
    {
      identifier: "inchat",
      name: "文风",
      role: "system",
      content: "in-chat style",
      injection_position: 1,
      injection_depth: 2,
      injection_order: 50,
    },
    {
      identifier: "regenonly",
      name: "仅重生成",
      role: "system",
      content: "regenerate only",
      injection_position: 1,
      injection_depth: 1,
      injection_order: 60,
      injection_trigger: ["regenerate"],
    },
    {
      identifier: "userblock",
      name: "User Module",
      role: "user",
      content: "user module",
      system_prompt: false,
    },
  ],
  prompt_order: [{
    character_id: 100001,
    order: [
      { identifier: "main", enabled: true },
      { identifier: "inchat", enabled: true },
      { identifier: "regenonly", enabled: true },
      { identifier: "userblock", enabled: true },
    ],
  }],
};

function importSample() {
  return preparePresetBundleImport({
    input: ST_PRESET,
    fallbackName: "sample",
    currentPromptConfig: DEFAULT_PROMPT_CONFIG,
    neutralPromptConfig: DEFAULT_PROMPT_CONFIG,
    compatibilityCodec: sillyTavernPromptPresetCodec,
  });
}

describe("SillyTavern 预设参数补全", () => {
  it("导入采样参数 top_a / seed，并在导出时原样写回", () => {
    const { bundle } = importSample();
    expect(bundle.sampler.topA).toBe(1);
    expect(bundle.sampler.seed).toBe(12345);
    expect(bundle.sampler.minP).toBe(0.02);
    expect(bundle.sampler.frequencyPenalty).toBe(0.1);
    expect(bundle.sampler.presencePenalty).toBe(0.2);

    const exported = preparePresetBundleExport({
      preset: {
        id: "preset_export",
        name: "导出",
        temperature: bundle.sampler.temperature ?? 0,
        topP: bundle.sampler.topP ?? 1,
        topK: bundle.sampler.topK ?? 0,
        repetitionPenalty: bundle.sampler.repetitionPenalty ?? 1,
        frequencyPenalty: bundle.sampler.frequencyPenalty,
        presencePenalty: bundle.sampler.presencePenalty,
        minP: bundle.sampler.minP,
        topA: bundle.sampler.topA,
        seed: bundle.sampler.seed,
        maxTokens: bundle.sampler.maxTokens ?? 8000,
      },
      promptConfig: bundle.promptConfig,
      compatibilityCodec: sillyTavernPromptPresetCodec,
    });

    expect(exported.data.top_a).toBe(1);
    expect(exported.data.seed).toBe(12345);
    expect(exported.data.names_behavior).toBe(2);
    expect(exported.data.scenario_format).toBe("[Circumstances: {{scenario}}]");
    expect(exported.data.personality_format).toBe("[{{char}}'s personality: {{personality}}]");
    expect(exported.data.wi_format).toBe("<world>{0}</world>");
    expect(exported.data.custom_prompt_post_processing).toBe("semi");
  });

  it("导入 names_behavior、场景/性格/世界书模板与请求后处理模式", () => {
    const { bundle } = importSample();
    expect(bundle.promptConfig.namesBehavior).toBe(2);
    expect(bundle.promptConfig.scenarioFormat).toBe("[Circumstances: {{scenario}}]");
    expect(bundle.promptConfig.personalityFormat).toBe("[{{char}}'s personality: {{personality}}]");
    expect(bundle.promptConfig.worldInfoFormat).toBe("<world>{0}</world>");
    expect(bundle.promptConfig.requestShaping).toMatchObject({
      enabled: true,
      mergeAdjacentMessages: true,
      assistantPrefill: "继续",
      customPromptPostProcessing: "semi",
    });
  });

  it("绝对位置提示词不进入核心规则，按 depth 单独选出", () => {
    const { bundle } = importSample();
    const active = selectActivePromptBlocks(bundle.promptConfig.customPrompts ?? [], bundle.promptConfig);
    expect(active.map((block) => block.identifier)).not.toContain("inchat");
    expect(active.map((block) => block.identifier)).not.toContain("regenonly");
    expect(active.map((block) => block.identifier)).toContain("userblock");

    const normal = selectInChatPromptBlocks(bundle.promptConfig.customPrompts ?? [], "normal");
    expect(normal.map((block) => block.identifier)).toEqual(["inchat"]);
    expect(normal[0]).toMatchObject({ injection_depth: 2, injection_order: 50 });

    const regenerate = selectInChatPromptBlocks(bundle.promptConfig.customPrompts ?? [], "regenerate");
    expect(regenerate.map((block) => block.identifier)).toEqual(["regenonly", "inchat"]);
  });

  it("names_behavior 2 把名字写进内容，1 才通过 name 字段携带", () => {
    const history = [{ role: "assistant" as const, name: "Alice", content: "hello" }];

    const contentPrefix = buildPromptRequestMessages("sys", history, false, 2);
    expect(contentPrefix[1]).toMatchObject({ role: "assistant", name: undefined, content: "Alice: hello" });

    const nameField = buildPromptRequestMessages("sys", history, false, 1);
    expect(nameField[1]).toMatchObject({ role: "assistant", name: "Alice", content: "hello" });

    const noNames = buildPromptRequestMessages("sys", history, false, -1);
    expect(noNames[1].name).toBeUndefined();
    expect(noNames[1].content).toBe("hello");
  });

  it("相对位置的 user/assistant 模块进入消息历史，绝对位置模块按 depth 注入", () => {
    const character: CharacterCard = {
      id: "char_role",
      name: "Alice",
      description: "desc",
      personality: "kind",
      scenario: "tavern",
      first_mes: "hello",
      mes_example: "example",
      lorebookEntries: [],
    };
    const chat: ChatSession = {
      id: "session_role",
      characterId: character.id,
      title: "role",
      createdAt: 0,
      messages: [
        { id: "m1", sender: "assistant", content: "greeting", timestamp: 0 },
        { id: "m2", sender: "user", content: "hello", timestamp: 1 },
      ],
      summaries: [],
    };
    const settings: UserSettings = {
      ...DEFAULT_SETTINGS,
      promptConfig: {
        ...DEFAULT_PROMPT_CONFIG,
        roleplayMode: true,
        customPrompts: [
          { id: "role_user", role: "user", name: "用户模块", content: "USER_MODULE", enabled: true },
          { id: "role_assistant", role: "assistant", name: "助手模块", content: "ASSISTANT_MODULE", enabled: true },
          {
            id: "role_in_chat",
            role: "system",
            name: "深度模块",
            content: "IN_CHAT_MODULE",
            enabled: true,
            injection_position: 1,
            injection_depth: 0,
            injection_order: 100,
          },
        ],
        requestShaping: { enabled: false },
      },
    };

    const result = new PromptService().assemblePrompt({
      character,
      chat,
      userInput: "hello",
      settings,
      globalLorebook: [],
      generationType: "normal",
    });

    expect(result.messages[0].role).toBe("system");
    expect(result.messages[1]).toMatchObject({ role: "user", content: "USER_MODULE" });
    expect(result.messages[2]).toMatchObject({ role: "assistant", content: "ASSISTANT_MODULE" });
    // depth 0 的绝对注入位于聊天历史末尾。
    expect(result.messages[result.messages.length - 1]).toMatchObject({
      role: "system",
      content: "IN_CHAT_MODULE",
    });
    expect(result.messages.filter((message) => message.content === "IN_CHAT_MODULE")).toHaveLength(1);
  });

  it("绝对注入条目能读到前面相对条目写入的变量（同一份顺序求值作用域）", () => {
    const character: CharacterCard = {
      id: "char_macro_order",
      name: "Alice",
      description: "desc",
      personality: "kind",
      scenario: "tavern",
      first_mes: "hello",
      mes_example: "",
      lorebookEntries: [],
    };
    const chat: ChatSession = {
      id: "session_macro_order",
      characterId: character.id,
      title: "macro",
      createdAt: 0,
      messages: [{ id: "m1", sender: "user", content: "hello", timestamp: 0 }],
      summaries: [],
    };
    const settings: UserSettings = {
      ...DEFAULT_SETTINGS,
      promptConfig: {
        ...DEFAULT_PROMPT_CONFIG,
        roleplayMode: true,
        customPrompts: [
          {
            id: "style_writer",
            role: "system",
            name: "写入文风",
            content: "{{setvar::base_writing::冷峻克制}}",
            enabled: true,
            order: 10,
          },
          {
            id: "style_reader",
            role: "system",
            name: "读取文风",
            content: "【当前文风】{{getvar::base_writing}}",
            enabled: true,
            order: 20,
          },
          {
            id: "style_depth",
            role: "system",
            name: "深度读取",
            content: "【深度文风】{{getvar::base_writing}}",
            enabled: true,
            injection_position: 1,
            injection_depth: 0,
            injection_order: 100,
          },
        ],
        requestShaping: { enabled: false },
      },
    };

    const result = new PromptService().assemblePrompt({
      character,
      chat,
      userInput: "continue",
      settings,
      globalLorebook: [],
    });

    expect(result.systemInstruction).toContain("【当前文风】冷峻克制");
    expect(result.messages[result.messages.length - 1]).toMatchObject({
      role: "system",
      content: "【深度文风】冷峻克制",
    });
  });

  it("custom_prompt_post_processing=semi 把中段 system 降级为 user", () => {
    const shaped = shapePromptRequest(
      [
        { role: "system", content: "sys" },
        { role: "user", content: "u1" },
        { role: "system", content: "in-chat" },
      ],
      { enabled: true, mergeAdjacentMessages: true, customPromptPostProcessing: "semi" },
    );
    expect(shaped.messages.map((message) => message.role)).toEqual(["system", "user", "user"]);
  });
});
