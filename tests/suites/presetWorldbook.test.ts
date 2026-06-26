/**
 * 预设与世界书集成测试套件
 *
 * 覆盖 testPresetAndWorldbookIntegration：
 *  - 预设的 mainPrompt 注入 systemInstruction
 *  - 自定义世界书关键词触发并按 position 插入
 */

import { assemblePromptContext } from "../../src/utils/promptBuilder";
import { LorebookEntry } from "../../src/types";
import { assert } from "./testUtils";

export function testPresetAndWorldbookIntegration() {
  console.log("\n--- Running Preset & Custom Worldbook Integration Verification ---");

  // 1. 模拟开启了预设的 Settings
  const mockSettings = {
    userName: "Bob",
    userInfo: "Traveler",
    api: { type: "openai-compat", baseUrl: "", apiKey: "", modelName: "" },
    preset: {
      name: "测试预设",
      temperature: 0.8,
      topP: 0.85,
      topK: 40,
      repetitionPenalty: 1.1,
      maxTokens: 600,
    },
    memory: {
      recentTurns: 6,
      summaryTriggerTurns: 0,
      enabled: true,
    },
    promptConfig: {
      mainPrompt: "系统设定：你是一个忠诚的骑士。",
      jailbreakPrompt: "",
      useJailbreak: false,
      postHistoryPrompt: "",
      usePostHistory: false,
      storyString: "",
      instructTemplate: "default",
      systemPrefix: "",
      systemSuffix: "",
      userPrefix: "",
      userSuffix: "",
      assistantPrefix: "",
      assistantSuffix: "",
      customPrompts: [],
    }
  } as any;

  // 2. 模拟自定义世界书词条
  const customWorldbookEntry: LorebookEntry = {
    id: "entry_magic",
    keys: ["圣光", "光系魔法"],
    content: "圣光：一种具有强大驱散与治愈能力的白魔法。",
    comment: "魔法设定",
    constant: false,
    disabled: false,
    enabled: true,
    position: "before_char_def",
    depth: 4,
    order: 100,
    probability: 100,
  };

  // 在 useChat.tsx 中，我们实际上获取了已启用的 customWorldbooks 词条合并：
  const customWorldbooks = {
    "custom-1": {
      id: "custom-1",
      name: "魔幻世界设定",
      entries: [customWorldbookEntry],
      enabled: true,
    }
  } as any;

  const customWorldbookGlobals = Object.values(customWorldbooks || {})
    .filter((wb: any) => wb.enabled)
    .flatMap((wb: any) => wb.entries || []);

  const combinedGlobals = [
    ...customWorldbookGlobals,
  ];

  // 3. 模拟角色卡
  const mockChar = {
    name: "阿尔萨斯",
    description: "骑士领主",
    personality: "坚毅",
    first_mes: "为了正义！",
  } as any;

  // 4. 模拟对话历史，用户的最后一句输入触发了世界书关键词
  const mockChat = {
    messages: [
      { id: "msg_1", sender: "assistant", content: "前方有亡灵天灾！" },
    ]
  } as any;

  const userInput = "不用怕，看我使用圣光魔法！";

  // 5. 拼装 Prompt
  const result = assemblePromptContext({
    character: mockChar,
    chat: mockChat,
    userInput: userInput,
    settings: mockSettings,
    globalLorebook: combinedGlobals,
  });

  // 6. 验证
  // - 预设的 mainPrompt 应该出现在拼装结果中
  // - 触发的世界书条目应该被激活并插入到 Prompt 中（在角色定义前 position="before_char_def"）
  const systemPrompt = result.systemInstruction || "";

  assert(systemPrompt.includes("系统设定：你是一个忠诚的骑士。"), "System prompt should contain preset mainPrompt");
  assert(systemPrompt.includes("圣光：一种具有强大驱散与治愈能力的白魔法。"), "System prompt should contain triggered lorebook entry");

  console.log("✔ Preset and Custom Worldbook integration verified successfully!");
}
