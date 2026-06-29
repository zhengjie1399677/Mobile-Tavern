import { IPromptService, IKernel, KernelServices } from "../types";
import { CharacterCard, ChatSession, UserSettings, LorebookEntry, Message } from "../../types";
import { DEFAULT_REPLY_SUGGESTIONS_PROMPT } from "../../defaults/suggestionsPrompt";
import {
  DEFAULT_REASONING_GUIDANCE_PROMPT,
  DEFAULT_TABLE_MEMORY_PROMPT,
} from "../../defaults/promptTemplates";
import { PromptBuilder } from "./prompt/PromptBuilder";
import { PromptCompiler } from "./prompt/PromptCompiler";

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
    const builder = new PromptBuilder();

    // ==================================================
    // ENGINE SECTION
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

    // CoreRules
    builder.registerSection({
      id: "core_rules",
      type: "engine",
      order: 1,
      enabled: !!mainPromptReplaced,
      compile: () => mainPromptReplaced,
    });

    const modelName = (settings.api?.modelName || "").toLowerCase();
    const isDeepSeek = modelName.includes("deepseek") || modelName.includes("r1") || modelName.includes("reasoner");
    const enableGuidance = settings.promptConfig?.enableReasoningGuidance !== undefined
      ? settings.promptConfig.enableReasoningGuidance
      : isDeepSeek;
    const reasoningGuidance = enableGuidance
      ? (settings.promptConfig?.reasoningGuidancePrompt || DEFAULT_REASONING_GUIDANCE_PROMPT)
      : "";

    // Constraints (Reasoning Guidance)
    builder.registerSection({
      id: "reasoning_guidance",
      type: "engine",
      order: 2,
      enabled: !!reasoningGuidance,
      compile: () => reasoningGuidance,
    });

    // ==================================================
    // CHARACTER SECTION
    // ==================================================
    // User Persona
    let userPersonaSection = "";
    if (settings.userInfo) {
      userPersonaSection = `=== User Persona ===\n${this.replaceMacros(settings.userInfo, macroParams)}`;
    }
    builder.registerSection({
      id: "user_persona",
      type: "character",
      order: 1,
      enabled: !!userPersonaSection,
      compile: () => userPersonaSection,
    });

    // Persona (Description & Personality)
    const descriptionVal = this.replaceMacros(character.description || "", macroParams);
    const personalityVal = this.replaceMacros(character.personality || "", macroParams);
    builder.registerSection({
      id: "char_persona",
      type: "character",
      order: 2,
      enabled: !!(descriptionVal || personalityVal),
      compile: () => [
        descriptionVal ? `=== Character Description ===\n${descriptionVal}` : "",
        personalityVal ? `=== Character Personality ===\n${personalityVal}` : ""
      ].filter(Boolean).join("\n\n"),
    });

    // Scenario
    const scenarioVal = this.replaceMacros(character.scenario || "", macroParams);
    builder.registerSection({
      id: "char_scenario",
      type: "character",
      order: 3,
      enabled: !!scenarioVal,
      compile: () => `=== Scenario ===\n${scenarioVal}`,
    });

    // World (Character specific system prompt)
    let charSpecificPrompt = "";
    if (character.system_prompt) {
      charSpecificPrompt = this.replaceMacros(character.system_prompt, macroParams);
    }
    builder.registerSection({
      id: "char_specific_prompt",
      type: "character",
      order: 4,
      enabled: !!charSpecificPrompt,
      compile: () => charSpecificPrompt,
    });

    // Lorebook
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
      type: "character",
      order: 5,
      enabled: !!lorebookText,
      compile: () => `=== Reference Lore ===\n${lorebookText}`,
    });

    // ==================================================
    // CONTEXT SECTION
    // ==================================================
    // Summary
    let summaryText = "";
    if (chat.summaries && chat.summaries.length > 0) {
      summaryText = chat.summaries
        .map((s) => `[${s.timeTag} | ${s.location}] ${s.content}`)
        .join("\n");
    }
    builder.registerSection({
      id: "summary",
      type: "context",
      order: 1,
      enabled: !!summaryText,
      compile: () => `=== 剧情时间线摘要 ===\n${summaryText}`,
    });

    // State (Table Memory)
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
        const sheetsMarkdown = enabledSheets.map(sheet => {
          const title = `### 表格：${sheet.name}`;
          const desc = sheet.description ? `*用途说明: ${sheet.description}*` : "";
          const header = `| ${sheet.columns.join(" | ")} |`;
          const divider = `| ${sheet.columns.map(() => "---").join(" | ")} |`;
          const rows = sheet.rows.map(row => `| ${row.join(" | ")} |`).join("\n");
          return `${title}\n${desc}\n${header}\n${divider}\n${rows}`;
        }).join("\n\n");

        tableMemorySection = `=== 🎯 长期状态与记忆档案柜 ===
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
      }
    }
    builder.registerSection({
      id: "table_memory",
      type: "context",
      order: 2,
      enabled: !!tableMemorySection,
      compile: () => tableMemorySection,
    });

    // Relevant Memory
    let recalledMemoriesSection = "";
    if (recalledMemories && recalledMemories.length > 0) {
      const recallText = recalledMemories
        .map((m: any) => `[第 ${m.turnIndex} 轮 - ${m.role === 'user' ? '用户' : '角色'}]: ${m.content}`)
        .join("\n");
      recalledMemoriesSection = `=== 🧠 历史相关记忆片段 ===
以下为从历史对话中召回的碎屑片段，仅用作本次生成的细节参考以确保前后情节一致连贯。注意：它们是离散的历史，请勿当成最新的连续对话：
${recallText}
==================================`;
    }
    builder.registerSection({
      id: "recalled_memories",
      type: "context",
      order: 3,
      enabled: !!recalledMemoriesSection,
      compile: () => recalledMemoriesSection,
    });

    // ==================================================
    // STYLE SECTION
    // ==================================================
    // Dialogue Examples (Few-shot)
    let mesExampleSection = "";
    if (character.mes_example) {
      const mesExampleVal = this.replaceMacros(character.mes_example, macroParams);
      mesExampleSection = `=== 对话与例句示例 (Dialogue Examples) ===\n${mesExampleVal}`;
    }
    builder.registerSection({
      id: "dialogue_examples",
      type: "style",
      order: 1,
      enabled: !!mesExampleSection,
      compile: () => mesExampleSection,
    });

    // ==================================================
    // OUTPUT SECTION
    // ==================================================
    // Jailbreak (Safety)
    let jailbreakSection = "";
    if (settings.promptConfig?.useJailbreak && settings.promptConfig?.jailbreakPrompt) {
      jailbreakSection = this.replaceMacros(settings.promptConfig.jailbreakPrompt, macroParams);
    }
    builder.registerSection({
      id: "jailbreak",
      type: "output",
      order: 1,
      enabled: !!jailbreakSection,
      compile: () => jailbreakSection,
    });

    // Memory Extraction (Output Protocol)
    let memoryExtractionSection = "";
    if (settings.memory) {
      memoryExtractionSection = `=== 📦 记忆抽取协议 ===
为了帮助系统记录故事发展，请在正文输出完毕后，提取本轮的新实体和事件。
格式要求：使用 <memory_extraction> 标签包裹一个极简的 JSON 对象。只能包含合法 JSON，不要添加任何多余文字。若无新内容，输出空数组。
<memory_extraction>
{
  "entities": ["新人物/地点/物品/概念名称1", "名称2"],
  "events": ["本轮发生的关键事件简述1", "简述2"]
}
</memory_extraction>
(注意：entities 和 events 均使用简单的一维字符串数组，不要嵌套复杂的对象！若本轮无新内容则输出空数组。)`;
    }
    builder.registerSection({
      id: "memory_extraction",
      type: "output",
      order: 2,
      enabled: !!memoryExtractionSection,
      compile: () => memoryExtractionSection,
    });

    // Suggestions (Output Protocol)
    let suggestionsSection = "";
    if (settings.enableReplySuggestions) {
      suggestionsSection = `${settings.replySuggestionsPrompt || DEFAULT_REPLY_SUGGESTIONS_PROMPT}`;
      if (settings.memory) {
        suggestionsSection += `\n（注意：在 </suggestions> 标签之后，还需继续追加 <memory_extraction> 标签，这是唯一允许 of 例外。）`;
      }
    }
    builder.registerSection({
      id: "reply_suggestions",
      type: "output",
      order: 3,
      enabled: !!suggestionsSection,
      compile: () => suggestionsSection,
    });

    // Post History Instructions
    let postHistoryContent = "";
    if (settings.promptConfig?.usePostHistory && settings.promptConfig?.postHistoryPrompt) {
      postHistoryContent += this.replaceMacros(settings.promptConfig.postHistoryPrompt, macroParams);
    }
    if (character.post_history_instructions) {
      const charPostHistory = this.replaceMacros(character.post_history_instructions, macroParams);
      postHistoryContent = postHistoryContent ? `${postHistoryContent}\n\n${charPostHistory}` : charPostHistory;
    }
    builder.registerSection({
      id: "post_history_instructions",
      type: "output",
      order: 4,
      enabled: !!postHistoryContent,
      compile: () => postHistoryContent,
    });

    // 3. Compile System Prompt
    const compiler = new PromptCompiler();
    const compiledSystemPrompt = compiler.compile(builder.getSections(), {});

    // 4. Build Chat History (Recent turns)
    const rawRecentTurns = typeof settings.memory?.recentTurns === 'number' && !isNaN(settings.memory.recentTurns) ? settings.memory.recentTurns : 6;
    const recentTurns = Math.max(1, rawRecentTurns);
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
            if (idx === 0) {
              content = `${character.name}: ${content}`;
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
      if (totalTokens <= SAFE_CONTEXT_LIMIT) {
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
}
