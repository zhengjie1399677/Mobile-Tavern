/**
 * @deprecated 逻辑已合并到 MemoryService.getSummary()，本文件暂存作为向后兼容入口。
 */

import { IKernel, IDatabaseService, ILLMService, KernelServices } from "../types";
import { ChatSession, UserSettings, CharacterCard, SummaryCard, Message } from "../../types";
import { FALLBACK_MODEL, API_ENDPOINT, TRIAL_OPENROUTER_KEY } from "../../utils/apiClient";
import {
  DEFAULT_LOCATION_REGEX,
  DEFAULT_TIME_REGEX,
  DEFAULT_CONDITION_REGEX,
  DEFAULT_INVENTORY_REGEX,
  DEFAULT_BONDING_REGEX,
} from "../../defaults/promptTemplates";

const generateUniqueId = (prefix: string): string => {
  return prefix + Math.random().toString(36).substring(2, 9);
};

// @deprecated — 不再 implements IAutoSummaryService（该接口已从 kernel/types.ts 清理）
export class AutoSummaryService {
  name = "autoSummary";
  /**
   * 条目 6 修复：显式声明服务依赖。
   * registerServiceBatch 的 Kahn 算法将读取该字段进行拓扑排序，
   * 保证 Database 和 LLM 在 AutoSummaryService 之前完成初始化。
   */
  readonly dependencies = [KernelServices.Database, KernelServices.LLM] as const;
  private kernel!: IKernel;
  // P1-1/P1-2: 服务级 AbortController
  private abortController: AbortController | null = null;

  init(kernel: IKernel, signal?: AbortSignal): void {
    this.kernel = kernel;
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener("abort", () => this.abortController?.abort());
    }
  }

  // P1-2: 销毁时中止挂起的总结 LLM 调用
  destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  async handleAutoSummaryCheck(
    session: ChatSession,
    settings: UserSettings,
    activeCharacter: CharacterCard | null,
    force: boolean,
    signal?: AbortSignal
  ): Promise<ChatSession> {
    let resolvedLastId = session.lastSummarizedMessageId;

    // L3 快速通道优化：合并存在性检查与索引查找为单次反向遍历，消除冗余 O(n) 操作。
    // 原实现先 some() 再 findIndex() 对消息数组做了两次完整遍历，此处合并为一次。
    const findIndexById = (id: string | undefined): number => {
      if (!id) return -1;
      for (let i = session.messages.length - 1; i >= 0; i--) {
        if (session.messages[i].id === id) return i;
      }
      return -1;
    };

    let lastIndex = findIndexById(resolvedLastId);
    if (lastIndex < 0 && resolvedLastId) {
      // lastSummarizedMessageId 在消息中不存在（可能被删除），回退到 summaries 最后一条
      const lastSummary = session.summaries && session.summaries.length > 0
        ? session.summaries[session.summaries.length - 1]
        : null;
      resolvedLastId = lastSummary?.lastMessageId || undefined;
      lastIndex = findIndexById(resolvedLastId);
    }

    const startIndex = lastIndex >= 0 ? lastIndex + 1 : 0;
    // L3 快速通道优化：仅计算未总结消息数量，不创建完整 slice（避免 O(n) 内存分配）。
    // 原实现无条件 slice 整个尾部数组，即使大多数调用因未达阈值而直接返回。
    const unsummarizedCount = session.messages.length - startIndex;

    const summaryTurnsVal = settings?.memory?.summaryTriggerTurns;
    const rawTriggerTurns = summaryTurnsVal ? Number(summaryTurnsVal) : 0;

    // 如果未开启自动整理且非强制手动触发，直接返回
    if (!force && rawTriggerTurns === 0) {
      return session;
    }

    const rawRecentTurns = Number(settings?.memory?.recentTurns || 6);
    const triggerRounds = (!isNaN(rawTriggerTurns) && rawTriggerTurns > 0) ? rawTriggerTurns : rawRecentTurns;

    const safeTriggerRounds = Math.max(4, triggerRounds);
    const maxAllowedUnsummarized = safeTriggerRounds * 2;

    let messagesToCompress: Message[] = [];

    if (force || unsummarizedCount >= maxAllowedUnsummarized) {
      if (unsummarizedCount === 0) {
        if (force) {
          throw new Error("当前没有未被总结的有效对话。");
        }
        return session;
      }

      // L3 快速通道优化：仅在真正需要总结时才创建 slice，且只截取需要的部分
      messagesToCompress = session.messages.slice(startIndex, startIndex + maxAllowedUnsummarized);

      if (!settings.api.apiKey || !settings.api.apiKey.trim()) {
        if (force) {
          throw new Error("当前处于免 Key 体验模式下，已自动禁用总结功能以节省频宽额度。");
        }
        return session;
      }

      const cleanContent = (text: string): string => {
        if (!text) return "";
        return text
          .replace(/<think>[\s\S]*?<\/think>/gi, "")
          .replace(/<think>[\s\S]*?$/gi, "")
          .replace(/<memory>[\s\S]*?<\/memory>/gi, "")
          .replace(/<memory>[\s\S]*?$/gi, "")
          .replace(/(?:updateRow|insertRow|deleteRow)\s*\(.*?\)/gi, "")
          .trim();
      };

      const promptInstruction = settings?.memory?.summarySystemPrompt || "";
      const contentConcat = messagesToCompress
        .map((m) => `${m.sender === "user" ? (settings?.userName || "user") : (activeCharacter?.name || "角色")}: ${cleanContent(m.content)}`)
        .join("\n");

      let compiledSummary = "";

      let finalApiKey = settings.api.apiKey;
      let finalBaseUrl = settings.api.baseUrl;
      let finalModel = settings.api.modelName || FALLBACK_MODEL;
      let finalChatPath = settings?.api?.chatPath;

      if (!settings.api.apiKey || !settings.api.apiKey.trim()) {
        finalApiKey = TRIAL_OPENROUTER_KEY;
        finalBaseUrl = "https://openrouter.ai/api/v1";
        finalModel = "openrouter/free";
        finalChatPath = undefined;
      }

      const reqBody = {
        model: finalModel,
        messages: [
          { role: "system", content: promptInstruction },
          { role: "user", content: contentConcat },
        ],
        stream: false,
        temperature: 0.5,
        max_tokens: 500,
      };

      const llm = this.kernel.getService<ILLMService>(KernelServices.LLM);
      const response = await llm.universalFetch(API_ENDPOINT.ProxyOpenAI, {
        baseUrl: finalBaseUrl,
        apiKey: finalApiKey,
        chatPath: finalChatPath,
        reqBody,
        bypassProxy: settings.api.bypassProxy,
        forceBasicParams: settings.api.forceBasicParams,
      }, signal);

      if (signal?.aborted) return session;

      if (!response.ok) {
        const errStatus = response.status;
        console.error("[AutoSummary] fetch failed with status:", errStatus);
        throw new Error(`API 返回错误状态码 ${errStatus}`);
      }

      const responseText = await response.text();
      let resData: any;
      try {
        resData = JSON.parse(responseText);
      } catch (e) {
        console.error("[AutoSummary] JSON parse failed. Response text was:", responseText);
        throw new Error("接口返回数据格式错误，解析 JSON 失败");
      }

      if (resData && resData.choices && resData.choices.length > 0) {
        compiledSummary = resData.choices[0].message?.content || "";
      }

      if (compiledSummary) {
        const indexVal = (session.summaries || []).length + 1;
        const timeTagTemplate = settings?.memory?.timeTagTemplate || "第{{index}}幕";
        const timeTag = timeTagTemplate.replace(/\{\{index\}\}/g, String(indexVal));

        let contentText = compiledSummary.trim();
        let locationStr = activeCharacter?.scenario?.slice(0, 8) || "未知地点";
        let timeTagStr = timeTag;
        let conditionStr = "";
        let inventoryStr = "";
        let bondingStr = "";

        const splitIdx = compiledSummary.lastIndexOf("---");
        if (splitIdx !== -1) {
          const body = compiledSummary.slice(0, splitIdx).trim();
          const meta = compiledSummary.slice(splitIdx + 3).trim();
          if (body) {
            contentText = body;
          }
          
          // 已废弃字段兼容：MemoryConfig 中 locationRegex/timeRegex/conditionRegex/inventoryRegex/bondingRegex
          // 已在 Phase C 砍掉（状态抽离迁移到 MemoryStateTable），本文件仅保留 @deprecated 版本周期。
          const mem: any = settings?.memory || {};
          const locationRegexStr = mem.locationRegex || DEFAULT_LOCATION_REGEX;
          const timeRegexStr = mem.timeRegex || DEFAULT_TIME_REGEX;
          const conditionRegexStr = mem.conditionRegex || DEFAULT_CONDITION_REGEX;
          const inventoryRegexStr = mem.inventoryRegex || DEFAULT_INVENTORY_REGEX;
          const bondingRegexStr = mem.bondingRegex || DEFAULT_BONDING_REGEX;

          const safeMatch = (text: string, pattern: string) => {
            try {
              return text.match(new RegExp(pattern, "i"));
            } catch (e) {
              console.error("[AutoSummary] Invalid regex pattern:", pattern, e);
              return null;
            }
          };

          const locMatch = safeMatch(meta, locationRegexStr);
          const timeMatch = safeMatch(meta, timeRegexStr);
          const condMatch = safeMatch(meta, conditionRegexStr);
          const invMatch = safeMatch(meta, inventoryRegexStr);
          const bondMatch = safeMatch(meta, bondingRegexStr);

          if (locMatch && locMatch[1].trim()) locationStr = locMatch[1].trim();
          if (timeMatch && timeMatch[1].trim()) timeTagStr = timeMatch[1].trim();
          if (condMatch && condMatch[1].trim()) conditionStr = condMatch[1].trim();
          if (invMatch && invMatch[1].trim()) inventoryStr = invMatch[1].trim();
          if (bondMatch && bondMatch[1].trim()) bondingStr = bondMatch[1].trim();
        }

        const lastSummarizedMessageId = messagesToCompress[messagesToCompress.length - 1].id;

        const newCard: SummaryCard = {
          id: generateUniqueId("summary_"),
          timeTag: timeTagStr,
          location: locationStr,
          content: contentText,
          condition: conditionStr || undefined,
          inventory: inventoryStr || undefined,
          bonding: bondingStr || undefined,
          lastMessageId: lastSummarizedMessageId,
        };

        if (signal?.aborted) return session;

        const db = this.kernel.getService<IDatabaseService>(KernelServices.Database);
        // P0-2: 改用单条直查，避免 getAllSessions() 全量反序列化整个 sessions 表
        const latestSession = await db.getSessionById(session.id);
        if (latestSession) {
          const nextSession = {
            ...latestSession,
            summaries: [...(latestSession.summaries || []), newCard],
            lastSummarizedMessageId,
          };
          await db.saveSession(nextSession);
          return nextSession;
        } else {
          throw new Error("记忆整理失败，该会话可能已被删除。");
        }
      } else {
        throw new Error("记忆整理失败，请检查API连接。");
      }
    }
    return session;
  }
}
