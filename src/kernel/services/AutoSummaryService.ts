import { IAutoSummaryService, IKernel, IDatabaseService, ILLMService, KernelServices } from "../types";
import { ChatSession, UserSettings, CharacterCard, SummaryCard, Message } from "../../types";
import { FALLBACK_MODEL, API_ENDPOINT, TRIAL_OPENROUTER_KEY } from "../../utils/apiClient";

const generateUniqueId = (prefix: string): string => {
  return prefix + Math.random().toString(36).substring(2, 9);
};

export class AutoSummaryService implements IAutoSummaryService {
  name = "autoSummary";
  /**
   * 条目 6 修复：显式声明服务依赖。
   * registerServiceBatch 的 Kahn 算法将读取该字段进行拓扑排序，
   * 保证 Database 和 LLM 在 AutoSummaryService 之前完成初始化。
   */
  readonly dependencies = [KernelServices.Database, KernelServices.LLM] as const;
  private kernel!: IKernel;

  init(kernel: IKernel): void {
    this.kernel = kernel;
  }

  async handleAutoSummaryCheck(
    session: ChatSession,
    settings: UserSettings,
    activeCharacter: CharacterCard | null,
    force: boolean,
    signal?: AbortSignal
  ): Promise<ChatSession> {
    let resolvedLastId = session.lastSummarizedMessageId;
    if (resolvedLastId) {
      const hasIt = session.messages.some((m) => m.id === resolvedLastId);
      if (!hasIt) {
        const lastSummary = session.summaries && session.summaries.length > 0
          ? session.summaries[session.summaries.length - 1]
          : null;
        resolvedLastId = lastSummary?.lastMessageId || undefined;
      }
    }

    const lastIndex = resolvedLastId
      ? session.messages.findIndex((m) => m.id === resolvedLastId)
      : -1;
    
    let startIndex = 0;
    if (lastIndex >= 0) {
      startIndex = lastIndex + 1;
    }
    const unsummarizedMessages = session.messages.slice(startIndex);
    
    const summaryTurnsVal = settings?.memory?.summaryTriggerTurns;
    const rawTriggerTurns = summaryTurnsVal ? Number(summaryTurnsVal) : 0;
    const rawRecentTurns = Number(settings?.memory?.recentTurns || 6);
    const triggerRounds = (!isNaN(rawTriggerTurns) && rawTriggerTurns > 0) ? rawTriggerTurns : rawRecentTurns;
    
    const safeTriggerRounds = Math.max(4, triggerRounds);
    const maxAllowedUnsummarized = safeTriggerRounds * 2;

    let messagesToCompress: Message[] = [];

    if (force || unsummarizedMessages.length >= maxAllowedUnsummarized) {
      if (unsummarizedMessages.length === 0) {
        if (force) {
          throw new Error("当前没有未被总结的有效对话。");
        }
        return session;
      }

      messagesToCompress = unsummarizedMessages.slice(0, maxAllowedUnsummarized);

      if (!settings.api.apiKey || !settings.api.apiKey.trim()) {
        if (force) {
          throw new Error("当前处于免 Key 体验模式下，已自动禁用总结功能以节省频宽额度。");
        }
        return session;
      }

      const promptInstruction = settings?.memory?.summarySystemPrompt || "";
      const contentConcat = messagesToCompress
        .map((m) => `${m.sender === "user" ? (settings?.userName || "user") : (activeCharacter?.name || "角色")}: ${m.content}`)
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
          
          const locMatch = meta.match(/\[(?:Location|地点):\s*(.*?)\]/i);
          const timeMatch = meta.match(/\[(?:Time|时间):\s*(.*?)\]/i);
          const condMatch = meta.match(/\[(?:Condition|状态|心境):\s*(.*?)\]/i);
          const invMatch = meta.match(/\[(?:Inventory|物品|道具):\s*(.*?)\]/i);
          const bondMatch = meta.match(/\[(?:Bonding|羁绊|情感):\s*(.*?)\]/i);

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
        const allSessions = await db.getAllSessions();
        const latestSession = allSessions.find((s) => s.id === session.id);
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
