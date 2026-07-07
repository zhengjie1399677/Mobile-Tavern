import { describe, it, expect } from "vitest";
import { PromptService } from "../../src/kernel/services/PromptService";
import { CharacterCard, ChatSession, UserSettings } from "../../src/types";

describe("PromptService prompt compilation", () => {
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
      },
    } as any;

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
      },
    } as any;

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
});
