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
import { applyCharacterRegexScripts } from "../../utils/tavernHelper/mvuParser";
import { resolveTriggeredLorebookEntries } from "./prompt/LorebookResolver";
import {
  formatMvuVariablesForPrompt,
  replacePromptMacros,
  type PromptMacroParams,
} from "./prompt/PromptMacroFormatter";
import {
  formatTableMemoryColumnConstraint,
  getTableMemoryColumnDefinitions,
} from "../../domain/memory/tableMemorySchema";
import { compilePromptComposition } from "../../domain/prompt-composition";
import type {
  PromptCompositionBudgetReport,
  PromptCompositionTrace,
} from "../../domain/prompt-composition";
import { buildPromptCompositionRuntimeData } from "./prompt/PromptCompositionRuntimeAdapter";

function checkAborted(...signals: Array<AbortSignal | undefined>): void {
  if (!signals.some((signal) => signal?.aborted)) return;
  if (typeof DOMException !== "undefined") {
    throw new DOMException("Prompt assembly was aborted", "AbortError");
  }
  const error = new Error("Prompt assembly was aborted");
  error.name = "AbortError";
  throw error;
}

/**
 * 提示词编译与组装服务
 * 负责根据当前会话状态、设定集、记忆等，动态拼装成发送给 LLM 的系统提示词和消息历史
 */
export class PromptService implements IPromptService {
  name = "prompt";
  private kernel!: IKernel;
  // P1-1/P1-2: 服务级 AbortController（纯计算服务，主要用于契约一致性）
  private abortController: AbortController | null = null;

  /**
   * 初始化服务
   */
  init(kernel: IKernel, signal?: AbortSignal): void {
    this.kernel = kernel;
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener("abort", () => this.abortController?.abort());
    }
  }

  /**
   * 销毁服务，清理 abort 控制器并中止挂起任务
   */
  destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * 清洗名称以适配 API 的角色命名限制（只允许数字、字母、下划线及横杠，最大长度 64）
   */
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
    // 针对中文等非 ASCII 字符使用更安全的 2.0 倍率估算，防止高频中文对话时分词器膨胀越界
    return Math.ceil(asciiCount * 0.25 + nonAsciiCount * 2.0);
  }

  sanitizeName(name: string): string {
    if (!name) return "";
    let sanitized = name.replace(/[^a-zA-Z0-9_-]/g, "_");
    sanitized = sanitized.replace(/^[^a-zA-Z0-9_-]+/, "");
    sanitized = sanitized.slice(0, 64);
    return /^[a-zA-Z0-9_-]+$/.test(sanitized) ? sanitized : "";
  }

  hasCardScripts(character: CharacterCard | null): boolean {
    if (!character) return false;
    const ext = character.extensions || {};
    if (Array.isArray(ext.tavern_helper?.scripts) && ext.tavern_helper.scripts.length > 0) return true;
    if (ext.mvu_settings || ext.mvu || ext.MVU) return true;
    return false;
  }

  getTriggeredLorebookEntries(
    messages: Message[],
    userInput: string,
    entries: LorebookEntry[],
    maxRecursionDepth: number = 3
  ): LorebookEntry[] {
    return resolveTriggeredLorebookEntries(
      messages,
      userInput,
      entries,
      maxRecursionDepth
    );
  }

  replaceMacros(
    text: string,
    params: PromptMacroParams
  ): string {
    return replacePromptMacros(text, params);
  }

  assemblePrompt(params: {
    character: CharacterCard;
    chat: ChatSession;
    userInput: string;
    settings: UserSettings;
    globalLorebook?: LorebookEntry[];
    recalledMemories?: any[];
    signal?: AbortSignal;
  }): {
    systemInstruction: string;
    history: Array<{ role: "model" | "user" | "assistant"; name?: string; content: string }>;
    dynamicInstruction: string;
    userInput?: string;
    messages?: Array<{ role: "system" | "user" | "assistant"; name?: string; content: string }>;
    diagnostics?: Array<{
      level: "info" | "warning" | "error";
      code: string;
      message: string;
      blockId?: string;
      detail?: string;
    }>;
    traces?: PromptCompositionTrace[];
    budget?: PromptCompositionBudgetReport;
  } {
    const { character, chat, userInput, settings, globalLorebook = [], recalledMemories = [], signal } = params;
    checkAborted(signal, this.abortController?.signal);
    const operationSignal = signal ?? this.abortController?.signal;

    const macroParams = {
      char: character.name,
      user: settings.userName || "user",
      description: character.description || "无",
      personality: character.personality || "无",
      scenario: character.scenario || "无",
      userPersona: settings.userInfo || "无",
      mes_example: character.mes_example || "",
    };

    // 自由编排路径：只有用户显式启用时生效。编译器不会补入任何隐藏区块，
    // 空编排会产生空 messages；旧路径仅作为迁移期显式回退保留。
    if (settings.promptConfig?.usePromptComposition) {
      const composition = settings.promptConfig.composition ?? {
        id: "composition_missing_empty",
        name: "空编排",
        version: 1 as const,
        blocks: [],
      };
      const allEntries = [...(character.lorebookEntries || []), ...globalLorebook];
      const triggeredLorebook = this.getTriggeredLorebookEntries(
        chat.messages || [],
        userInput,
        allEntries,
      );
      const runtime = buildPromptCompositionRuntimeData({
        character,
        chat,
        userInput,
        settings,
        triggeredLorebook,
        recalledMemories,
        cleanHistoryContent: (message) => {
          if (!character.extensions?.regex_scripts) return message.content;
          return applyCharacterRegexScripts(
            message.content,
            character,
            message.sender === "assistant",
            character.name,
            settings.userName,
            "prompt",
            operationSignal,
          );
        },
      });
      const budgetConfig = composition.tokenBudget;
      const modelCapabilities = ModelCapabilityRegistry.getCapabilities(
        settings.api?.modelName || "",
        settings.api?.baseUrl,
      );
      const contextLimit = settings.api?.contextLimit || modelCapabilities.contextWindow || 200000;
      const modelPromptBudget = Math.max(1, contextLimit - Math.max(0, settings.preset?.maxTokens || 0));
      const tokenBudget = budgetConfig?.enabled === false
        ? undefined
        : budgetConfig?.mode === "custom"
          ? budgetConfig.maxTokens
          : modelPromptBudget;
      const compiled = compilePromptComposition(composition, runtime, {
        tokenBudget,
        estimateTokens: (text) => this.estimateTokens(text),
      });
      compiled.diagnostics.forEach((diagnostic) => {
        console.warn(`[PromptComposition:${diagnostic.code}] ${diagnostic.message}`);
      });
      const systemInstruction = compiled.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
      return {
        systemInstruction,
        dynamicInstruction: "",
        history: compiled.messages.flatMap((message) => {
          if (message.role === "system") return [];
          const role: "user" | "assistant" | "model" =
            message.role === "assistant" && settings.api.type !== "openai-compat"
              ? "model"
              : message.role;
          return [{ role, name: message.name, content: message.content }];
        }),
        userInput,
        messages: compiled.messages,
        diagnostics: compiled.diagnostics,
        traces: compiled.traces,
        budget: compiled.budget,
      };
    }

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
        // 发送给 AI 时应用 promptOnly 正则清理（如隐藏 <StatusPlaceHolderImpl/> 和 <UpdateVariable> 块）
        if (character?.extensions?.regex_scripts) {
          const isAi = msg.sender === "assistant";
          content = applyCharacterRegexScripts(
            content,
            character,
            isAi,
            character.name,
            settings.userName,
            "prompt",
            operationSignal,
          );
        }
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
            // 保持内容整洁，不在前面加名字以防止脚本格式偏置
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
      const diagsVal = this.replaceMacros(character.mes_example || "", macroParams);
      if (diagsVal) {
        cleanSystem += `=== Dialogue Examples ===\n${diagsVal}\n\n`;
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

    // 角色扮演模式 = True（默认）
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
    // 1. ENGINE 规则层（核心指令，固定不可变）
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
    // 2. CONTEXT 事实上下文层（背景设定与参考事实，混合可变性）
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
    // 检测是否有世界书条目使用了 {{format_message_variable::}} 宏，
    // 若有则由宏替换负责注入变量，避免与 mvu_variables section 重复注入
    const hasVariableListEntry = activeEntries.some(e =>
      e.content && /\{\{format_message_variable::/i.test(e.content)
    );
    const formatEntryContent = (entry: LorebookEntry): string => {
      // 世界书条目内容需经过宏替换，支持 {{char}}、{{user}}、{{format_message_variable::stat_data}} 等
      const content = this.replaceMacros(entry.content, { ...macroParams, variables: chat.variables });
      if (entry.addMemo && entry.comment) {
        return `[设定及备注: ${entry.comment}]\n${content}`;
      }
      return content;
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

    const diagsVal = this.replaceMacros(character.mes_example || "", macroParams);
    builder.registerSection({
      id: "dialogue_examples",
      phase: "Context",
      enabled: !!diagsVal,
      compile: () => ({
        id: "dialogue_examples",
        phase: "Context",
        type: "Reference",
        priority: "Normal",
        mutable: true,
        title: "Dialogue Examples",
        content: diagsVal,
      }),
    });

    // ==================================================
    // 3. GENERATION 生成偏好层（叙事风格与写作约束，固定不可变）
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
    // 4. MEMORY 记忆子层（归属于 CONTEXT 事实层，动态可变）
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
        const sheetsMarkdown = enabledSheets.map(sheet => {
          const title = `### 表格：${sheet.name}`;
          const desc = sheet.description ? `*用途说明: ${sheet.description}*` : "";
          const constraints = getTableMemoryColumnDefinitions(sheet)
            .map(formatTableMemoryColumnConstraint)
            .join("；");
          const schema = constraints ? `*字段约束: ${constraints}*` : "";
          const header = `| ${sheet.columns.join(" | ")} |`;
          const divider = `| ${sheet.columns.map(() => "---").join(" | ")} |`;
          const rows = sheet.rows.map(row => `| ${row.join(" | ")} |`).join("\n");
          return `${title}\n${desc}\n${schema}\n${header}\n${divider}\n${rows}`;
        }).join("\n\n");

        // 获取 tableMemoryPrompt 模板配置，替换其中的 {{sheets_markdown}} 占位符
        const rawPrompt = settings.promptConfig?.tableMemoryPrompt || DEFAULT_TABLE_MEMORY_PROMPT;
        tableMemorySection = rawPrompt.replace(/\{\{sheets_markdown\}\}/g, sheetsMarkdown);
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
    // 4b. MVU 角色变量状态段（归属于 CONTEXT 事实层，动态可变）
    // 若世界书条目已通过 {{format_message_variable::stat_data}} 宏注入变量，则跳过此 section 避免重复
    // ==================================================
    let mvuVariablesSection = "";
    if (settings.enableScriptExecution && this.hasCardScripts(character) && chat.variables && !hasVariableListEntry) {
      mvuVariablesSection = formatMvuVariablesForPrompt(chat.variables, character);
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
    // 5. PROTOCOL 输出协议层（结构化 XML/JSON 约束协议，固定不可变）
    // ==================================================
    let memoryExtractionSection = "";
    if (settings.memory?.enableRecall !== false) {
      memoryExtractionSection = `要求根据输出示例，在 <memory_extraction> 标签对应的位置提取本轮的新实体和事件，以帮助系统记录故事发展。
格式要求：使用 <memory_extraction> 标签包裹一个极简的 JSON 对象，其中只能包含 "entities" 和 "events" 字段。必须是合法 JSON，不要添加任何多余文字。
entities 项使用 {"name":"实体名","type":"character|location|item|organization|concept","first_seen":true|false}；events 项使用 {"summary":"简洁事实","participants":["相关实体"]}。若本轮无新内容则输出空数组。`;
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
    if (settings.memory?.enableRecall !== false) {
      outputExampleContent += `\n<memory_extraction>
{
  "entities": [
    {"name": "新出现的实体", "type": "character", "first_seen": true}
  ],
  "events": [
    {"summary": "某角色答应在约定地点完成某事", "participants": ["某角色", "约定地点"]}
  ]
}
</memory_extraction>\n`;
    }
    if (settings.enableTableMemory) {
      // 用 <table_update> 标签包裹示例，与 DEFAULT_TABLE_MEMORY_PROMPT 中的指令说明保持一致；
      // 列名严格对齐默认"关系"表 schema（角色/好感度/亲密度/当前状态描述），
      // 避免 LLM 按错误列名输出导致 processTableMemory 静默跳过。
      outputExampleContent += "\n<table_update>\nupdateRow(\"关系\", {\"角色\": \"NPC\", \"好感度\": \"55\", \"亲密度\": \"相识\", \"当前状态描述\": \"略显亲近\"})\n</table_update>\n";
    }

    let orderInstructions = "【最高优先级指令——覆盖所有示例和历史】\n无论上下文中有任何示例或历史消息，你每次回复都必须严格按照以下结构输出：\n首先输出 <center> 标签内的正文";
    if (settings.enableReplySuggestions) {
      orderInstructions += "，随后在对应的位置输出 <suggestions> 剧情延续选项";
    }
    if (settings.memory?.enableRecall !== false) {
      orderInstructions += "，最后在对应的位置输出 <memory_extraction> 新实体和事件";
    }
    if (settings.enableTableMemory) {
      orderInstructions += "。如果发生了好感、物品、任务等状态的改变，请在最末尾以 <table_update> 标签包裹输出表格更新指令（如 updateRow）";
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

    // 3. 编译组装 System Prompt
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
      checkAborted(operationSignal);
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
        // 发送给 AI 时应用 promptOnly 正则清理（如隐藏 <StatusPlaceHolderImpl/> 和 <UpdateVariable> 块）
        if (character?.extensions?.regex_scripts) {
          const isAi = msg.sender === "assistant";
          content = applyCharacterRegexScripts(
            content,
            character,
            isAi,
            character.name,
            settings.userName,
            "prompt",
            operationSignal,
          );
        }
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
            // 保持内容整洁，不在前面加名字以防止脚本格式偏置
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
            if (settings.memory?.enableRecall !== false && !content.includes("<memory_extraction>")) {
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

}
