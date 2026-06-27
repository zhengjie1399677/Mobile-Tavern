import { IPromptService, IKernel } from "../types";
import { CharacterCard, ChatSession, UserSettings, LorebookEntry, Message } from "../../types";
import { DEFAULT_REPLY_SUGGESTIONS_PROMPT } from "../../defaults/suggestionsPrompt";
import {
  DEFAULT_REASONING_GUIDANCE_PROMPT,
  DEFAULT_TABLE_MEMORY_PROMPT,
} from "../../defaults/promptTemplates";

const SAFE_CONTEXT_LIMIT = 12000;

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
  } {
    const { character, chat, userInput, settings, globalLorebook = [], recalledMemories = [] } = params;

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
            if (idx === 0) {
              content = `${character.name}: ${content}`;
            }
          }
        } else if (msg.sender === "system") {
          // 纯底层原则：移除硬编码 [系统旁白:] 前缀。
          // role 保持 "user" 以维持严格 user/assistant 交替（兼容严格要求交替的 API）。
          // 如需 system role，用户可通过 instruct 模板自定义。
          role = "user";
          let msgContent = msg.content;
          if (settings.enableReplySuggestions && idx === lastUserMsgIdx) {
            msgContent += settings.replySuggestionsPrompt || DEFAULT_REPLY_SUGGESTIONS_PROMPT;
          }
          content = msgContent;
        } else {
          role = "user";
          let msgContent = msg.content;
          if (settings.enableReplySuggestions && idx === lastUserMsgIdx) {
            msgContent += settings.replySuggestionsPrompt || DEFAULT_REPLY_SUGGESTIONS_PROMPT;
          }
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
      const isDeepSeek = modelName.includes("deepseek");
      const enableGuidance = settings.promptConfig?.enableReasoningGuidance !== undefined
        ? settings.promptConfig.enableReasoningGuidance
        : isDeepSeek;
      const reasoningGuidance = enableGuidance
        ? `\n\n${settings.promptConfig?.reasoningGuidancePrompt || DEFAULT_REASONING_GUIDANCE_PROMPT}\n`
        : "";

      return {
        systemInstruction: (cleanSystem.trim() + reasoningGuidance).trim(),
        dynamicInstruction: "",
        history: chatHistory,
        userInput,
      };
    }

    const hasCustomPrompts =
      settings.promptConfig?.customPrompts &&
      settings.promptConfig.customPrompts.length > 0;
    const activeCustomBlocks = hasCustomPrompts
      ? settings.promptConfig.customPrompts!.filter((p) => p.enabled)
      : [];

    let mainPromptReplaced = "";
    if (settings.promptConfig?.mainPrompt) {
      mainPromptReplaced = this.replaceMacros(
        settings.promptConfig.mainPrompt,
        macroParams,
      );
    }

    if (activeCustomBlocks.length > 0) {
      const compiledBlocks = activeCustomBlocks
        .map((block) => {
          const prefix = block.name ? `### ${block.name}\n` : "";
          return `${prefix}${this.replaceMacros(block.content, macroParams)}`;
        })
        .join("\n\n");

      if (mainPromptReplaced) {
        mainPromptReplaced = `${mainPromptReplaced}\n\n${compiledBlocks}`;
      } else {
        mainPromptReplaced = compiledBlocks;
      }
    }

    const allEntries = [...(character.lorebookEntries || []), ...globalLorebook];
    const activeEntries = this.getTriggeredLorebookEntries(
      chat.messages || [],
      userInput,
      allEntries,
    );

    const modelName = (settings.api?.modelName || "").toLowerCase();

    const isDeepSeek = modelName.includes("deepseek");
    const enableGuidance = settings.promptConfig?.enableReasoningGuidance !== undefined
      ? settings.promptConfig.enableReasoningGuidance
      : isDeepSeek;
    const reasoningGuidance = enableGuidance
      ? `\n\n${settings.promptConfig?.reasoningGuidancePrompt || DEFAULT_REASONING_GUIDANCE_PROMPT}\n`
      : "";

    // 纯底层原则：lorebook position 完全由用户在角色卡/世界书中显式声明，
    // 系统不再根据模型名硬编码改写。缓存命中率优化通过 messages 顺序（system 首位）保证。
    const processedActiveEntries = activeEntries;

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
        if (depthB !== depthA) {
          return depthB - depthA;
        }
        const orderA = a.order !== undefined ? a.order : 100;
        const orderB = b.order !== undefined ? b.order : 100;
        return orderA - orderB;
      });
      return sorted.map((e) => formatEntryContent(e)).join("\n\n");
    };

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

    let summarySection = "";
    if (chat.summaries && chat.summaries.length > 0) {
      const summaryText = chat.summaries
        .map((s) => `[${s.timeTag} | ${s.location}] ${s.content}`)
        .join("\n");
      summarySection = formatSectionText("summary", "", summaryText, true);
    }

    let userPersonaSection = "";
    if (settings.userInfo) {
      const personaText = this.replaceMacros(settings.userInfo, macroParams);
      userPersonaSection = formatSectionText("userPersona", "", personaText, true);
    }

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

当前数据表格内容如下:
${sheetsMarkdown}
==================================`;
        tableMemorySection = formatSectionText("tableMemory", "", systemGuidance, true);
      }
    }

    let recalledMemoriesSection = "";
    if (recalledMemories && recalledMemories.length > 0) {
      const recallText = recalledMemories
        .map((m: any) => `[第 ${m.turnIndex} 轮 - ${m.role === 'user' ? '用户' : '角色'}]: ${m.content}`)
        .join("\n");
      const systemGuidance = `=== 🧠 历史相关记忆片段 ===
以下为从历史对话中召回的碎屑片段，仅用作本次生成的细节参考以确保前后情节一致连贯。注意：它们是离散的历史，请勿当成最新的连续对话：
${recallText}
==================================`;
      recalledMemoriesSection = formatSectionText("relevantMemories", "", systemGuidance, true);
    }

    let charSpecificPrompt = "";
    if (character.system_prompt) {
      const specificText = this.replaceMacros(character.system_prompt, macroParams);
      charSpecificPrompt = formatSectionText("charSystem", "", specificText, true);
    }

    let mesExampleSection = "";
    if (character.mes_example) {
      const mesExampleVal = this.replaceMacros(character.mes_example, macroParams);
      mesExampleSection = formatSectionText("mesExample", "=== 对话与例句示例 (Dialogue Examples) ===", mesExampleVal, true);
    }

    let jailbreakSection = "";
    if (
      settings.promptConfig?.useJailbreak &&
      settings.promptConfig?.jailbreakPrompt
    ) {
      const jailbreakText = this.replaceMacros(settings.promptConfig.jailbreakPrompt, macroParams);
      jailbreakSection = formatSectionText("jailbreak", "", jailbreakText, true);
    }

    let postHistoryContent = "";
    if (
      settings.promptConfig?.usePostHistory &&
      settings.promptConfig?.postHistoryPrompt
    ) {
      postHistoryContent += this.replaceMacros(settings.promptConfig.postHistoryPrompt, macroParams);
    }

    if (character.post_history_instructions) {
      const charPostHistory = this.replaceMacros(character.post_history_instructions, macroParams);
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

    const descriptionVal = this.replaceMacros(
      character.description || "",
      macroParams,
    );
    const personalityVal = this.replaceMacros(
      character.personality || "",
      macroParams,
    );
    const scenarioVal = this.replaceMacros(character.scenario || "", macroParams);

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

    if (compiledStory.toLowerCase().includes("{{relevant_memories}}")) {
      compiledStory = compiledStory.replace(/\{\{relevant_memories\}\}/gi, () => recalledMemoriesSection);
    } else if (compiledStory.toLowerCase().includes("{{relevantmemories}}")) {
      compiledStory = compiledStory.replace(/\{\{relevantmemories\}\}/gi, () => recalledMemoriesSection);
    } else if (compiledStory.toLowerCase().includes("{{recalled_memories}}")) {
      compiledStory = compiledStory.replace(/\{\{recalled_memories\}\}/gi, () => recalledMemoriesSection);
    } else if (recalledMemoriesSection) {
      compiledStory = compiledStory + `\n\n${recalledMemoriesSection}`;
    }

    compiledStory = compiledStory.replace(/\{\{post_history\}\}/gi, "");

    const systemInstruction = compiledStory.replace(/\n{3,}/g, "\n\n").trim();

    dynamicSystemExtension = dynamicSystemExtension
      .replace(/\{\{post_history\}\}/gi, () => postHistorySection);

    const dynamicInstruction = dynamicSystemExtension.replace(/\n{3,}/g, "\n\n").trim();

    const { recentTurns } = settings.memory;
    const totalRawMessages = chat.messages ? [...chat.messages] : [];
    const validChatMessages = totalRawMessages;

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
            if (idx === 0) {
              content = `${character.name}: ${content}`;
            }
          }
        } else if (msg.sender === "system") {
          // 纯底层原则：移除硬编码 [系统旁白:] 前缀。
          // role 保持 "user" 以维持严格 user/assistant 交替（兼容严格要求交替的 API）。
          // 如需 system role，用户可通过 instruct 模板自定义。
          role = "user";
          let msgContent = msg.content;
          if (settings.enableReplySuggestions && idx === lastUserMsgIdx) {
            msgContent += settings.replySuggestionsPrompt || DEFAULT_REPLY_SUGGESTIONS_PROMPT;
          }
          content = msgContent;
        } else {
          role = "user";
          let msgContent = msg.content;
          if (settings.enableReplySuggestions && idx === lastUserMsgIdx) {
            msgContent += settings.replySuggestionsPrompt || DEFAULT_REPLY_SUGGESTIONS_PROMPT;
          }
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

      const totalTokens = this.estimateTokens(systemInstruction) + this.estimateTokens(dynamicInstruction) + chatHistory.reduce((sum, item) => sum + this.estimateTokens(item.content), 0);
      if (totalTokens <= SAFE_CONTEXT_LIMIT) {
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
}
