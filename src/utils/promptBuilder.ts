import {
  CharacterCard,
  ChatSession,
  LorebookEntry,
  UserSettings,
  Message,
} from "../types";

/**
 * Clean name to strictly adhere to OpenAI's naming regular expression: ^[a-zA-Z0-9_-]{1,64}$
 */
export function cleanNameForApi(name: string | undefined, fallback: string): string | undefined {
  if (!name) return undefined;
  let cleaned = name.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!cleaned) {
    return fallback;
  }
  return cleaned.slice(0, 64);
}

/**
 * High-precision lightweight Token estimator for CJK characters and ASCII words.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let asciiCount = 0;
  let nonAsciiCount = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) <= 127) {
      asciiCount++;
    } else {
      nonAsciiCount++;
    }
  }
  return Math.ceil(asciiCount * 0.25 + nonAsciiCount * 1.0);
}

/**
 * Searches for active worldbook (lorebook) keywords in text.
 * Implements SillyTavern-compatible recursive scanning (max 3 passes) to handle级联 triggers.
 */
export function getTriggeredLorebookEntries(
  messages: Message[],
  userInput: string,
  entries: LorebookEntry[],
  maxRecursionDepth: number = 3
): LorebookEntry[] {
  if (!entries || entries.length === 0) return [];
  const activeEntries: LorebookEntry[] = [];
  const activeIds = new Set<string>();

  // Contents of triggered entries accumulated across passes to enable recursive cascade triggering
  let recursionTextAppend = "";

  let currentPass = 0;
  let newTriggeredInLastPass = true;

  const scanTextCache = new Map<number, string>();
  const getScanText = (depth: number): string => {
    let baseText = "";
    if (scanTextCache.has(depth)) {
      baseText = scanTextCache.get(depth)!;
    } else {
      const scanMessages = messages ? messages.slice(-depth) : [];
      baseText = userInput + "\n" + scanMessages.map((m) => m.content).join("\n");
      if (baseText.length > 8000) {
        baseText = baseText.slice(-8000);
      }
      scanTextCache.set(depth, baseText);
    }
    return recursionTextAppend ? `${baseText}\n${recursionTextAppend}` : baseText;
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

  while (newTriggeredInLastPass && currentPass < maxRecursionDepth) {
    newTriggeredInLastPass = false;
    currentPass++;

    for (const entry of entries) {
      if (!entry.enabled || !entry.content || activeIds.has(entry.id)) continue;

      if (entry.constant) {
        activeEntries.push(entry);
        activeIds.add(entry.id);
        recursionTextAppend += "\n" + entry.content;
        newTriggeredInLastPass = true;
        continue;
      }

      // Determine scanning depth (how many recent messages to inspect)
      const scanDepth = entry.scanDepth !== undefined ? entry.scanDepth : 10;
      if (scanDepth === 0) continue; 
      
      const scanText = getScanText(scanDepth);

      // Base Hit Check (Primary Keys)
      const primaryKeys = Array.isArray(entry.keys) ? entry.keys : [];
      const primaryMatched = primaryKeys.some((key) => checkMatch(key, !!entry.useRegex, !!entry.caseSensitive, scanText));
      if (!primaryMatched) continue;

      // Secondary Keys Logic Eval
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

      // Roll trigger probability (0-100, default 100)
      const prob = entry.probability !== undefined ? entry.probability : 100;
      if (prob < 100 && Math.random() * 100 > prob) {
        continue;
      }
      
      activeEntries.push(entry);
      activeIds.add(entry.id);
      recursionTextAppend += "\n" + entry.content;
      newTriggeredInLastPass = true;
    }
  }

  // Enforce cumulative character budget to prevent prompt overflow
  const BUDGET_LIMIT = 6000;
  let currentLength = 0;
  const budgetedEntries: LorebookEntry[] = [];
  for (const entry of activeEntries) {
    const len = entry.content ? entry.content.length : 0;
    if (len > BUDGET_LIMIT) {
      console.warn(`[promptBuilder] Lorebook entry "${entry.id}" alone exceeds prompt budget limit of ${BUDGET_LIMIT} chars, skipped.`);
      continue;
    }
    if (currentLength + len <= BUDGET_LIMIT) {
      budgetedEntries.push(entry);
      currentLength += len;
    } else {
      console.warn(`[promptBuilder] Lorebook entry "${entry.id}" skipped due to prompt budget limit (${BUDGET_LIMIT} chars)`);
      continue;
    }
  }

  return budgetedEntries;
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
      const validChatMessages = totalRawMessages;
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

    const rawHistory = activeMessagesToSend.map((msg) => {
      let role: "user" | "model" | "assistant" = "user";
      let content = msg.content;
      const name = msg.sender === "assistant"
        ? cleanNameForApi(character.name, "char")
        : (msg.sender === "user" ? cleanNameForApi(settings.userName, "user") : undefined);

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
      } else if (msg.sender === "system") {
        role = "user";
        content = `[系统旁白: ${msg.content}]`;
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
        name,
        content,
      };
    });

    const chatHistory: typeof rawHistory = [];
    for (const item of rawHistory) {
      if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === item.role) {
        chatHistory[chatHistory.length - 1].content += "\n\n" + item.content;
      } else {
        chatHistory.push({
          role: item.role,
          name: item.name,
          content: item.content,
        });
      }
    }

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

    const modelName = (settings.api?.modelName || "").toLowerCase();
    const isDeepSeek = modelName.includes("deepseek");
    const reasoningGuidance = isDeepSeek
      ? "\n\n[System Note: AI should perform objective, logical analysis inside <think> tags in a solver perspective (e.g. analyzing user intentions, character traits, and plan next actions), rather than roleplaying, chatting, or generating dialogue prefixes inside <think>.]\n"
      : "";

    return {
      systemInstruction: (cleanSystem.trim() + reasoningGuidance).trim(),
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

  const modelName = (settings.api?.modelName || "").toLowerCase();
  const enableCacheOptimization = modelName.includes("deepseek") || modelName.includes("gemini");

  // 为 DeepSeek 等推理模型注入系统引导说明，防止其思维链被角色扮演污染，确保其在 <think> 标签中执行客观推理而非生成台词
  const isDeepSeek = modelName.includes("deepseek");
  const reasoningGuidance = isDeepSeek
    ? "\n\n[System Note: AI should perform objective, logical analysis inside <think> tags in a solver perspective (e.g. analyzing user intentions, character traits, and plan next actions), rather than roleplaying, chatting, or generating dialogue prefixes inside <think>.]\n"
    : "";

  const processedActiveEntries = enableCacheOptimization
    ? activeEntries.map((e) => {
        if (e.position === "in_chat" || e.position === "before_last_mes") {
          return { ...e, position: "after_char_def" as const };
        }
        return e;
      })
    : activeEntries;

  // Sort them into physical location buckets
  const topEntries = processedActiveEntries.filter((e) => e.position === "top");
  const beforeCharEntries = processedActiveEntries.filter(
    (e) => e.position === "before_char_def",
  );
  const afterCharEntries = processedActiveEntries.filter(
    (e) => e.position === "after_char_def" || !e.position,
  );
  const beforeLastMsgEntries = processedActiveEntries.filter(
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
    // Sort matching SillyTavern behavior:
    // 1. Depth desc (larger depth placed earlier/higher in the prompt)
    // 2. Order asc (smaller order placed earlier/higher in the prompt)
    const sorted = [...entries].sort((a, b) => {
      const depthA = a.depth !== undefined ? a.depth : 4;
      const depthB = b.depth !== undefined ? b.depth : 4;
      if (depthB !== depthA) {
        return depthB - depthA;
      }
      const orderA = a.order !== undefined ? a.order : 100;
      const orderB = b.order !== undefined ? b.order : 100;
      return orderA - orderB;
    });
    return sorted.map((e) => formatEntryContent(e)).join("\n\n");
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

  // 3.5 表格记忆（记忆档案柜）上下文注入
  let tableMemorySection = "";
  if (settings.enableTableMemory && chat.tableMemory && chat.tableMemory.length > 0) {
    const activeSheets = chat.tableMemory.filter(s => s.enable);
    if (activeSheets.length > 0) {
      const sheetsMarkdown = activeSheets.map(sheet => {
        const title = `### 表格：${sheet.name}`;
        const desc = sheet.description ? `*用途说明: ${sheet.description}*` : "";
        const header = `| ${sheet.columns.join(" | ")} |`;
        const divider = `| ${sheet.columns.map(() => "---").join(" | ")} |`;
        const rows = sheet.rows.map(row => `| ${row.join(" | ")} |`).join("\n");
        return `${title}\n${desc}\n${header}\n${divider}\n${rows}`;
      }).join("\n\n");

      const systemGuidance = `=== 🎯 长期状态与记忆档案柜 ===
以下是当前扮演会话中记录的结构化状态与记忆表格。
在生成下一轮扮演回复时，请根据聊天发展，在回复内容的【最末尾】输出更新指令伪代码（由你自主决定是否更新，只能包含合法可执行的代码，不要添加多余文字解释），指令格式如下：
- 若更新已有属性：updateRow("表格名", {"属性名": "要修改的值"}) 或者特定定位 updateRow("表格名", {"查找列名": "查找值"}, {"要修改的列名": "新值"})
- 若新增属性/记录：insertRow("表格名", {"列1": "值1", "列2": "值2"})
- 若删除属性/记录：deleteRow("表格名", {"定位列": "值"})
指令示例（必须单独占行，置于你的回复文本最末尾）：
updateRow("好感关系表", {"好感度": "85", "当前关系": "心动"})

当前数据表格内容如下：
${sheetsMarkdown}
==================================`;
      tableMemorySection = formatSectionText("tableMemory", "", systemGuidance, true);
    }
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

  if (compiledStory.toLowerCase().includes("{{table_memory}}")) {
    compiledStory = compiledStory.replace(/\{\{table_memory\}\}/gi, () => tableMemorySection);
  } else if (compiledStory.toLowerCase().includes("{{tablememory}}")) {
    compiledStory = compiledStory.replace(/\{\{tablememory\}\}/gi, () => tableMemorySection);
  } else if (tableMemorySection) {
    compiledStory = compiledStory + `\n\n${tableMemorySection}`;
  }

  // Remove {{post_history}} placeholder from static story since it is injected at the bottom of message history
  compiledStory = compiledStory.replace(/\{\{post_history\}\}/gi, "");

  // Clean repeating double newlines left by empty sections
  const systemInstruction = compiledStory.replace(/\n{3,}/g, "\n\n").trim();

  // Substitute all fields in Dynamic Extension (which now only maps post_history) using replacer function
  dynamicSystemExtension = dynamicSystemExtension
    .replace(/\{\{post_history\}\}/gi, () => postHistorySection);
    
  const dynamicInstruction = dynamicSystemExtension.replace(/\n{3,}/g, "\n\n").trim();

  // 8. Gather Recent Full Messages and enforce safe token limits via sliding window
  const { recentTurns } = settings.memory;
  const totalRawMessages = chat.messages ? [...chat.messages] : [];
  const validChatMessages = totalRawMessages;

  const SAFE_CONTEXT_LIMIT = 12000;
  let currentTurns = Math.min(recentTurns, validChatMessages.length);
  let activeMessagesToSend: Message[] = [];
  let chatHistory: { role: "user" | "model" | "assistant"; name?: string; content: string }[] = [];

  while (currentTurns > 0) {
    const firstMsg = validChatMessages[0];
    const isFirstMsgGreeting = firstMsg && firstMsg.sender === "assistant";

    if (validChatMessages.length > currentTurns) {
      if (isFirstMsgGreeting) {
        activeMessagesToSend = [
          firstMsg,
          ...validChatMessages.slice(-(currentTurns - 1))
        ];
      } else {
        activeMessagesToSend = validChatMessages.slice(-currentTurns);
      }
    } else {
      activeMessagesToSend = validChatMessages;
    }

    // Convert Message[] to Gemini or OpenAI structure, applying custom Instruct prefix/suffix templates (e.g. ChatML/Alpaca)
    const rawHistory = activeMessagesToSend.map((msg) => {
      let role: "user" | "model" | "assistant" = "user";
      let content = msg.content;
      const name = msg.sender === "assistant"
        ? cleanNameForApi(character.name, "char")
        : (msg.sender === "user" ? cleanNameForApi(settings.userName, "user") : undefined);

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
      } else if (msg.sender === "system") {
        role = "user";
        content = `[系统旁白: ${msg.content}]`;
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
        name,
        content,
      };
    });

    chatHistory = [];
    for (const item of rawHistory) {
      if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === item.role) {
        chatHistory[chatHistory.length - 1].content += "\n\n" + item.content;
      } else {
        chatHistory.push({
          role: item.role,
          name: item.name,
          content: item.content,
        });
      }
    }

    // Create a temporary copy to perform injections and estimate tokens
    const tempHistory = chatHistory.map((h) => ({ ...h }));

    // Apply "in_chat" entries injected by depth into the history (only if not cache-optimized)
    const inChatEntries = processedActiveEntries.filter(
      (e) => e.position === "in_chat"
    );
    const inChatMap = new Map<number, LorebookEntry[]>();
    inChatEntries.forEach((entry) => {
      const depth = entry.depth !== undefined ? entry.depth : 4;
      let targetIdx = Math.max(0, tempHistory.length - (depth > 0 ? depth : 1));
      if (targetIdx >= tempHistory.length) targetIdx = tempHistory.length - 1;

      if (!inChatMap.has(targetIdx)) {
        inChatMap.set(targetIdx, []);
      }
      inChatMap.get(targetIdx)!.push(entry);
    });

    inChatMap.forEach((entries, targetIdx) => {
      entries.sort((a, b) => (a.order || 100) - (b.order || 100));
      if (tempHistory[targetIdx]) {
        const mergedContent = entries.map((e) => formatEntryContent(e)).join("\n\n");
        tempHistory[targetIdx].content = `${mergedContent}\n\n${tempHistory[targetIdx].content}`;
      }
    });

    // Apply "before_last_mes" as well directly to chatHistory so it actually works properly.
    const loopBeforeLastMsgEntries = processedActiveEntries.filter(
      (e) => e.position === "before_last_mes"
    );
    if (loopBeforeLastMsgEntries.length > 0 && tempHistory.length > 0) {
      const targetIdx = tempHistory.length - 1;
      loopBeforeLastMsgEntries.sort((a, b) => (a.order || 100) - (b.order || 100));
      const beforeLastText = formatEntryBlock(loopBeforeLastMsgEntries);
      tempHistory[targetIdx].content = `${beforeLastText}\n\n${tempHistory[targetIdx].content}`;
    }

    // Estimate total tokens
    const historyTokens = tempHistory.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
    const prefixTokens = estimateTokens(systemInstruction) + estimateTokens(dynamicInstruction) + estimateTokens(userInput);
    const totalTokens = prefixTokens + historyTokens;

    if (totalTokens <= SAFE_CONTEXT_LIMIT || currentTurns === 1) {
      chatHistory = tempHistory;
      break;
    }

    currentTurns--;
  }

  return {
    systemInstruction: (systemInstruction + reasoningGuidance).trim(),
    dynamicInstruction,
    history: chatHistory,
    userInput,
  };
}
