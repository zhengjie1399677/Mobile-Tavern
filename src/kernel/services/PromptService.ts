import { IPromptService, IKernel, KernelServices } from "../types";
import { CharacterCard, ChatSession, UserSettings, LorebookEntry, Message } from "../../types";
import { DEFAULT_REPLY_SUGGESTIONS_PROMPT } from "../../defaults/suggestionsPrompt";
import {
  DEFAULT_REASONING_GUIDANCE_PROMPT,
  DEFAULT_TABLE_MEMORY_PROMPT,
} from "../../defaults/promptTemplates";
import { PromptBuilder } from "./prompt/PromptBuilder";
import { PromptCompiler } from "./prompt/PromptCompiler";
import { RuntimeContext } from "./prompt/types";
import { ModelCapabilityRegistry } from "./memory/ModelCapabilityRegistry";

export class PromptService implements IPromptService {
  name = "prompt";
  private kernel!: IKernel;
  // P1-1/P1-2: 服务级 AbortController（纯计算服务，主要用于契约一致性）
  private abortController: AbortController | null = null;

  init(kernel: IKernel, signal?: AbortSignal): void {
    this.kernel = kernel;
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener("abort", () => this.abortController?.abort());
    }
  }

  // P1-2: 销毁时清理 abort 控制器
  destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  cleanNameForApi(name: string | undefined, fallback: string): string | undefined {
    if (!name) return undefined;
    let cleaned = name.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!cleaned) {
      return fallback;
    }
    return cleaned.slice(0, 64);
  }

  estimateTokens(text: string): number {
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

  sanitizeName(name: string): string {
    if (!name) return "";
    let sanitized = name.replace(/[^a-zA-Z0-9_-]/g, "_");
    sanitized = sanitized.replace(/^[^a-zA-Z0-9_-]+/, "");
    sanitized = sanitized.slice(0, 64);
    return /^[a-zA-Z0-9_-]+$/.test(sanitized) ? sanitized : "";
  }

  getTriggeredLorebookEntries(
    messages: Message[],
    userInput: string,
    entries: LorebookEntry[],
    maxRecursionDepth: number = 3
  ): LorebookEntry[] {
    if (!entries || entries.length === 0) return [];
    const activeEntries: LorebookEntry[] = [];
    const activeIds = new Set<string>();

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

        const scanDepth = entry.scanDepth !== undefined ? entry.scanDepth : 10;
        if (scanDepth === 0) continue;

        const scanText = getScanText(scanDepth);

        const primaryKeys = Array.isArray(entry.keys) ? entry.keys : [];
        const primaryMatched = primaryKeys.some((key) => checkMatch(key, !!entry.useRegex, !!entry.caseSensitive, scanText));
        if (!primaryMatched) continue;

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

    const BUDGET_LIMIT = 6000;
    let currentLength = 0;
    const budgetedEntries: LorebookEntry[] = [];
    for (const entry of activeEntries) {
      const len = entry.content ? entry.content.length : 0;
      if (len > BUDGET_LIMIT) {
        console.warn(`[PromptService] Lorebook entry "${entry.id}" alone exceeds prompt budget limit of ${BUDGET_LIMIT} chars, skipped.`);
        continue;
      }
      if (currentLength + len <= BUDGET_LIMIT) {
        budgetedEntries.push(entry);
        currentLength += len;
      } else {
        console.warn(`[PromptService] Lorebook entry "${entry.id}" skipped due to prompt budget limit (${BUDGET_LIMIT} chars)`);
        continue;
      }
    }

    return budgetedEntries;
  }

  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }



  replaceMacros(
    text: string,
    params: {
      char: string;
      user: string;
      description: string;
      personality: string;
      scenario: string;
      userPersona?: string;
      mes_example?: string;
    }
  ): string {
    if (!text) return "";

    // 容错与归一化：防范并自动修正用户或角色卡中常见的宏拼写错误（如 {charr}}、{{charr}}、{char}、{user} 等）
    const cleanedText = text
      .replace(/\{+charr?\}+/gi, "{{char}}")
      .replace(/\{+chara?\}+/gi, "{{char}}")
      .replace(/\{+user_name\}+/gi, "{{user}}")
      .replace(/\{+user\}+/gi, "{{user}}");

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

    return cleanedText.replace(/\{\{([a-zA-Z0-9_]+)\}\}/gi, (match, key) => {
      const lowerKey = key.toLowerCase();
      return macroMap[lowerKey] !== undefined ? macroMap[lowerKey] : match;
    });
  }

  assemblePrompt(params: {
    character: CharacterCard;
    chat: ChatSession;
    userInput: string;
    settings: UserSettings;
    globalLorebook?: LorebookEntry[];
    recalledMemories?: any[];
  }): {
    systemInstruction: string;
    history: Array<{ role: "model" | "user" | "assistant"; name?: string; content: string }>;
    dynamicInstruction: string;
    userInput?: string;
    messages?: Array<{ role: "system" | "user" | "assistant"; name?: string; content: string }>;
  } {
    const { character, chat, userInput, settings, globalLorebook = [], recalledMemories = [] } = params;

    console.log("[PromptService Debug] chat messages in compiler:", JSON.stringify((chat.messages || []).map(m => ({ id: m.id, sender: m.sender, content: m.content }))));

    const macroParams = {
      char: character.name,
      user: settings.userName || "user",
      description: character.description || "无",
      personality: character.personality || "无",
      scenario: character.scenario || "无",
      userPersona: settings.userInfo || "无",
      mes_example: character.mes_example || "",
    };

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

      const lastUserMsgIdx = (() => {
        for (let i = activeMessagesToSend.length - 1; i >= 0; i--) {
          if (activeMessagesToSend[i].sender !== "assistant") {
            return i;
          }
        }
        return -1;
      })();

      const rawHistory = activeMessagesToSend.map((msg, idx) => {
        let role: "user" | "model" | "assistant" = "user";
        let content = msg.content;
        const name = msg.sender === "assistant"
          ? this.cleanNameForApi(character.name, "char")
          : (msg.sender === "user" ? this.cleanNameForApi(settings.userName, "user") : undefined);

        if (msg.sender === "assistant") {
          role = settings.api.type === "openai-compat" ? "assistant" : "model";
          if (settings.promptConfig?.instructTemplate !== "default") {
            const prefix = this.replaceMacros(
              settings.promptConfig?.assistantPrefix || "",
              macroParams,
            );
            const suffix = this.replaceMacros(
              settings.promptConfig?.assistantSuffix || "",
              macroParams,
            );
            content = `${prefix}${content}${suffix}`;
          } else {
            // Keep content clean without prepending name to prevent script format biasing
          }
        } else if (msg.sender === "system") {
          role = "user";
          content = msg.content;
        } else {
          role = "user";
          let msgContent = msg.content;
          if (settings.promptConfig?.instructTemplate !== "default") {
            const prefix = this.replaceMacros(
              settings.promptConfig?.userPrefix || "",
              macroParams,
            );
            const suffix = this.replaceMacros(
              settings.promptConfig?.userSuffix || "",
              macroParams,
            );
            content = `${prefix}${msgContent}${suffix}`;
          } else {
            content = msgContent;
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
        cleanSystem += `${this.replaceMacros(character.system_prompt, macroParams)}\n\n`;
      }
      if (settings.userInfo) {
        cleanSystem += `=== User Persona ===\n${this.replaceMacros(settings.userInfo, macroParams)}\n\n`;
      }

      const allEntries = [...(character.lorebookEntries || []), ...globalLorebook];
      const activeEntries = this.getTriggeredLorebookEntries(
        chat.messages || [],
        userInput,
        allEntries,
      );

      if (activeEntries.length > 0) {
        cleanSystem += `=== Reference Lore ===\n${activeEntries.map((e) => e.content).join("\n\n")}\n\n`;
      }

      const modelName = (settings.api?.modelName || "").toLowerCase();
      const isDeepSeek = modelName.includes("deepseek") || modelName.includes("r1") || modelName.includes("reasoner");
      const enableGuidance = settings.promptConfig?.enableReasoningGuidance !== undefined
        ? settings.promptConfig.enableReasoningGuidance
        : isDeepSeek;
      const reasoningGuidance = enableGuidance
        ? `\n\n${settings.promptConfig?.reasoningGuidancePrompt || DEFAULT_REASONING_GUIDANCE_PROMPT}\n`
        : "";

      let finalSystem = cleanSystem.trim();
      if (settings.enableReplySuggestions) {
        finalSystem += `\n\n${settings.replySuggestionsPrompt || DEFAULT_REPLY_SUGGESTIONS_PROMPT}`;
      }

      return {
        systemInstruction: (finalSystem + reasoningGuidance).trim(),
        dynamicInstruction: "",
        history: chatHistory,
        userInput,
      };
    }

    // Roleplay Mode = True (Default)
    let repetitionDetected = false;
    if (chat.messages && chat.messages.length >= 4) {
      const assistantMsgs = chat.messages.filter((m) => m.sender === "assistant");
      if (assistantMsgs.length >= 2) {
        const last = assistantMsgs[assistantMsgs.length - 1].content.trim();
        const prev = assistantMsgs[assistantMsgs.length - 2].content.trim();
        if (last === prev && last.length > 0) {
          repetitionDetected = true;
        }
      }
    }

    const context: RuntimeContext = {
      settings,
      modelCapabilities: {},
      enabledFeatures: {
        tableMemory: !!settings.enableTableMemory,
        replySuggestions: !!settings.enableReplySuggestions,
        memoryRecall: recalledMemories && recalledMemories.length > 0,
      },
      repetitionDetected,
    };

    const builder = new PromptBuilder();

    // ==================================================
    // 1. ENGINE Category (Instruction, mutable: false)
    // ==================================================
    let mainPromptReplaced = "";
    if (settings.promptConfig?.mainPrompt) {
      mainPromptReplaced = this.replaceMacros(settings.promptConfig.mainPrompt, macroParams);
    }
    const hasCustomPrompts = settings.promptConfig?.customPrompts && settings.promptConfig.customPrompts.length > 0;
    const activeCustomBlocks = hasCustomPrompts ? settings.promptConfig.customPrompts!.filter((p) => p.enabled) : [];
    if (activeCustomBlocks.length > 0) {
      const compiledBlocks = activeCustomBlocks.map((block) => this.replaceMacros(block.content, macroParams)).join("\n\n");
      mainPromptReplaced = mainPromptReplaced ? `${mainPromptReplaced}\n\n${compiledBlocks}` : compiledBlocks;
    }

    builder.registerSection({
      id: "core_rules",
      phase: "Engine",
      enabled: !!mainPromptReplaced,
      compile: () => ({
        id: "core_rules",
        phase: "Engine",
        type: "Instruction",
        priority: "Highest",
        mutable: false,
        title: "Core Rules",
        content: mainPromptReplaced,
      }),
    });

    // ==================================================
    // 2. CONTEXT Category (Context, mixed mutability)
    // ==================================================
    let userPersonaSection = "";
    if (settings.userInfo) {
      userPersonaSection = this.replaceMacros(settings.userInfo, macroParams);
    }
    builder.registerSection({
      id: "user_persona",
      phase: "Context",
      enabled: !!userPersonaSection,
      compile: () => ({
        id: "user_persona",
        phase: "Context",
        type: "Context",
        priority: "High",
        mutable: false,
        title: "User Persona",
        content: userPersonaSection,
      }),
    });

    const descriptionVal = this.replaceMacros(character.description || "", macroParams);
    const personalityVal = this.replaceMacros(character.personality || "", macroParams);
    const charPersonaContent = [
      descriptionVal ? `=== Character Description ===\n${descriptionVal}` : "",
      personalityVal ? `=== Character Personality ===\n${personalityVal}` : ""
    ].filter(Boolean).join("\n\n");

    builder.registerSection({
      id: "char_persona",
      phase: "Context",
      enabled: !!charPersonaContent,
      compile: () => ({
        id: "char_persona",
        phase: "Context",
        type: "Context",
        priority: "High",
        mutable: false,
        title: "Character Persona",
        content: charPersonaContent,
      }),
    });

    const scenarioVal = this.replaceMacros(character.scenario || "", macroParams);
    builder.registerSection({
      id: "char_scenario",
      phase: "Context",
      enabled: !!scenarioVal,
      compile: () => ({
        id: "char_scenario",
        phase: "Context",
        type: "Context",
        priority: "High",
        mutable: false,
        title: "Scenario",
        content: scenarioVal,
      }),
    });

    let charSpecificPrompt = "";
    if (character.system_prompt) {
      charSpecificPrompt = this.replaceMacros(character.system_prompt, macroParams);
    }
    builder.registerSection({
      id: "char_specific_prompt",
      phase: "Context",
      enabled: !!charSpecificPrompt,
      compile: () => ({
        id: "char_specific_prompt",
        phase: "Context",
        type: "Context",
        priority: "High",
        mutable: false,
        title: "Character Specific Prompt",
        content: charSpecificPrompt,
      }),
    });

    const allEntries = [...(character.lorebookEntries || []), ...globalLorebook];
    const activeEntries = this.getTriggeredLorebookEntries(chat.messages || [], userInput, allEntries);
    const formatEntryContent = (entry: LorebookEntry): string => {
      if (entry.addMemo && entry.comment) {
        return `[设定及备注: ${entry.comment}]\n${entry.content}`;
      }
      return entry.content;
    };
    const formatEntryBlock = (entriesBlock: LorebookEntry[]): string => {
      if (entriesBlock.length === 0) return "";
      const sorted = [...entriesBlock].sort((a, b) => {
        const depthA = a.depth !== undefined ? a.depth : 4;
        const depthB = b.depth !== undefined ? b.depth : 4;
        if (depthB !== depthA) return depthB - depthA;
        const orderA = a.order !== undefined ? a.order : 100;
        const orderB = b.order !== undefined ? b.order : 100;
        return orderA - orderB;
      });
      return sorted.map((e) => formatEntryContent(e)).join("\n\n");
    };
    const lorebookText = formatEntryBlock(activeEntries);

    builder.registerSection({
      id: "lorebook",
      phase: "Context",
      enabled: !!lorebookText,
      compile: () => ({
        id: "lorebook",
        phase: "Context",
        type: "Context",
        priority: "Normal",
        mutable: true,
        title: "Reference Lore",
        content: lorebookText,
      }),
    });

    // ==================================================
    // 3. GENERATION Category (Style/Constraints, mutable: false)
    // ==================================================
    let jailbreakSection = "";
    if (settings.promptConfig?.useJailbreak && settings.promptConfig?.jailbreakPrompt) {
      jailbreakSection = this.replaceMacros(settings.promptConfig.jailbreakPrompt, macroParams);
    }
    builder.registerSection({
      id: "jailbreak",
      phase: "Generation",
      enabled: !!jailbreakSection,
      compile: () => ({
        id: "jailbreak",
        phase: "Generation",
        type: "Instruction",
        priority: "High",
        mutable: false,
        title: "Jailbreak",
        content: jailbreakSection,
      }),
    });

    // ==================================================
    // 4. MEMORY Sub-category (under Context Category, mutable: true)
    // ==================================================
    let summaryText = "";
    if (chat.summaries && chat.summaries.length > 0) {
      // 仅保留最新的最多 5 条总结卡片，防止长线对话发包体积雪崩
      const limit = 5;
      const recentSummaries = chat.summaries.slice(-limit);
      summaryText = recentSummaries
        .map((s) => `[${s.timeTag} | ${s.location}] ${s.content}`)
        .join("\n");
    }
    builder.registerSection({
      id: "summary",
      phase: "Context",
      enabled: !!summaryText,
      compile: () => ({
        id: "summary",
        phase: "Context",
        type: "Context",
        priority: "High",
        mutable: true,
        title: "Story Timeline Summary",
        content: summaryText,
      }),
    });

    let tableMemorySection = "";
    if (settings.enableTableMemory) {
      let activeSheets = chat.tableMemory || [];
      if (activeSheets.length === 0) {
        const memoryService = this.kernel.getService<any>(KernelServices.Memory);
        if (memoryService) {
          activeSheets = memoryService.getStateTable().initDefaultSheets(character.name || "char");
        }
      }
      const enabledSheets = activeSheets.filter(s => s.enable);
      if (enabledSheets.length > 0) {
        tableMemorySection = enabledSheets.map(sheet => {
          const title = `### 表格：${sheet.name}`;
          const desc = sheet.description ? `*用途说明: ${sheet.description}*` : "";
          const header = `| ${sheet.columns.join(" | ")} |`;
          const divider = `| ${sheet.columns.map(() => "---").join(" | ")} |`;
          const rows = sheet.rows.map(row => `| ${row.join(" | ")} |`).join("\n");
          return `${title}\n${desc}\n${header}\n${divider}\n${rows}`;
        }).join("\n\n");
      }
    }
    builder.registerSection({
      id: "table_memory",
      phase: "Context",
      enabled: !!tableMemorySection,
      compile: () => ({
        id: "table_memory",
        phase: "Context",
        type: "Context",
        priority: "Normal",
        mutable: true,
        title: "Table Memory",
        content: tableMemorySection,
      }),
    });

    // ==================================================
    // 4b. MVU Variables Section (under Context Category, mutable: true)
    // ==================================================
    let mvuVariablesSection = "";
    if (settings.enableScriptExecution && chat.variables) {
      mvuVariablesSection = this.formatMvuVariablesForPrompt(chat.variables);
    }
    builder.registerSection({
      id: "mvu_variables",
      phase: "Context",
      enabled: !!mvuVariablesSection,
      compile: () => ({
        id: "mvu_variables",
        phase: "Context",
        type: "Context",
        priority: "High",
        mutable: true,
        title: "Variables State",
        content: mvuVariablesSection,
      }),
    });

    let recalledMemoriesSection = "";
    if (recalledMemories && recalledMemories.length > 0) {
      recalledMemoriesSection = recalledMemories
        .map((m: any) => `[第 ${m.turnIndex} 轮 - ${m.role === 'user' ? '用户' : '角色'}]: ${m.content}`)
        .join("\n");
    }
    builder.registerSection({
      id: "recalled_memories",
      phase: "Context",
      enabled: !!recalledMemoriesSection,
      compile: () => ({
        id: "recalled_memories",
        phase: "Context",
        type: "Context",
        priority: "Low",
        mutable: true,
        title: "Relevant Memories",
        content: recalledMemoriesSection,
      }),
    });

    // ==================================================
    // 5. PROTOCOL Category (Structured schemas, mutable: false)
    // ==================================================
    let memoryExtractionSection = "";
    if (settings.memory) {
      memoryExtractionSection = `要求根据输出示例，在 <memory_extraction> 标签对应的位置提取本轮的新实体和事件，以帮助系统记录故事发展。
格式要求：使用 <memory_extraction> 标签包裹一个极简的 JSON 对象，其中只能包含 "entities" 和 "events" 字段。必须是合法 JSON，不要添加任何多余文字。
(注意：entities 和 events 均使用简单的一维字符串数组，不要嵌套复杂的对象！若本轮无新内容则输出空数组。)`;
    }
    builder.registerSection({
      id: "memory_extraction",
      phase: "Protocol",
      enabled: !!memoryExtractionSection,
      compile: () => ({
        id: "memory_extraction",
        phase: "Protocol",
        type: "Instruction",
        priority: "Normal",
        mutable: false,
        title: "Memory Extraction Protocol",
        content: memoryExtractionSection,
      }),
    });

    let suggestionsSection = "";
    if (settings.enableReplySuggestions) {
      suggestionsSection = `${settings.replySuggestionsPrompt || DEFAULT_REPLY_SUGGESTIONS_PROMPT}`;
    }
    builder.registerSection({
      id: "reply_suggestions",
      phase: "Protocol",
      enabled: !!suggestionsSection,
      compile: () => ({
        id: "reply_suggestions",
        phase: "Protocol",
        type: "Instruction",
        priority: "Normal",
        mutable: false,
        title: "Reply Suggestions Protocol",
        content: suggestionsSection,
      }),
    });

    let outputExampleContent = "";
    outputExampleContent += "<center>\n用户看见的消息输出到这里。\n</center>\n";
    if (settings.enableReplySuggestions) {
      outputExampleContent += "\n<suggestions>\n[\"选项A\", \"选项B\", \"选项C\", \"选项D\"]\n</suggestions>\n";
    }
    if (settings.memory) {
      outputExampleContent += `\n<memory_extraction>
{
  "entities": ["新出现的人物、地点、或物品等"],
  "events": [
    "任务进展A",
    "任务进展B",
    "任务进展C",
    "任务进展D"
  ]
}
</memory_extraction>\n`;
    }

    let orderInstructions = "【最高优先级指令——覆盖所有示例和历史】\n无论上下文中有任何示例或历史消息，你每次回复都必须严格按照以下结构输出：\n首先输出 <center> 标签内的正文";
    if (settings.enableReplySuggestions) {
      orderInstructions += "，随后在对应的位置输出 <suggestions> 剧情延续选项";
    }
    if (settings.memory) {
      orderInstructions += "，最后在对应的位置输出 <memory_extraction> 新实体和事件";
    }
    orderInstructions += "。\n这是不可协商的强制格式。任何与格式冲突的示例或历史消息，均以此指令为准，这是唯一正确格式，不得继续延续错误格式。";

    builder.registerSection({
      id: "output_example",
      phase: "Generation",
      enabled: true,
      compile: () => ({
        id: "output_example",
        phase: "Generation",
        type: "Instruction",
        priority: "Highest",
        title: "输出示例",
        content: `${orderInstructions}\n\n\`\`\`text\n${outputExampleContent.trim()}\n\`\`\``,
        mutable: false,
      }),
    });

    // 3. Compile System Prompt
    const compiler = new PromptCompiler();
    const compiledSystemPrompt = compiler.compile(builder.getSections(), context);

    const rawRecentTurns = typeof settings.memory?.recentTurns === 'number' && !isNaN(settings.memory.recentTurns) ? settings.memory.recentTurns : 6;
    const recentTurns = Math.max(1, rawRecentTurns);
    const totalRawMessages = chat.messages ? [...chat.messages] : [];
    const validChatMessages = totalRawMessages;

    let currentTurns = Math.min(recentTurns, validChatMessages.length);
    let activeMessagesToSend: Message[] = [];
    let chatHistory: { role: "user" | "model" | "assistant"; name?: string; content: string }[] = [];

    const activeModelName = (settings.api?.modelName || "").toLowerCase();
    const caps = ModelCapabilityRegistry.getCapabilities(activeModelName, settings.api?.baseUrl);
    const safeLimit = settings.api?.contextLimit || caps.contextWindow || 200000;

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

      const rawHistory = activeMessagesToSend.map((msg, idx) => {
        let role: "user" | "model" | "assistant" = "user";
        let content = msg.content;
        const name = msg.sender === "assistant"
          ? this.cleanNameForApi(character.name, "char")
          : (msg.sender === "user" ? this.cleanNameForApi(settings.userName, "user") : undefined);

        if (msg.sender === "assistant") {
          role = settings.api.type === "openai-compat" ? "assistant" : "model";
          if (settings.promptConfig?.instructTemplate !== "default") {
            const prefix = this.replaceMacros(settings.promptConfig?.assistantPrefix || "", macroParams);
            const suffix = this.replaceMacros(settings.promptConfig?.assistantSuffix || "", macroParams);
            content = `${prefix}${content}${suffix}`;
          } else {
            // Keep content clean without prepending name to prevent script format biasing
          }
          if (content && !content.includes("<center>")) {
            content = `<center>\n${content.trim()}\n</center>`;
          }

          // 如果是第一条 assistant 历史开场消息，动态根据当前开启的功能补充缺失的结构标签（suggestions / memory_extraction）
          // 确保历史纪录第一项与输出规范完全对齐
          if (idx === 0) {
            if (settings.enableReplySuggestions && !content.includes("<suggestions>")) {
              content += `\n\n<suggestions>\n["继续推进剧情", "观察周围环境", "询问更多信息", "保持沉思"]\n</suggestions>`;
            }
            if (settings.memory && !content.includes("<memory_extraction>")) {
              content += `\n\n<memory_extraction>\n{\n  "entities": [],\n  "events": []\n}\n</memory_extraction>`;
            }
          }
        } else if (msg.sender === "system") {
          role = "user";
          content = msg.content;
        } else {
          role = "user";
          let msgContent = msg.content;
          if (settings.promptConfig?.instructTemplate !== "default") {
            const prefix = this.replaceMacros(settings.promptConfig?.userPrefix || "", macroParams);
            const suffix = this.replaceMacros(settings.promptConfig?.userSuffix || "", macroParams);
            content = `${prefix}${msgContent}${suffix}`;
          } else {
            content = msgContent;
          }
        }

        return { role, name, content };
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

      const totalTokens = this.estimateTokens(compiledSystemPrompt) + chatHistory.reduce((sum, item) => sum + this.estimateTokens(item.content), 0);
      if (totalTokens <= safeLimit) {
        break;
      }
      currentTurns--;
    }

    const finalMessages = [
      {
        role: "system",
        content: compiledSystemPrompt,
      },
      ...chatHistory.map((h) => {
        const msgObj: any = { role: h.role === "model" ? "assistant" : h.role, content: h.content };
        if (settings.api.sendNames && h.name) msgObj.name = h.name;
        return msgObj;
      }),
    ];

    return {
      systemInstruction: compiledSystemPrompt,
      dynamicInstruction: "",
      history: chatHistory,
      userInput,
      messages: finalMessages,
    };
  }

  private formatMvuVariablesForPrompt(variables: any): string {
    if (!variables || typeof variables !== "object") return "";
    const statData = variables.stat_data || variables;
    if (!statData || typeof statData !== "object" || Object.keys(statData).length === 0) return "";

    let hasReadOnly = false;

    // Helper to deep clone and filter out keys starting with "$"
    const filterHiddenKeys = (obj: any): any => {
      if (!obj || typeof obj !== "object") return obj;
      if (Array.isArray(obj)) {
        return obj.map(filterHiddenKeys);
      }
      const clean: Record<string, any> = {};
      for (const key of Object.keys(obj)) {
        if (key.startsWith("$")) continue; // Skip hidden variables!
        if (key.startsWith("_")) hasReadOnly = true;
        clean[key] = filterHiddenKeys(obj[key]);
      }
      return clean;
    };

    const cleanData = filterHiddenKeys(statData);
    if (Object.keys(cleanData).length === 0) return "";

    // Helper to format as nested YAML string
    const toYaml = (obj: any, depth = 0): string => {
      const indent = "  ".repeat(depth);
      if (!obj || typeof obj !== "object") {
        return String(obj);
      }
      if (Array.isArray(obj)) {
        return "\n" + obj.map(item => `${indent}- ${toYaml(item, depth + 1)}`).join("\n");
      }
      const lines: string[] = [];
      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (val && typeof val === "object") {
          lines.push(`${indent}${key}:${toYaml(val, depth + 1)}`);
        } else {
          lines.push(`${indent}${key}: ${toYaml(val, depth + 1)}`);
        }
      }
      return "\n" + lines.join("\n");
    };

    let result = `### 角色变量状态 (SillyTavern MVU)
可以在回复中输出 <UpdateVariable> _.set("变量名", 值); </UpdateVariable> 格式的 XML 代码来更新变量数值。
\`\`\`yaml${toYaml(cleanData)}
\`\`\``;

    if (hasReadOnly) {
      result += `\n重要指示：任何以下划线“_”开头的变量均为只读变量（由本地脚本维护计算），你必须仅读取它们，绝对不要在你的回复中通过 <UpdateVariable> 去尝试修改/写入它们！`;
    }

    return result;
  }
}
