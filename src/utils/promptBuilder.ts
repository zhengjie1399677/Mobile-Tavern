import {
  CharacterCard,
  ChatSession,
  LorebookEntry,
  UserSettings,
  Message,
} from "../types";

/**
 * Searches for active worldbook (lorebook) keywords in text.
 */
export function getTriggeredLorebookEntries(
  messages: Message[],
  userInput: string,
  entries: LorebookEntry[],
): LorebookEntry[] {
  if (!entries || entries.length === 0) return [];
  const activeEntries: LorebookEntry[] = [];

  for (const entry of entries) {
    if (!entry.enabled || !entry.content) continue;
    if (entry.constant) {
      activeEntries.push(entry);
      continue;
    }

    // 1. Determine scanning depth (how many recent messages to inspect)
    const scanDepth = entry.scanDepth !== undefined ? entry.scanDepth : (entry.depth !== undefined ? entry.depth : 4);
    if (scanDepth === 0) continue; // scan_depth 0 means no match (unless constant, which is handled above)
    
    const scanMessages = messages ? messages.slice(-scanDepth) : [];
    const scanText =
      userInput + "\n" + scanMessages.map((m) => m.content).join("\n");

    const checkMatch = (key: string, isRegex: boolean, isCaseSensitive: boolean): boolean => {
      const trimmed = key.trim();
      if (!trimmed) return false;
      if (isRegex) {
        try {
          let pattern = trimmed;
          let flags = isCaseSensitive ? "" : "i";
          if (trimmed.startsWith("/") && trimmed.lastIndexOf("/") > 0) {
            pattern = trimmed.substring(1, trimmed.lastIndexOf("/"));
            const rawFlags = trimmed.substring(trimmed.lastIndexOf("/") + 1);
            flags = isCaseSensitive ? rawFlags.replace(/i/g, "") : (rawFlags.includes("i") ? rawFlags : rawFlags + "i");
          }
          return new RegExp(pattern, flags).test(scanText);
        } catch {
          return isCaseSensitive ? scanText.includes(trimmed) : scanText.toLowerCase().includes(trimmed.toLowerCase());
        }
      }
      return isCaseSensitive ? scanText.includes(trimmed) : scanText.toLowerCase().includes(trimmed.toLowerCase());
    };

    // 2. Base Hit Check (Primary Keys)
    const primaryMatched = entry.keys.some((key) => checkMatch(key, !!entry.useRegex, !!entry.caseSensitive));
    if (!primaryMatched) continue;

    // 3. Secondary Keys Logic Eval
    let secondaryMatched = true;
    const logic = entry.selectiveLogic || "NONE";
    const secKeys = entry.secondary_keys || [];
    
    if (logic !== "NONE" && secKeys.length > 0) {
      if (logic === "AND_ANY") {
        secondaryMatched = secKeys.some((key) => checkMatch(key, !!entry.useRegex, !!entry.caseSensitive));
      } else if (logic === "AND_ALL") {
        secondaryMatched = secKeys.every((key) => checkMatch(key, !!entry.useRegex, !!entry.caseSensitive));
      } else if (logic === "NOT_ANY") {
        secondaryMatched = !secKeys.some((key) => checkMatch(key, !!entry.useRegex, !!entry.caseSensitive));
      }
    }
    
    if (!secondaryMatched) continue;

    // 4. Roll trigger probability (0-100, default 100)
    const prob = entry.probability !== undefined ? entry.probability : 100;
    if (prob < 100 && Math.random() * 100 > prob) {
      continue;
    }
    
    // Check against duplicated IDs in one pass
    if (!activeEntries.find((a) => a.id === entry.id)) {
      activeEntries.push(entry);
    }
  }

  // 4. Sort by order weight (ascending, default 100)
  activeEntries.sort((a, b) => {
    const orderA = a.order !== undefined ? a.order : 100;
    const orderB = b.order !== undefined ? b.order : 100;
    return orderA - orderB;
  });

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
  },
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
    scenario: character.scenario || "无",
  };

  // If roleplayMode is disabled, return a bare-bone prompt with zero Tavern system instructions.
  if (settings.promptConfig?.roleplayMode === false) {
    const { recentTurns } = settings.memory;
    const totalRawMessages = chat.messages ? [...chat.messages] : [];
    let activeMessagesToSend: Message[] = [];

    if (totalRawMessages.length > 0) {
      const validChatMessages = totalRawMessages.filter(
        (m) => m.sender !== "system",
      );
      activeMessagesToSend = validChatMessages.slice(-recentTurns);
    }

    const chatHistory = activeMessagesToSend.map((msg) => {
      let role: "user" | "model" | "assistant" = "user";
      let content = msg.content;

      if (msg.sender === "assistant") {
        role = settings.api.type === "openai-compat" ? "assistant" : "model";
        if (settings.promptConfig?.instructTemplate !== "default") {
          const prefix = replaceMacros(
            settings.promptConfig?.assistantPrefix || "",
            macroParams,
          );
          const suffix = replaceMacros(
            settings.promptConfig?.assistantSuffix || "",
            macroParams,
          );
          content = `${prefix}${content}${suffix}`;
        }
      } else {
        role = "user";
        if (settings.promptConfig?.instructTemplate !== "default") {
          const prefix = replaceMacros(
            settings.promptConfig?.userPrefix || "",
            macroParams,
          );
          const suffix = replaceMacros(
            settings.promptConfig?.userSuffix || "",
            macroParams,
          );
          content = `${prefix}${content}${suffix}`;
        }
      }

      return {
        role,
        content,
      };
    });

    let cleanSystem = "";
    if (character.system_prompt) {
      cleanSystem += `${replaceMacros(character.system_prompt, macroParams)}\n\n`;
    }
    if (settings.userInfo) {
      cleanSystem += `=== User Persona ===\n${replaceMacros(settings.userInfo, macroParams)}\n\n`;
    }

    // Process world info keywords even in normal chat mode if they exist/are defined
    const allEntries = [...(character.lorebookEntries || []), ...globalLorebook];
    const activeEntries = getTriggeredLorebookEntries(
      chat.messages || [],
      userInput,
      allEntries,
    );

    if (activeEntries.length > 0) {
      cleanSystem += `=== Reference Lore ===\n${activeEntries.map((e) => e.content).join("\n\n")}\n\n`;
    }

    return {
      systemInstruction: cleanSystem.trim(),
      dynamicInstruction: "",
      history: chatHistory,
      userInput,
    };
  }

  // 1. Process Core Custom mainPrompt from SillyTavern configs
  const hasCustomPrompts =
    settings.promptConfig?.customPrompts &&
    settings.promptConfig.customPrompts.length > 0;
  const activeCustomBlocks = hasCustomPrompts
    ? settings.promptConfig.customPrompts!.filter((p) => p.enabled)
    : [];

  let mainPromptReplaced = "";
  if (settings.promptConfig?.mainPrompt) {
    mainPromptReplaced = replaceMacros(
      settings.promptConfig.mainPrompt,
      macroParams,
    );
  } else if (activeCustomBlocks.length === 0) {
    // ONLY fallback to default if BOTH mainPrompt is empty AND there are no active custom prompt blocks!
    mainPromptReplaced = `你现在正在扮演 {{char}}。请进行逼真、生动、符合人设机制的纯文字角色扮演（RP）。`;
  }

  // Integrate fine-grained CUSTOM PROMPT BLOCKS if imported from the JSON preset
  if (activeCustomBlocks.length > 0) {
    const compiledBlocks = activeCustomBlocks
      .map((block) => {
        const prefix = block.name ? `### ${block.name}\n` : "";
        return `${prefix}${replaceMacros(block.content, macroParams)}`;
      })
      .join("\n\n");

    if (mainPromptReplaced) {
      mainPromptReplaced = `${mainPromptReplaced}\n\n${compiledBlocks}`;
    } else {
      mainPromptReplaced = compiledBlocks;
    }
  }

  // 2. Scan lorebook keywords
  // Combine custom character entries and global entries
  const allEntries = [...(character.lorebookEntries || []), ...globalLorebook];
  const activeEntries = getTriggeredLorebookEntries(
    chat.messages || [],
    userInput,
    allEntries,
  );

  // Sort them into physical location buckets
  const topEntries = activeEntries.filter((e) => e.position === "top");
  const beforeCharEntries = activeEntries.filter(
    (e) => e.position === "before_char_def",
  );
  const afterCharEntries = activeEntries.filter(
    (e) => e.position === "after_char_def" || !e.position,
  );
  const beforeLastMsgEntries = activeEntries.filter(
    (e) => e.position === "before_last_mes",
  );

  function formatEntryContent(entry: LorebookEntry): string {
    if (entry.addMemo && entry.comment) {
      return `[设定及备注: ${entry.comment}]\n${entry.content}`;
    }
    return entry.content;
  }

  function formatEntryBlock(entries: LorebookEntry[]): string {
    if (entries.length === 0) return "";
    return entries.map((e) => formatEntryContent(e)).join("\n\n");
  }

  const topText = formatEntryBlock(topEntries);
  const topSection = topText
    ? `=== 设定基础基石 (World Lore) ===\n${topText}\n`
    : "";

  const beforeCharText = formatEntryBlock(beforeCharEntries);
  const beforeCharSection = beforeCharText
    ? `=== 世界背景设定前置 ===\n${beforeCharText}\n`
    : "";

  const afterCharText = formatEntryBlock(afterCharEntries);
  const afterCharSection = afterCharText
    ? `=== 设定说明书拓展 (World Info) ===\n${afterCharText}\n`
    : "";

  const beforeLastText = formatEntryBlock(beforeLastMsgEntries);
  const beforeLastSection = beforeLastText
    ? `=== 临时触发规则与道具 ===\n${beforeLastText}\n`
    : "";

  // 3. Summary timeline memory
  let summarySection = "";
  if (chat.summaries && chat.summaries.length > 0) {
    summarySection =
      "\n=== 剧情前情要点提炼 (Timeline Summaries) ===\n" +
      chat.summaries
        .map((s) => `[时间: ${s.timeTag} | 地点: ${s.location}] ${s.content}`)
        .join("\n") +
      "\n";
  }

  let userPersonaSection = "";
  if (settings.userInfo) {
    userPersonaSection =
      "\n=== 玩家详细信息 (User Persona) ===\n" +
      replaceMacros(settings.userInfo, macroParams) +
      "\n";
  }

  // 4. Character-bound specific system prompt if specified
  let charSpecificPrompt = "";
  if (character.system_prompt) {
    charSpecificPrompt =
      "\n=== 角色卡附加特殊约束 ===\n" +
      replaceMacros(character.system_prompt, macroParams) +
      "\n";
  }

  // 5. Jailbreak instructions
  let jailbreakSection = "";
  if (
    settings.promptConfig?.useJailbreak &&
    settings.promptConfig?.jailbreakPrompt
  ) {
    jailbreakSection =
      "\n=== 安全消除与写实细节强调 (Jailbreak Prompt) ===\n" +
      replaceMacros(settings.promptConfig.jailbreakPrompt, macroParams) +
      "\n";
  }

  // 6. Post-history direct instruction (reminders right before response generation)
  let postHistorySection = "";
  if (
    settings.promptConfig?.usePostHistory &&
    settings.promptConfig?.postHistoryPrompt
  ) {
    postHistorySection =
      "\n=== 生成纪律提醒 ===\n" +
      replaceMacros(settings.promptConfig.postHistoryPrompt, macroParams) +
      "\n";
  }

  // 7. Core custom story sequence compiler! Natively supports standard SillyTavern order template!
  let compiledStory =
    settings.promptConfig?.storyString ||
    `{{system_prompt}}

=== 角色性格设定 ===
{{personality}}

=== 角色详细描述 ===
{{description}}

=== 时代背景与场景设定 ===
{{scenario}}

{{char_system}}`;

  let dynamicSystemExtension = `{{summaries}}

{{lorebook_entries}}

{{jailbreak}}

{{post_history}}`;

  const descriptionVal = replaceMacros(
    character.description || "",
    macroParams,
  );
  const personalityVal = replaceMacros(
    character.personality || "",
    macroParams,
  );
  const scenarioVal = replaceMacros(character.scenario || "", macroParams);

  // Apply visual positions
  if (topSection) {
    compiledStory = compiledStory.replace(
      /\{\{system_prompt\}\}/gi,
      `${topSection}\n{{system_prompt}}`,
    );
  }
  if (beforeCharSection) {
    compiledStory = compiledStory.replace(
      /\{\{personality\}\}/gi,
      `${beforeCharSection}\n{{personality}}`,
    );
  }

  // Substitute all fields in Static Story
  compiledStory = compiledStory
    .replace(/\{\{system_prompt\}\}/gi, mainPromptReplaced + userPersonaSection)
    .replace(/\{\{personality\}\}/gi, personalityVal)
    .replace(/\{\{description\}\}/gi, descriptionVal)
    .replace(/\{\{char_description\}\}/gi, descriptionVal)
    .replace(/\{\{scenario\}\}/gi, scenarioVal)
    .replace(/\{\{char_scenario\}\}/gi, scenarioVal)
    .replace(/\{\{char_system\}\}/gi, charSpecificPrompt);

  // Clean repeating double newlines left by empty sections
  const systemInstruction = compiledStory.replace(/\n{3,}/g, "\n\n").trim();

  // Substitute all fields in Dynamic Extension
  dynamicSystemExtension = dynamicSystemExtension
    .replace(/\{\{summaries\}\}/gi, summarySection)
    .replace(/\{\{lorebook_entries\}\}/gi, afterCharSection)
    .replace(/\{\{wi\}\}/gi, afterCharSection)
    .replace(/\{\{jailbreak\}\}/gi, jailbreakSection)
    .replace(/\{\{post_history\}\}/gi, postHistorySection);
    
  const dynamicInstruction = dynamicSystemExtension.replace(/\n{3,}/g, "\n\n").trim();

  // 8. Gather Recent Full Messages
  const { recentTurns } = settings.memory;

  // Recent full messages size
  const totalRawMessages = chat.messages ? [...chat.messages] : [];

  // We send recentTurns messages as actual conversation message history
  let activeMessagesToSend: Message[] = [];

  if (totalRawMessages.length > 0) {
    // DO NOT SEND system messages to the AI history to prevent LLM confusion on error messages
    const validChatMessages = totalRawMessages.filter(
      (m) => m.sender !== "system",
    );
    activeMessagesToSend = validChatMessages.slice(-recentTurns);
  }

  // Convert Message[] to Gemini or OpenAI structure, applying custom Instruct prefix/suffix templates (e.g. ChatML/Alpaca)
  const chatHistory = activeMessagesToSend.map((msg) => {
    let role: "user" | "model" | "assistant" = "user";
    let content = msg.content;

    if (msg.sender === "assistant") {
      role = settings.api.type === "openai-compat" ? "assistant" : "model";
      if (settings.promptConfig?.instructTemplate !== "default") {
        const prefix = replaceMacros(
          settings.promptConfig?.assistantPrefix || "",
          macroParams,
        );
        const suffix = replaceMacros(
          settings.promptConfig?.assistantSuffix || "",
          macroParams,
        );
        content = `${prefix}${content}${suffix}`;
      }
    } else {
      role = "user";
      if (settings.promptConfig?.instructTemplate !== "default") {
        const prefix = replaceMacros(
          settings.promptConfig?.userPrefix || "",
          macroParams,
        );
        const suffix = replaceMacros(
          settings.promptConfig?.userSuffix || "",
          macroParams,
        );
        content = `${prefix}${content}${suffix}`;
      }
    }

    return {
      role,
      content,
    };
  });

  const inChatEntries = activeEntries.filter(
    (e) => e.position === "in_chat",
  );

  // Group in-chat entries by their target index in chatHistory
  const inChatMap = new Map<number, LorebookEntry[]>();
  inChatEntries.forEach((entry) => {
    // If depth is 0, it means it's prepended to the very last message (same as before_last_mes)
    const depth = entry.depth !== undefined ? entry.depth : 4;
    let targetIdx = Math.max(0, chatHistory.length - (depth > 0 ? depth : 1));
    if (targetIdx >= chatHistory.length) targetIdx = chatHistory.length - 1;
    
    if (!inChatMap.has(targetIdx)) {
      inChatMap.set(targetIdx, []);
    }
    inChatMap.get(targetIdx)!.push(entry);
  });

  // Apply "in_chat" entries injected by depth into the history!
  inChatMap.forEach((entries, targetIdx) => {
    // Sort by order ascending (smaller order appears earlier in the text block)
    entries.sort((a, b) => (a.order || 100) - (b.order || 100));
    
    if (chatHistory[targetIdx]) {
      const mergedContent = entries.map((e) => formatEntryContent(e)).join("\n\n");
      chatHistory[targetIdx].content = `${mergedContent}\n\n${chatHistory[targetIdx].content}`;
    }
  });

  // Apply "before_last_mes" as well directly to chatHistory so it actually works properly.
  // We prepend it to the very last message in the history.
  if (beforeLastMsgEntries.length > 0 && chatHistory.length > 0) {
    const targetIdx = chatHistory.length - 1;
    // ensure sorted by order
    beforeLastMsgEntries.sort((a, b) => (a.order || 100) - (b.order || 100));
    const beforeLastText = formatEntryBlock(beforeLastMsgEntries);
    chatHistory[targetIdx].content = `${beforeLastText}\n\n${chatHistory[targetIdx].content}`;
  }

  return {
    systemInstruction,
    dynamicInstruction,
    history: chatHistory,
    userInput,
  };
}
