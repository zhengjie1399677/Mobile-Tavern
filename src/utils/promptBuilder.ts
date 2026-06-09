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

  const scanTextCache = new Map<number, string>();
  const getScanText = (depth: number): string => {
    if (scanTextCache.has(depth)) {
      return scanTextCache.get(depth)!;
    }
    const scanMessages = messages ? messages.slice(-depth) : [];
    let text = userInput + "\n" + scanMessages.map((m) => m.content).join("\n");
    if (text.length > 8000) {
      text = text.slice(-8000);
    }
    scanTextCache.set(depth, text);
    return text;
  };

  const checkMatch = (key: string, isRegex: boolean, isCaseSensitive: boolean, scanText: string): boolean => {
    const trimmed = key.trim();
    if (!trimmed) return false;
    if (isRegex) {
      // ReDoS pattern protection: block patterns with nested/repeated quantifiers
      if (/(\([^\)]*[\+\*]\)[^\)]*[\+\*])/.test(trimmed) || /(\[[^\]]*[\+\*]\][^\]]*[\+\*])/.test(trimmed)) {
        console.warn("Potential ReDoS pattern skipped in regex key matching:", trimmed);
        return isCaseSensitive 
          ? scanText.includes(trimmed) 
          : scanText.toLowerCase().includes(trimmed.toLowerCase());
      }
      try {
        let pattern = trimmed;
        let flags = isCaseSensitive ? "" : "i";
        const regexMatch = trimmed.match(/^\/(.+)\/([dgimsuy]*)$/i);
        if (regexMatch) {
          pattern = regexMatch[1];
          const rawFlags = regexMatch[2];
          flags = isCaseSensitive
            ? rawFlags.replace(/i/g, "")
            : (rawFlags.toLowerCase().includes("i") ? rawFlags : rawFlags + "i");
        }
        return new RegExp(pattern, flags).test(scanText);
      } catch {
        return isCaseSensitive ? scanText.includes(trimmed) : scanText.toLowerCase().includes(trimmed.toLowerCase());
      }
    }
    return isCaseSensitive ? scanText.includes(trimmed) : scanText.toLowerCase().includes(trimmed.toLowerCase());
  };

  for (const entry of entries) {
    if (!entry.enabled || !entry.content) continue;
    if (entry.constant) {
      activeEntries.push(entry);
      continue;
    }

    // 1. Determine scanning depth (how many recent messages to inspect)
    const scanDepth = entry.scanDepth !== undefined ? entry.scanDepth : 10;
    if (scanDepth === 0) continue; 
    
    const scanText = getScanText(scanDepth);

    // 2. Base Hit Check (Primary Keys)
    const primaryMatched = entry.keys.some((key) => checkMatch(key, !!entry.useRegex, !!entry.caseSensitive, scanText));
    if (!primaryMatched) continue;

    // 3. Secondary Keys Logic Eval
    let secondaryMatched = true;
    const logic = entry.selectiveLogic || "NONE";
    const secKeys = entry.secondary_keys || [];
    
    if (logic !== "NONE" && secKeys.length > 0) {
      if (logic === "AND_ANY") {
        secondaryMatched = secKeys.some((key) => checkMatch(key, !!entry.useRegex, !!entry.caseSensitive, scanText));
      } else if (logic === "AND_ALL") {
        secondaryMatched = secKeys.every((key) => checkMatch(key, !!entry.useRegex, !!entry.caseSensitive, scanText));
      } else if (logic === "NOT_ANY") {
        secondaryMatched = !secKeys.some((key) => checkMatch(key, !!entry.useRegex, !!entry.caseSensitive, scanText));
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
 * Robustly matches various capitalizations and prefixes used in SillyTavern ecosystem.
 */
export function replaceMacros(
  text: string,
  params: {
    char: string;
    user: string;
    description: string;
    personality: string;
    scenario: string;
    userPersona?: string;
    mes_example?: string;
  },
): string {
  if (!text) return "";
  
  const macroMap: Record<string, string> = {
    char: params.char,
    chara: params.char,
    char_name: params.char,
    user: params.user,
    user_name: params.user,
    char_description: params.description,
    description: params.description,
    char_personality: params.personality,
    personality: params.personality,
    char_scenario: params.scenario,
    scenario: params.scenario,
    userpersona: params.userPersona || "",
    persona: params.userPersona || "",
  };

  if (params.mes_example !== undefined) {
    macroMap["mes_example"] = params.mes_example;
    macroMap["diags"] = params.mes_example;
    macroMap["example_dialogue"] = params.mes_example;
  }

  return text.replace(/\{\{([a-zA-Z0-9_]+)\}\}/gi, (match, key) => {
    const lowerKey = key.toLowerCase();
    return macroMap[lowerKey] !== undefined ? macroMap[lowerKey] : match;
  });
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
    user: settings.userName || "user",
    description: character.description || "无",
    personality: character.personality || "无",
    scenario: character.scenario || "无",
    userPersona: settings.userInfo || "无",
    mes_example: character.mes_example || "",
  };

  // If roleplayMode is disabled, return a bare-bone prompt with zero Tavern system instructions.
  if (settings.promptConfig?.roleplayMode === false) {
    const { recentTurns } = settings.memory;
    const totalRawMessages = chat.messages ? [...chat.messages] : [];
    let activeMessagesToSend: Message[] = [];

    if (totalRawMessages.length > 0) {
      const validChatMessages = totalRawMessages.filter(
        (m) => m.sender !== "system"
      );
      const firstMsg = validChatMessages[0];
      const isFirstMsgGreeting = firstMsg && firstMsg.sender === "assistant";

      if (validChatMessages.length > recentTurns) {
        if (isFirstMsgGreeting) {
          activeMessagesToSend = [
            firstMsg,
            ...validChatMessages.slice(-(recentTurns - 1))
          ];
        } else {
          activeMessagesToSend = validChatMessages.slice(-recentTurns);
        }
      } else {
        activeMessagesToSend = validChatMessages;
      }
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

  const headers = settings.promptConfig?.sectionHeaders || {};

  const formatSectionText = (key: string, defaultHeader: string, contentText: string, prefixNewline: boolean = false) => {
    if (!contentText) return "";
    const headerVal = headers[key];
    const actualHeader = headerVal === undefined ? defaultHeader : headerVal;
    if (!actualHeader) {
      return prefixNewline ? `\n\n${contentText}\n` : `${contentText}\n`;
    }
    return prefixNewline
      ? `\n\n${actualHeader}\n${contentText}\n`
      : `${actualHeader}\n${contentText}\n`;
  };

  const topText = formatEntryBlock(topEntries);
  const topSection = formatSectionText("system", "", topText);

  const beforeCharText = formatEntryBlock(beforeCharEntries);
  const beforeCharSection = formatSectionText("beforeChar", "", beforeCharText);

  const afterCharText = formatEntryBlock(afterCharEntries);
  const afterCharSection = formatSectionText("worldInfo", "", afterCharText);

  const beforeLastText = formatEntryBlock(beforeLastMsgEntries);
  const beforeLastSection = formatSectionText("beforeLast", "", beforeLastText);

  // 3. Summary timeline memory
  let summarySection = "";
  if (chat.summaries && chat.summaries.length > 0) {
    const summaryText = chat.summaries
      .map((s) => `[${s.timeTag} | ${s.location}] ${s.content}`)
      .join("\n");
    summarySection = formatSectionText("summary", "", summaryText, true);
  }

  let userPersonaSection = "";
  if (settings.userInfo) {
    const personaText = replaceMacros(settings.userInfo, macroParams);
    userPersonaSection = formatSectionText("userPersona", "", personaText, true);
  }

  // 4. Character-bound specific system prompt if specified
  let charSpecificPrompt = "";
  if (character.system_prompt) {
    const specificText = replaceMacros(character.system_prompt, macroParams);
    charSpecificPrompt = formatSectionText("charSystem", "", specificText, true);
  }

  // 4.5 Dialogue examples section if specified (Dialogue Examples / mes_example)
  let mesExampleSection = "";
  if (character.mes_example) {
    const mesExampleVal = replaceMacros(character.mes_example, macroParams);
    mesExampleSection = formatSectionText("mesExample", "=== 对话与例句示例 (Dialogue Examples) ===", mesExampleVal, true);
  }

  // 5. Jailbreak instructions
  let jailbreakSection = "";
  if (
    settings.promptConfig?.useJailbreak &&
    settings.promptConfig?.jailbreakPrompt
  ) {
    const jailbreakText = replaceMacros(settings.promptConfig.jailbreakPrompt, macroParams);
    jailbreakSection = formatSectionText("jailbreak", "", jailbreakText, true);
  }

  // 6. Post-history direct instruction (reminders right before response generation)
  let postHistoryContent = "";
  if (
    settings.promptConfig?.usePostHistory &&
    settings.promptConfig?.postHistoryPrompt
  ) {
    postHistoryContent += replaceMacros(settings.promptConfig.postHistoryPrompt, macroParams);
  }

  // Append character card's specific post history instructions if defined
  if (character.post_history_instructions) {
    const charPostHistory = replaceMacros(character.post_history_instructions, macroParams);
    if (postHistoryContent) {
      postHistoryContent += `\n\n${charPostHistory}`;
    } else {
      postHistoryContent = charPostHistory;
    }
  }

  let postHistorySection = "";
  if (postHistoryContent) {
    postHistorySection = formatSectionText("postHistory", "", postHistoryContent, true);
  }

  // 7. Core custom story sequence compiler! Natively supports standard SillyTavern order template!
  const personalityBlock = "{{personality}}";
  const descriptionBlock = "{{description}}";
  const scenarioBlock = "{{scenario}}";

  let compiledStory =
    settings.promptConfig?.storyString ||
    `{{system_prompt}}

${personalityBlock}

${descriptionBlock}

${scenarioBlock}

{{mes_example}}

{{char_system}}`;

  let dynamicSystemExtension = `{{post_history}}`;

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
      () => `${topSection}\n{{system_prompt}}`,
    );
  }
  if (beforeCharSection) {
    compiledStory = compiledStory.replace(
      /\{\{personality\}\}/gi,
      () => `${beforeCharSection}\n{{personality}}`,
    );
  }

  // Substitute all fields in Static Story using replacer functions to prevent '$' symbol interpretation collapse
  compiledStory = compiledStory
    .replace(/\{\{system_prompt\}\}/gi, () => mainPromptReplaced + userPersonaSection)
    .replace(/\{\{personality\}\}/gi, () => personalityVal)
    .replace(/\{\{description\}\}/gi, () => descriptionVal)
    .replace(/\{\{char_description\}\}/gi, () => descriptionVal)
    .replace(/\{\{scenario\}\}/gi, () => scenarioVal)
    .replace(/\{\{char_scenario\}\}/gi, () => scenarioVal)
    .replace(/\{\{char_system\}\}/gi, () => charSpecificPrompt)
    .replace(/\{\{mes_example\}\}/gi, () => mesExampleSection)
    .replace(/\{\{example_dialogue\}\}/gi, () => mesExampleSection)
    .replace(/\{\{diags\}\}/gi, () => mesExampleSection);

  // Compile summaries, lorebook entries, and jailbreak inside the main System message (SillyTavern style).
  // If placeholders are present, replace them; otherwise append to prevent data loss.
  if (compiledStory.toLowerCase().includes("{{summaries}}")) {
    compiledStory = compiledStory.replace(/\{\{summaries\}\}/gi, () => summarySection);
  } else if (summarySection) {
    compiledStory = compiledStory + `\n\n${summarySection}`;
  }

  if (compiledStory.toLowerCase().includes("{{lorebook_entries}}") || compiledStory.toLowerCase().includes("{{wi}}")) {
    compiledStory = compiledStory
      .replace(/\{\{lorebook_entries\}\}/gi, () => afterCharSection)
      .replace(/\{\{wi\}\}/gi, () => afterCharSection);
  } else if (afterCharSection) {
    compiledStory = compiledStory + `\n\n${afterCharSection}`;
  }

  if (compiledStory.toLowerCase().includes("{{jailbreak}}")) {
    compiledStory = compiledStory.replace(/\{\{jailbreak\}\}/gi, () => jailbreakSection);
  } else if (jailbreakSection) {
    compiledStory = compiledStory + `\n\n${jailbreakSection}`;
  }

  // Remove {{post_history}} placeholder from static story since it is injected at the bottom of message history
  compiledStory = compiledStory.replace(/\{\{post_history\}\}/gi, "");

  // Clean repeating double newlines left by empty sections
  const systemInstruction = compiledStory.replace(/\n{3,}/g, "\n\n").trim();

  // Substitute all fields in Dynamic Extension (which now only maps post_history) using replacer function
  dynamicSystemExtension = dynamicSystemExtension
    .replace(/\{\{post_history\}\}/gi, () => postHistorySection);
    
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
      (m) => m.sender !== "system"
    );
    const firstMsg = validChatMessages[0];
    const isFirstMsgGreeting = firstMsg && firstMsg.sender === "assistant";

    if (validChatMessages.length > recentTurns) {
      if (isFirstMsgGreeting) {
        activeMessagesToSend = [
          firstMsg,
          ...validChatMessages.slice(-(recentTurns - 1))
        ];
      } else {
        activeMessagesToSend = validChatMessages.slice(-recentTurns);
      }
    } else {
      activeMessagesToSend = validChatMessages;
    }
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
