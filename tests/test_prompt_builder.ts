import {
  replaceMacros,
  getTriggeredLorebookEntries,
  assemblePromptContext,
} from "../src/utils/promptBuilder";
import { CharacterCard, ChatSession, UserSettings, LorebookEntry, Message } from "../src/types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function testReplaceMacros() {
  console.log("-> Running replaceMacros tests...");

  const params = {
    char: "Alice",
    user: "Bob",
    description: "A helpful AI assistant that costs $10.",
    personality: "Cheerfully optimistic.",
    scenario: "In a cozy tavern with $20 cash.",
    userPersona: "A curious traveler.",
    mes_example: "Hello!",
  };

  // 1. Standard replacement
  const t1 = "Hello, {{user}}! I am {{char}}.";
  assert(replaceMacros(t1, params) === "Hello, Bob! I am Alice.", "Standard replacement");

  // 2. Case-insensitivity replacement
  const t2 = "Hello, {{USER}}! I am {{CHAR_NAME}}.";
  assert(replaceMacros(t2, params) === "Hello, Bob! I am Alice.", "Case-insensitivity replacement");

  // 3. String containing $ symbols (tests regex collapse protection)
  const t3 = "Your profile: {{description}} Scenario: {{scenario}}";
  const expectedT3 = "Your profile: A helpful AI assistant that costs $10. Scenario: In a cozy tavern with $20 cash.";
  assert(replaceMacros(t3, params) === expectedT3, "Regex collapse protection with $ symbols");

  // 4. Undefined keys are ignored
  const t4 = "Some {{unknown_macro}} here.";
  assert(replaceMacros(t4, params) === "Some {{unknown_macro}} here.", "Unknown macros ignored");

  console.log("✔ replaceMacros tests passed!");
}

function testLorebookTriggers() {
  console.log("-> Running getTriggeredLorebookEntries tests...");

  const baseEntries: LorebookEntry[] = [
    {
      id: "lore_constant",
      keys: ["always"],
      content: "Constant lore info",
      constant: true,
      enabled: true,
    },
    {
      id: "lore_simple",
      keys: ["sword", "blade"],
      content: "A legendary sword forged in fire.",
      constant: false,
      enabled: true,
      scanDepth: 10,
    },
    {
      id: "lore_regex",
      keys: ["/dragon[s]?/i"],
      content: "Dragons are mythical flying beasts.",
      constant: false,
      enabled: true,
      useRegex: true,
      scanDepth: 10,
    },
    {
      id: "lore_selective_and",
      keys: ["wizard"],
      secondary_keys: ["spell", "wand"],
      selectiveLogic: "AND_ANY",
      content: "Wizards use spells and wands to cast magic.",
      constant: false,
      enabled: true,
      scanDepth: 10,
    },
    {
      id: "lore_selective_not",
      keys: ["shield"],
      secondary_keys: ["broken"],
      selectiveLogic: "NOT_ANY",
      content: "This shield is unbreakable.",
      constant: false,
      enabled: true,
      scanDepth: 10,
    },
    {
      id: "lore_depth_limit",
      keys: ["potion"],
      content: "Potions heal wounds.",
      constant: false,
      enabled: true,
      scanDepth: 2, // only scans last 2 messages (+ user input)
    },
  ];

  const messages: Message[] = [
    { id: "m1", sender: "user", content: "We found a potion in the dungeon.", timestamp: Date.now() }, // 4 messages ago
    { id: "m2", sender: "assistant", content: "A wizard approached us.", timestamp: Date.now() },
    { id: "m3", sender: "user", content: "He cast a spell.", timestamp: Date.now() },
    { id: "m4", sender: "assistant", content: "It matched his dragon shield.", timestamp: Date.now() },
  ];

  // Test Case 1: User input "I swing my sword at the dragons."
  // Should trigger: lore_constant (constant), lore_simple ("sword"), lore_regex ("dragons"), lore_selective_not ("shield" present, but "broken" NOT present in history)
  // Should NOT trigger: lore_depth_limit ("potion" is at m1 which is beyond depth 2)
  const active1 = getTriggeredLorebookEntries(messages, "I swing my sword at the dragons.", baseEntries);
  const activeIds1 = active1.map(e => e.id);
  
  assert(activeIds1.includes("lore_constant"), "Constant triggers");
  assert(activeIds1.includes("lore_simple"), "Simple keyword match");
  assert(activeIds1.includes("lore_regex"), "Regex keyword match");
  assert(activeIds1.includes("lore_selective_not"), "Selective NOT logic match");
  assert(!activeIds1.includes("lore_depth_limit"), "Depth limit constraints work");

  // Test Case 2: User input "The shield was broken."
  // Should NOT trigger lore_selective_not because "broken" is now present
  const active2 = getTriggeredLorebookEntries(messages, "The shield was broken.", baseEntries);
  const activeIds2 = active2.map(e => e.id);
  assert(!activeIds2.includes("lore_selective_not"), "Selective NOT logic block");

  // Test Case 3: User input "potion" -> should trigger depth limit now because it is in user input
  const active3 = getTriggeredLorebookEntries(messages, "I drank a potion.", baseEntries);
  const activeIds3 = active3.map(e => e.id);
  assert(activeIds3.includes("lore_depth_limit"), "Depth limit triggered by user input");

  console.log("✔ getTriggeredLorebookEntries tests passed!");
}

function testCacheHoistingAndContextTruncation() {
  console.log("-> Running testCacheHoistingAndContextTruncation...");

  const character: CharacterCard = {
    id: "char1",
    name: "Alice",
    description: "A nice girl.",
    personality: "Kind",
    scenario: "Tavern",
    first_mes: "Hello",
    mes_example: "",
    lorebookEntries: [
      {
        id: "l1",
        keys: ["secret"],
        content: "Lorebook secret entry content.",
        constant: false,
        enabled: true,
        position: "in_chat",
        depth: 1,
      },
      {
        id: "l2",
        keys: ["whisper"],
        content: "Lorebook whisper entry content.",
        constant: false,
        enabled: true,
        position: "before_last_mes",
      }
    ]
  };

  const chat: ChatSession = {
    id: "chat1",
    characterId: "char1",
    title: "Chat 1",
    createdAt: Date.now(),
    messages: [
      { id: "m1", sender: "assistant", content: "Greeting from Alice!", timestamp: Date.now() },
      { id: "m2", sender: "user", content: "Tell me the secret of whisper.", timestamp: Date.now() },
    ],
    summaries: [],
  };

  // Case 1: Standard model (e.g. gpt-4) - Hoisting disabled
  const settingsStandard: UserSettings = {
    userName: "Bob",
    api: {
      type: "openai-compat",
      baseUrl: "https://api.openai.com",
      apiKey: "key",
      modelName: "gpt-4",
    },
    preset: {
      id: "p1",
      name: "default",
      temperature: 0.7,
      topP: 1,
      topK: 40,
      repetitionPenalty: 1,
      maxTokens: 100,
    },
    memory: {
      recentTurns: 10,
      summaryTriggerTurns: 15,
      summaryLength: 100,
    },
    promptConfig: {
      mainPrompt: "System prompt.",
      jailbreakPrompt: "",
      useJailbreak: false,
      postHistoryPrompt: "",
      usePostHistory: false,
      instructTemplate: "default",
      systemPrefix: "",
      systemSuffix: "",
      userPrefix: "",
      userSuffix: "",
      assistantPrefix: "",
      assistantSuffix: "",
    }
  };

  const resStandard = assemblePromptContext({
    character,
    chat,
    userInput: "tell me",
    settings: settingsStandard,
  });

  // Verify that lorebook entries are injected into history for standard model
  assert(resStandard.history.length === 2, "History has 2 messages");
  // The last message (user) should contain the before_last_mes and in_chat entries
  assert(resStandard.history[1].content.includes("Lorebook secret entry content."), "Standard: in_chat lorebook injected in history");
  assert(resStandard.history[1].content.includes("Lorebook whisper entry content."), "Standard: before_last_mes lorebook injected in history");
  // The system instruction should NOT contain them
  assert(!resStandard.systemInstruction.includes("Lorebook secret entry content."), "Standard: system instruction clean of in_chat");

  // Case 2: DeepSeek model - Hoisting enabled
  const settingsDeepseek = {
    ...settingsStandard,
    api: {
      ...settingsStandard.api,
      modelName: "deepseek-chat",
    }
  };

  const resDeepseek = assemblePromptContext({
    character,
    chat,
    userInput: "tell me",
    settings: settingsDeepseek,
  });

  // Verify that lorebook entries are NOT in the chat history, but ARE in the system prompt
  assert(resDeepseek.history.length === 2, "History has 2 messages for DeepSeek");
  assert(!resDeepseek.history[1].content.includes("Lorebook secret entry content."), "DeepSeek: history clean of in_chat");
  assert(!resDeepseek.history[1].content.includes("Lorebook whisper entry content."), "DeepSeek: history clean of before_last_mes");
  // They must be hoisted to after_char_def (which goes into systemInstruction)
  assert(resDeepseek.systemInstruction.includes("Lorebook secret entry content."), "DeepSeek: system instruction has hoisted in_chat");
  assert(resDeepseek.systemInstruction.includes("Lorebook whisper entry content."), "DeepSeek: system instruction has hoisted before_last_mes");

  // Case 3: Gemini model - Hoisting enabled
  const settingsGemini = {
    ...settingsStandard,
    api: {
      ...settingsStandard.api,
      modelName: "gemini-1.5-pro",
    }
  };

  const resGemini = assemblePromptContext({
    character,
    chat,
    userInput: "tell me",
    settings: settingsGemini,
  });

  assert(resGemini.history.length === 2, "History has 2 messages for Gemini");
  assert(!resGemini.history[1].content.includes("Lorebook secret entry content."), "Gemini: history clean of in_chat");
  assert(resGemini.systemInstruction.includes("Lorebook secret entry content."), "Gemini: system instruction has hoisted in_chat");

  // Case 4: Token Truncation / Context budget defense
  const largeChat: ChatSession = {
    id: "chat_large",
    characterId: "char1",
    title: "Large Chat",
    createdAt: Date.now(),
    messages: [
      { id: "m1", sender: "assistant", content: "Greeting from Alice!", timestamp: Date.now() }, // Keep greeting
      { id: "m2", sender: "user", content: "Message 2", timestamp: Date.now() },
      { id: "m3", sender: "assistant", content: "Message 3", timestamp: Date.now() },
      { id: "m4", sender: "user", content: "Message 4", timestamp: Date.now() },
      // extremely large message that will trigger token limit truncation
      { id: "m5", sender: "assistant", content: "A".repeat(60000), timestamp: Date.now() },
      { id: "m6", sender: "user", content: "Message 6", timestamp: Date.now() },
    ],
    summaries: [],
  };

  const settingsLarge = {
    ...settingsStandard,
    memory: {
      ...settingsStandard.memory,
      recentTurns: 5, // Request last 5 turns
    }
  };

  const resLargeTruncated = assemblePromptContext({
    character,
    chat: largeChat,
    userInput: "tell me",
    settings: settingsLarge,
  });

  assert(resLargeTruncated.history.length === 2, "Large chat history truncated to 2 messages");
  assert(resLargeTruncated.history[0].content === "Greeting from Alice!", "Large chat kept greeting");
  assert(resLargeTruncated.history[1].content === "Message 6", "Large chat kept the latest message");

  console.log("✔ testCacheHoistingAndContextTruncation passed!");
}

function runAll() {
  console.log("=== Running Mobile Tavern Functional Test Suite ===");
  try {
    testReplaceMacros();
    testLorebookTriggers();
    testCacheHoistingAndContextTruncation();
    console.log("🎉 All tests passed successfully!");
  } catch (err: any) {
    console.error("❌ Test failed:", err.message);
    process.exit(1);
  }
}

runAll();
