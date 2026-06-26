/**
 * Prompt Builder 测试套件
 *
 * 覆盖：
 *  - testPromptBuilder：宏替换与 Lorebook 关键词触发
 *  - testPromptBuilderSystemMerging：中途 system 消息合并与 strict user/assistant 交替
 */

import { replaceMacros, getTriggeredLorebookEntries, assemblePromptContext } from "../../src/utils/promptBuilder";
import { LorebookEntry, Message } from "../../src/types";
import { assert } from "./testUtils";

export function testPromptBuilder() {
  console.log("\n--- Running Prompt Builder Verification ---");

  const macroParams = {
    char: "Alice",
    user: "Bob",
    description: "A helpful AI assistant that costs $10.",
    personality: "Optimistic.",
    scenario: "In a cozy tavern with $20 cash.",
    userPersona: "A curious traveler.",
    mes_example: "Hello!",
  };

  // 1. replaceMacros test
  const t1 = "Hello, {{user}}! I am {{char}}.";
  assert(replaceMacros(t1, macroParams) === "Hello, Bob! I am Alice.", "replaceMacros replacement");

  const t2 = "Description: {{description}} and Cash: {{scenario}}";
  const expectedT2 = "Description: A helpful AI assistant that costs $10. and Cash: In a cozy tavern with $20 cash.";
  assert(replaceMacros(t2, macroParams) === expectedT2, "replaceMacros special characters");

  // 2. getTriggeredLorebookEntries test
  const baseEntries: LorebookEntry[] = [
    {
      id: "l_const",
      keys: ["always"],
      content: "Constant info",
      constant: true,
      enabled: true,
    },
    {
      id: "l_keyword",
      keys: ["magic", "spell"],
      content: "Spellcasting details",
      enabled: true,
      scanDepth: 5,
    },
  ];

  const messages: Message[] = [
    { id: "m1", sender: "user", content: "Let's cast a spell.", timestamp: Date.now() },
  ];

  const active = getTriggeredLorebookEntries(messages, "I love magic.", baseEntries);
  const activeIds = active.map(e => e.id);
  assert(activeIds.includes("l_const"), "Includes constant lore");
  assert(activeIds.includes("l_keyword"), "Includes keyword lore");

  console.log("✔ Prompt Builder macros & lorebook triggering verified!");
}

export function testPromptBuilderSystemMerging() {
  console.log("\n--- Running Prompt Builder System Merging Verification ---");
  // 模拟 settings
  const mockSettings = {
    userName: "Bob",
    userInfo: "Traveler",
    api: { type: "openai-compat", baseUrl: "", apiKey: "", modelName: "" },
    preset: { temperature: 0.7, topP: 0.9, topK: 40, repetitionPenalty: 1.1, maxTokens: 100 },
    memory: { recentTurns: 10, summaryTriggerTurns: 0, summaryLength: 150 },
    promptConfig: { roleplayMode: true, mainPrompt: "You are Alice.", instructTemplate: "default" }
  } as any;

  // 模拟角色卡
  const mockChar = {
    name: "Alice",
    description: "AI",
    personality: "Optimistic",
    scenario: "Cozy tavern",
    first_mes: "Hello",
  } as any;

  // 模拟包含中途 System 消息的 Chat
  const mockChat = {
    messages: [
      { id: "m1", sender: "user", content: "Hi" },
      { id: "m2", sender: "system", content: "Suddenly, the weather turned cold." },
      { id: "m3", sender: "system", content: "A monster appears." },
      { id: "m4", sender: "assistant", content: "Oh no!" },
    ]
  } as any;

  const result = assemblePromptContext({
    character: mockChar,
    chat: mockChat,
    userInput: "What do I do?",
    settings: mockSettings,
  });

  // 验证返回的 history
  // 1. m2 和 m3 (中途 system) 应被合并成一条消息。
  // 2. 合并后的 system 旁白应该与 m1 (user) 合并在一起，形成一条统一的 user 消息，以维持 strict user/assistant 交替。
  // 最终的 history 应该只有 2 条：
  // 第一条：role: "user", content 包含了 "Hi"、"Suddenly, the weather turned cold." 和 "A monster appears."
  // 第二条：role: "assistant" (或 model), content 包含了 "Oh no!"

  assert(result.history.length === 2, `History length should be 2 to maintain strict alternation. Got: ${result.history.length}`);

  const firstMsg = result.history[0];
  assert(firstMsg.role === "user", `First msg role should be user. Got: ${firstMsg.role}`);
  assert(firstMsg.content.includes("Hi"), "Should contain first user message content");
  assert(firstMsg.content.includes("Suddenly, the weather turned cold."), "Should contain system narrator 1 (raw content, no hardcoded prefix)");
  assert(firstMsg.content.includes("A monster appears."), "Should contain system narrator 2 (raw content, no hardcoded prefix)");

  const secondMsg = result.history[1];
  assert(secondMsg.role === "model" || secondMsg.role === "assistant", "Second msg role should be assistant/model");
  assert(secondMsg.content.includes("Oh no!"), "Should contain assistant content");

  console.log("✔ Prompt Builder System Merging and strict alternation verified!");
}
