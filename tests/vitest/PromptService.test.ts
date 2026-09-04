import { describe, it, expect, vi } from "vitest";
import { PromptService } from "../../src/application/services/PromptService";
import { CharacterCard, ChatSession, UserSettings } from "../../src/types";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import { createKernel } from "../../src/kernel/Kernel";
import { CompatibilityRuntimeService } from "../../src/application/services/CompatibilityRuntimeService";

describe("PromptService prompt compilation", () => {
  it("仅配置 global/preset Regex 时也通过 Compatibility Runtime 进入 Prompt Transform", async () => {
    const kernel = createKernel();
    const compatibilityRuntime = new CompatibilityRuntimeService();
    await kernel.registerService(compatibilityRuntime.name, compatibilityRuntime);
    const transform = vi.fn(({ text, globalRegexScripts, presetRegexScripts }) => {
      expect(globalRegexScripts).toHaveLength(1);
      expect(presetRegexScripts).toHaveLength(1);
      return text.replace("global-only", "transformed");
    });
    compatibilityRuntime.registerTransform({
      id: "compat.test.prompt-transform",
      version: "1.0.0",
      transform,
    });

    const promptService = new PromptService();
    promptService.init(kernel);
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.promptConfig.roleplayMode = false;
    settings.globalRegexScripts = [{
      id: "global",
      scriptName: "global",
      findRegex: "global-only",
      replaceString: "x",
      disabled: false,
      placement: [1, 2],
    }];
    settings.presetRegexScripts = [{
      id: "preset",
      scriptName: "preset",
      findRegex: "preset-only",
      replaceString: "x",
      disabled: false,
      placement: [1, 2],
    }];
    const character = {
      id: "global-regex-character",
      name: "角色",
      description: "",
      personality: "",
      scenario: "",
      first_mes: "",
      mes_example: "",
      extensions: {},
    } as CharacterCard;
    const chat = {
      id: "global-regex-chat",
      characterId: character.id,
      title: "Regex",
      createdAt: 1,
      messages: [{ id: "m1", sender: "user", content: "global-only", timestamp: 1 }],
      summaries: [],
    } as ChatSession;

    const result = promptService.assemblePrompt({
      character,
      chat,
      userInput: "继续",
      settings,
    });

    expect(transform).toHaveBeenCalled();
    expect(result.messages.some((message) => message.content.includes("transformed"))).toBe(true);
    await compatibilityRuntime.destroy();
    promptService.destroy();
  });

  it("direct-api 模式只发送真实对话，不注入任何系统内容、名字或请求整形", () => {
    const promptService = new PromptService();
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.userInfo = "不应发送的用户设定";
    settings.api.sendNames = true;
    settings.enableReplySuggestions = true;
    settings.promptConfig.usePromptComposition = true;
    settings.promptConfig.requestShaping = {
      enabled: true,
      roleWrappers: { user: { prefix: "[多余]" } },
      assistantPrefill: "多余续写",
    };
    const character = {
      id: "base-agent-builtin",
      agentMode: "direct-api",
      name: "通用 AI 助手",
      description: "不应发送的角色设定",
      personality: "不应发送",
      scenario: "不应发送",
      first_mes: "",
      mes_example: "不应发送",
      system_prompt: "不应发送",
      post_history_instructions: "不应发送",
      extensions: {},
    } as CharacterCard;
    const chat = {
      id: "direct-chat",
      characterId: character.id,
      title: "直连",
      createdAt: 1,
      summaries: [],
      messages: [
        { id: "u1", sender: "user", content: "原样  保留", timestamp: 1 },
        { id: "a1", sender: "assistant", content: "原样回复", timestamp: 2 },
        { id: "s1", sender: "system", content: "内部系统消息不得发送", timestamp: 3 },
      ],
    } as ChatSession;

    const result = promptService.assemblePrompt({
      character,
      chat,
      userInput: "原样  保留",
      settings,
      globalLorebook: [{ id: "lore", keys: [], content: "不应发送", constant: true, enabled: true }],
      recalledMemories: [{
        memoryId: "memory",
        messageId: "message",
        turnIndex: 1,
        role: "assistant",
        content: "不应发送",
        hitCount: 1,
        hitTags: ["test"],
        score: 1,
        kind: "event",
        reason: "tag",
        sourceMessageIds: ["message"],
      }],
    });

    expect(result.systemInstruction).toBe("");
    expect(result.dynamicInstruction).toBe("");
    expect(result.messages).toEqual([
      { role: "user", content: "原样  保留" },
      { role: "assistant", content: "原样回复" },
    ]);
    expect(result.requestShaping).toMatchObject({ enabled: false, finalMessageCount: 2 });
  });
  it("预先中止时不再进入提示词编排", () => {
    const promptService = new PromptService();
    const controller = new AbortController();
    controller.abort();

    expect(() => promptService.assemblePrompt({
      character: { name: "中止角色" } as CharacterCard,
      chat: { messages: [] } as unknown as ChatSession,
      userInput: "不会处理",
      settings: structuredClone(DEFAULT_SETTINGS),
      signal: controller.signal,
    })).toThrowError(expect.objectContaining({ name: "AbortError" }));
  });

  it("preserves multiple system messages and user-controlled order in free composition mode", () => {
    const promptService = new PromptService();
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.promptConfig.usePromptComposition = true;
    settings.promptConfig.composition = {
      id: "runtime-test",
      name: "运行路径测试",
      version: 1,
      blocks: [
        {
          id: "system-a",
          name: "系统一",
          enabled: true,
          role: "system",
          source: { type: "template" },
          template: "系统一：{{character.description}}",
          order: 100,
          placement: { type: "ordered" },
        },
        {
          id: "history",
          name: "历史",
          enabled: true,
          role: "system",
          source: { type: "chat_history" },
          template: "",
          order: 200,
          placement: { type: "ordered" },
        },
        {
          id: "system-b",
          name: "系统二",
          enabled: true,
          role: "system",
          source: { type: "template" },
          template: "系统二",
          order: 300,
          placement: { type: "ordered" },
        },
      ],
    };
    const character = {
      id: "free-char",
      name: "自由角色",
      description: "角色资料",
      personality: "",
      scenario: "",
      first_mes: "",
      mes_example: "",
      creator: "",
      creator_notes: "",
      tags: [],
      character_version: "1",
      extensions: {},
      lorebookEntries: [],
    } as CharacterCard;
    const chat = {
      id: "free-chat",
      characterId: character.id,
      title: "自由编排测试",
      createdAt: Date.now(),
      summaries: [],
      messages: [
        { id: "user-1", sender: "user", content: "已进入历史的输入", timestamp: 1 },
        { id: "assistant-1", sender: "assistant", content: "历史回复", timestamp: 2 },
      ],
    } as ChatSession;

    const result = promptService.assemblePrompt({
      character,
      chat,
      userInput: "不会被隐式追加",
      settings,
    });

    expect(result.messages).toEqual([
      { role: "system", content: "系统一：角色资料" },
      { role: "user", content: "已进入历史的输入" },
      { role: "assistant", content: "历史回复" },
      { role: "system", content: "系统二" },
    ]);

    settings.promptConfig.composition = undefined;
    const missingCompositionResult = promptService.assemblePrompt({
      character,
      chat,
      userInput: "仍然不回退旧路径",
      settings,
    });
    expect(missingCompositionResult.messages).toEqual([]);
  });

  it("applies the configured Prompt token budget before returning the final send payload", () => {
    const promptService = new PromptService();
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.promptConfig.usePromptComposition = true;
    settings.promptConfig.composition = {
      id: "runtime-budget",
      name: "发送前预算",
      version: 1,
      tokenBudget: { enabled: true, mode: "custom", maxTokens: 2 },
      blocks: [
        {
          id: "keep",
          name: "保留",
          enabled: true,
          role: "system",
          source: { type: "template" },
          template: "KEEP",
          order: 100,
          placement: { type: "ordered" },
          tokenPolicy: { priority: 100, overflow: "keep" },
        },
        {
          id: "drop",
          name: "可裁剪",
          enabled: true,
          role: "system",
          source: { type: "template" },
          template: "12345678",
          order: 200,
          placement: { type: "ordered" },
          tokenPolicy: { priority: 1, overflow: "drop" },
        },
      ],
    };
    const character = {
      id: "budget-char",
      name: "Budget",
      description: "",
      personality: "",
      scenario: "",
      first_mes: "",
      mes_example: "",
      creator: "",
      creator_notes: "",
      tags: [],
      character_version: "1",
      extensions: {},
      lorebookEntries: [],
    } as CharacterCard;
    const chat = {
      id: "budget-chat",
      characterId: character.id,
      title: "Budget",
      createdAt: Date.now(),
      summaries: [],
      messages: [],
    } as ChatSession;

    const result = promptService.assemblePrompt({ character, chat, userInput: "", settings });

    expect(result.messages).toEqual([{ role: "system", content: "KEEP" }]);
    expect(result.budget).toMatchObject({ limit: 2, used: 1, droppedBlockIds: ["drop"] });
  });

  it("把请求整形开销计入最终预算并重新执行可裁剪策略", () => {
    const promptService = new PromptService();
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.promptConfig.usePromptComposition = true;
    settings.promptConfig.requestShaping = {
      enabled: true,
      roleWrappers: { system: { prefix: "1234" } },
    };
    settings.promptConfig.composition = {
      id: "runtime-shaped-budget",
      name: "整形后预算",
      version: 1,
      tokenBudget: { enabled: true, mode: "custom", maxTokens: 2 },
      blocks: [
        {
          id: "keep",
          name: "保留",
          enabled: true,
          role: "system",
          source: { type: "template" },
          template: "A",
          order: 1,
          placement: { type: "ordered" },
          tokenPolicy: { priority: 100, overflow: "keep" },
        },
        {
          id: "drop",
          name: "可裁剪",
          enabled: true,
          role: "system",
          source: { type: "template" },
          template: "B",
          order: 2,
          placement: { type: "ordered" },
          tokenPolicy: { priority: 1, overflow: "drop" },
        },
      ],
    };
    const character = {
      id: "shaped-budget-char",
      name: "Budget",
      description: "",
      personality: "",
      scenario: "",
      first_mes: "",
      mes_example: "",
      extensions: {},
      lorebookEntries: [],
    } as CharacterCard;
    const chat = {
      id: "shaped-budget-chat",
      characterId: character.id,
      title: "Budget",
      createdAt: 1,
      summaries: [],
      messages: [],
    } as ChatSession;

    const result = promptService.assemblePrompt({ character, chat, userInput: "", settings });

    expect(result.messages).toEqual([{ role: "system", content: "1234A" }]);
    expect(result.budget).toEqual({ limit: 2, used: 2, originalUsed: 4, droppedBlockIds: ["drop"] });
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
      code: "FINAL_TOKEN_BUDGET_EXCEEDED",
    }));
  });

  it("should compile dialogue_examples into system instruction in roleplayMode: true", () => {
    const promptService = new PromptService();
    const character: CharacterCard = {
      id: "test-char",
      name: "Test Character",
      avatar: "",
      description: "Character description.",
      personality: "Traits.",
      scenario: "Setting.",
      first_mes: "Hello!",
      mes_example: "User: Hi!\nChar: *smiles* Hello!",
      creator: "",
      creator_notes: "",
      tags: [],
      character_version: "1.0",
      extensions: {},
      lorebookEntries: [],
    };

    const chat: ChatSession = {
      id: "test-chat",
      characterId: "test-char",
      title: "Test Chat",
      messages: [],
      summaries: [],
      createdAt: Date.now(),
    };

    const settings: UserSettings = {
      userName: "User",
      userInfo: "User info.",
      userAvatar: "",
      userPersonas: [],
      activePersonaId: "",
      api: {
        type: "openai-compat",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "fake",
        modelName: "gpt-4o",
        chatPath: "/chat/completions",
        modelsPath: "/models",
        bypassProxy: false,
        sendNames: false,
        disableReasoning: false,
        forceBasicParams: false,
      },
      preset: {
        id: "preset_mobile_tavern_basic",
        name: "基本预设",
        temperature: 0.85,
        topP: 1.0,
        topK: 200,
        repetitionPenalty: 1.03,
        frequencyPenalty: 0.0,
        presencePenalty: 0.0,
        minP: 0.0,
        maxTokens: 1500,
      },
      memory: {
        recentTurns: 6,
        summaryTriggerTurns: 0,
        summaryLength: 120,
        summarySystemPrompt: "",
        timeTagTemplate: "",
        enableAutoSummary: true,
        enableRecall: true,
        recallTopK: 3,
      },
      promptConfig: {
        roleplayMode: true,
        useJailbreak: true,
        mainPrompt: "Act as {{char}}.",
        jailbreakPrompt: "Stay in character.",
        instructTemplate: "default",
        storyString: "",
        systemPrefix: "",
        systemSuffix: "",
        userPrefix: "",
        userSuffix: "",
        assistantPrefix: "",
        assistantSuffix: "",
      },
    };

    const result = promptService.assemblePrompt({
      character,
      chat,
      userInput: "How are you?",
      settings,
    });

    expect(result.systemInstruction).toContain("<dialogue_examples>");
    expect(result.systemInstruction).toContain("User: Hi!");
    expect(result.systemInstruction).toContain("Char: *smiles* Hello!");
  });

  it("should compile dialogue_examples into system instruction in roleplayMode: false", () => {
    const promptService = new PromptService();
    const character: CharacterCard = {
      id: "test-char",
      name: "Test Character",
      avatar: "",
      description: "Character description.",
      personality: "Traits.",
      scenario: "Setting.",
      first_mes: "Hello!",
      mes_example: "User: Hi!\nChar: *smiles* Hello!",
      creator: "",
      creator_notes: "",
      tags: [],
      character_version: "1.0",
      extensions: {},
      lorebookEntries: [],
    };

    const chat: ChatSession = {
      id: "test-chat",
      characterId: "test-char",
      title: "Test Chat",
      messages: [],
      summaries: [],
      createdAt: Date.now(),
    };

    const settings: UserSettings = {
      userName: "User",
      userInfo: "User info.",
      userAvatar: "",
      userPersonas: [],
      activePersonaId: "",
      api: {
        type: "openai-compat",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "fake",
        modelName: "gpt-4o",
        chatPath: "/chat/completions",
        modelsPath: "/models",
        bypassProxy: false,
        sendNames: false,
        disableReasoning: false,
        forceBasicParams: false,
      },
      preset: {
        id: "preset_mobile_tavern_basic",
        name: "基本预设",
        temperature: 0.85,
        topP: 1.0,
        topK: 200,
        repetitionPenalty: 1.03,
        frequencyPenalty: 0.0,
        presencePenalty: 0.0,
        minP: 0.0,
        maxTokens: 1500,
      },
      memory: {
        recentTurns: 6,
        summaryTriggerTurns: 0,
        summaryLength: 120,
        summarySystemPrompt: "",
        timeTagTemplate: "",
        enableAutoSummary: true,
        enableRecall: true,
        recallTopK: 3,
      },
      promptConfig: {
        roleplayMode: false, // Non-roleplay mode!
        useJailbreak: true,
        mainPrompt: "Act as {{char}}.",
        jailbreakPrompt: "Stay in character.",
        instructTemplate: "default",
        storyString: "",
        systemPrefix: "",
        systemSuffix: "",
        userPrefix: "",
        userSuffix: "",
        assistantPrefix: "",
        assistantSuffix: "",
      },
    };

    const result = promptService.assemblePrompt({
      character,
      chat,
      userInput: "How are you?",
      settings,
    });

    expect(result.systemInstruction).toContain("=== Dialogue Examples ===");
    expect(result.systemInstruction).toContain("User: Hi!");
    expect(result.systemInstruction).toContain("Char: *smiles* Hello!");
  });

  it("useMainPrompt 为 false 时，assemblePrompt 不拼入 mainPrompt", () => {
    const promptService = new PromptService();
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.promptConfig.mainPrompt = "THIS_IS_MAIN_PROMPT_SECRET_CONTENT";
    settings.promptConfig.useMainPrompt = false;

    const character = {
      id: "test-char",
      name: "测试角色",
      description: "角色描述",
      personality: "",
      scenario: "",
      first_mes: "",
      mes_example: "",
      extensions: {},
    } as CharacterCard;
    const chat = {
      id: "test-chat",
      characterId: character.id,
      title: "Chat",
      createdAt: 1,
      messages: [{ id: "m1", sender: "user", content: "hello", timestamp: 1 }],
      summaries: [],
    } as ChatSession;

    const result = promptService.assemblePrompt({
      character,
      chat,
      userInput: "hello",
      settings,
    });

    expect(result.systemInstruction).not.toContain("THIS_IS_MAIN_PROMPT_SECRET_CONTENT");
    expect(result.messages.some((m) => m.content.includes("THIS_IS_MAIN_PROMPT_SECRET_CONTENT"))).toBe(false);
  });
});
