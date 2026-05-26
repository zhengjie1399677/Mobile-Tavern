import { CharacterCard, ChatSession, LorebookEntry, UserSettings, Message } from "../types";

/**
 * Searches for active worldbook (lorebook) keywords in text.
 */
export function getTriggeredLorebookEntries(
  recentText: string,
  entries: LorebookEntry[]
): LorebookEntry[] {
  if (!entries || entries.length === 0) return [];
  const activeEntries: LorebookEntry[] = [];
  
  for (const entry of entries) {
    if (!entry.enabled) continue;
    if (entry.constant) {
      activeEntries.push(entry);
      continue;
    }
    
    // Check if any keyword matches
    const hasMatch = entry.keys.some((key) => {
      const trimmedKey = key.trim();
      if (!trimmedKey) return false;
      // Simple case-insensitive search
      return recentText.toLowerCase().includes(trimmedKey.toLowerCase());
    });
    
    if (hasMatch) {
      activeEntries.push(entry);
    }
  }
  return activeEntries;
}

/**
 * Helper to replace SillyTavern style bracket macros in templates.
 */
export function replaceMacros(
  text: string,
  params: {
    char: string;
    user: string;
    description: string;
    personality: string;
    scenario: string;
  }
): string {
  if (!text) return "";
  return text
    .replace(/\{\{char\}\}/g, params.char)
    .replace(/\{\{user\}\}/g, params.user)
    .replace(/\{\{description\}\}/g, params.description)
    .replace(/\{\{personality\}\}/g, params.personality)
    .replace(/\{\{scenario\}\}/g, params.scenario);
}

/**
 * Assemblies the complete prompting context.
 * Returns both the system instructions, and the history mapping for Gemini / OpenAI
 */
export function assemblePromptContext(params: {
  character: CharacterCard;
  chat: ChatSession;
  userInput: string;
  settings: UserSettings;
  globalLorebook?: LorebookEntry[];
}) {
  const { character, chat, userInput, settings, globalLorebook = [] } = params;
  
  // Create substitution parameters for SillyTavern custom scripts/prompts
  const macroParams = {
    char: character.name,
    user: settings.userName || "用户",
    description: character.description || "无",
    personality: character.personality || "无",
    scenario: character.scenario || "无"
  };

  // 1. Process Core Custom mainPrompt from SillyTavern configs
  const hasCustomPrompts = settings.promptConfig?.customPrompts && settings.promptConfig.customPrompts.length > 0;
  const activeCustomBlocks = hasCustomPrompts ? settings.promptConfig.customPrompts!.filter(p => p.enabled) : [];

  let mainPromptReplaced = "";
  if (settings.promptConfig?.mainPrompt) {
    mainPromptReplaced = replaceMacros(settings.promptConfig.mainPrompt, macroParams);
  } else if (activeCustomBlocks.length === 0) {
    // ONLY fallback to default if BOTH mainPrompt is empty AND there are no active custom prompt blocks!
    mainPromptReplaced = `你现在正在扮演 {{char}}。请进行逼真、生动、符合人设机制的纯文字角色扮演（RP）。`;
  }

  // Integrate fine-grained CUSTOM PROMPT BLOCKS if imported from the JSON preset
  if (activeCustomBlocks.length > 0) {
    const compiledBlocks = activeCustomBlocks.map(block => {
      const prefix = block.name ? `### ${block.name}\n` : "";
      return `${prefix}${replaceMacros(block.content, macroParams)}`;
    }).join("\n\n");
    
    if (mainPromptReplaced) {
      mainPromptReplaced = `${mainPromptReplaced}\n\n${compiledBlocks}`;
    } else {
      mainPromptReplaced = compiledBlocks;
    }
  }

  // 2. Scan lorebook keywords in recent history + current input
  const lastMessagesContent = chat.messages
    .slice(-3)
    .map((m) => m.content)
    .join("\n");
  const scanText = userInput + "\n" + lastMessagesContent;
  
  // Combine custom character entries and global entries
  const allEntries = [
    ...(character.lorebookEntries || []),
    ...globalLorebook,
  ];
  const activeEntries = getTriggeredLorebookEntries(scanText, allEntries);
  
  let lorebookSection = "";
  if (activeEntries.length > 0) {
    lorebookSection = "\n=== 宿主世界设定书补充 (World Info) ===\n" + activeEntries
      .map((e, idx) => `[关键词: ${e.keys.join("/")}] ${e.content}`)
      .join("\n") + "\n";
  }

  // 3. Summary timeline memory
  let summarySection = "";
  if (chat.summaries && chat.summaries.length > 0) {
    summarySection = "\n=== 剧情前情要点提炼 (Timeline Summaries) ===\n" + chat.summaries
      .map((s) => `[时间: ${s.timeTag} | 地点: ${s.location}] ${s.content}`)
      .join("\n") + "\n";
  }

  // 4. Character-bound specific system prompt if specified
  let charSpecificPrompt = "";
  if (character.system_prompt) {
    charSpecificPrompt = "\n=== 角色卡附加特殊约束 ===\n" + replaceMacros(character.system_prompt, macroParams) + "\n";
  }

  // 5. Jailbreak instructions
  let jailbreakSection = "";
  if (settings.promptConfig?.useJailbreak && settings.promptConfig?.jailbreakPrompt) {
    jailbreakSection = "\n=== 安全消除与写实细节强调 (Jailbreak Prompt) ===\n" + replaceMacros(settings.promptConfig.jailbreakPrompt, macroParams) + "\n";
  }

  // 6. Post-history direct instruction (reminders right before response generation)
  let postHistorySection = "";
  if (settings.promptConfig?.usePostHistory && settings.promptConfig?.postHistoryPrompt) {
    postHistorySection = "\n=== 生成纪律提醒 ===\n" + replaceMacros(settings.promptConfig.postHistoryPrompt, macroParams) + "\n";
  }

  // 7. Core custom story sequence compiler! Natively supports standard SillyTavern order template!
  let compiledStory = settings.promptConfig?.storyString || 
`{{system_prompt}}

=== 角色性格设定 ===
{{personality}}

=== 角色详细描述 ===
{{description}}

=== 时代背景与场景设定 ===
{{scenario}}

{{char_system}}

{{summaries}}

{{lorebook_entries}}

{{jailbreak}}

{{post_history}}`;

  const descriptionVal = replaceMacros(character.description || "", macroParams);
  const personalityVal = replaceMacros(character.personality || "", macroParams);
  const scenarioVal = replaceMacros(character.scenario || "", macroParams);

  // Substitute all fields
  compiledStory = compiledStory
    .replace(/\{\{system_prompt\}\}/gi, mainPromptReplaced)
    .replace(/\{\{personality\}\}/gi, personalityVal)
    .replace(/\{\{description\}\}/gi, descriptionVal)
    .replace(/\{\{char_description\}\}/gi, descriptionVal)
    .replace(/\{\{scenario\}\}/gi, scenarioVal)
    .replace(/\{\{char_scenario\}\}/gi, scenarioVal)
    .replace(/\{\{char_system\}\}/gi, charSpecificPrompt)
    .replace(/\{\{summaries\}\}/gi, summarySection)
    .replace(/\{\{lorebook_entries\}\}/gi, lorebookSection)
    .replace(/\{\{wi\}\}/gi, lorebookSection)
    .replace(/\{\{jailbreak\}\}/gi, jailbreakSection)
    .replace(/\{\{post_history\}\}/gi, postHistorySection);

  // Clean repeating double newlines left by empty sections
  const systemInstruction = compiledStory.replace(/\n{3,}/g, "\n\n").trim();

  // 8. Gather Recent Full Messages
  const { recentTurns } = settings.memory;
  
  // Recent full messages size
  const totalRawMessages = chat.messages ? [...chat.messages] : [];
  
  // We send recentTurns messages as actual conversation message history
  let activeMessagesToSend: Message[] = [];
  
  if (totalRawMessages.length > 0) {
    // DO NOT SEND system messages to the AI history to prevent LLM confusion on error messages
    const validChatMessages = totalRawMessages.filter(m => m.sender !== "system");
    activeMessagesToSend = validChatMessages.slice(-recentTurns);
  }

  // Convert Message[] to Gemini or OpenAI structure, applying custom Instruct prefix/suffix templates (e.g. ChatML/Alpaca)
  const chatHistory = activeMessagesToSend.map((msg) => {
    let role: "user" | "model" | "assistant" = "user";
    let content = msg.content;
    
    if (msg.sender === "assistant") {
      role = settings.api.type === "openai-compat" ? "assistant" : "model";
      if (settings.promptConfig?.instructTemplate !== "default") {
        const prefix = replaceMacros(settings.promptConfig?.assistantPrefix || "", macroParams);
        const suffix = replaceMacros(settings.promptConfig?.assistantSuffix || "", macroParams);
        content = `${prefix}${content}${suffix}`;
      }
    } else {
      role = "user";
      if (settings.promptConfig?.instructTemplate !== "default") {
        const prefix = replaceMacros(settings.promptConfig?.userPrefix || "", macroParams);
        const suffix = replaceMacros(settings.promptConfig?.userSuffix || "", macroParams);
        content = `${prefix}${content}${suffix}`;
      }
    }
    
    return {
      role,
      content,
    };
  });

  return {
    systemInstruction,
    history: chatHistory,
    userInput,
  };
}
