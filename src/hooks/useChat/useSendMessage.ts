import React, { useCallback } from "react";
import { ChatSession, UserSettings, CharacterCard, LorebookEntry, CustomWorldbook } from "../../types";
import {
  IDatabaseService, IPromptService,
  ITelemetryService, IChatStreamService, IMultiMessageService,
  StreamChunk, IKernel,
} from "../../kernel/types";
import { FALLBACK_MODEL, TRIAL_OPENROUTER_KEY } from "../../utils/apiClient";
import {
  generateUniqueId, buildThrottledUpdater, buildFinalAiMessage,
  replacePlaceholderMessage,
  getTrialCount, incrementTrialCount,
} from "./helpers";
import { extractThinkContent } from "./helpers";
import { CONNECTION_INTERRUPTED_SUFFIX, runOutputPipelineAndSave } from "./pipelineHelpers";
import type { MemoryAuditSnapshot } from "../../kernel/services/memory/types";
import { buildMemoryAuditSnapshot } from "../../kernel/services/memory/MemoryAudit";

/**
 * Tavern 全局辅助 window 字段类型收口。
 * 这些字段被 FormattedText.tsx / MessageBubble.tsx / useRerollMessage.ts 等多处
 * 跨 iframe / 原生桥接边界共享读取，本文件内通过本地接口
 * 替代类型逃逸写法，避免类型丢失。
 * 字段标记为可选，反映"运行时动态挂载到 window"的真实语义。
 */
interface WindowWithTavernHelpers extends Window {
  /** 当前流式输出的 messageId，供 FormattedText / MessageBubble 判断渲染态 */
  TavernHelperStreamingMessageId?: string | null;
  /** 全局发送互斥标志，供 iframe / 原生桥接侧读取 */
  TavernHelperIsSending?: boolean;
}

interface SendMessageParams {
  kernel: IKernel;
  settings: UserSettings;
  globalLorebook: LorebookEntry[];
  customWorldbooks: Record<string, CustomWorldbook>;
  characters: CharacterCard[];
  activeCharacter: CharacterCard | null;
  activeSession: ChatSession | null;
  isSending: boolean;
  isSendingRef: React.MutableRefObject<boolean>;
  activeRequestIdRef: React.MutableRefObject<number>;
  activeSessionIdRef: React.MutableRefObject<string | null>;
  sessionsRef: React.MutableRefObject<ChatSession[]>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  pendingUpdateTimeoutRef: React.MutableRefObject<any>;
  bisonRemainingCountRef: React.MutableRefObject<number>;
  // P1-8: Bison 连续推进 setTimeout 的 timer id，供会话切换/卸载/手动停止时清理
  bisonChainTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  setIsSending: (v: boolean) => void;
  setIsBisonLocking: React.Dispatch<React.SetStateAction<boolean>>;
  setReplySuggestions: React.Dispatch<React.SetStateAction<string[]>>;
  publishMemoryAudit?: (snapshot: MemoryAuditSnapshot) => void;
  /** 迁移期兼容旧消费方；新代码应使用 publishMemoryAudit。 */
  publishRecalledMemories?: (sessionId: string, items: MemoryAuditSnapshot["recalled"]) => void;
  triggerScroll: (behavior?: "smooth" | "instant" | "auto") => void;
  databaseService: IDatabaseService;
  promptService: IPromptService;
  telemetryService: ITelemetryService;
  chatStreamService: IChatStreamService;
  multiMessageService: IMultiMessageService;
  /**
   * 记忆服务实例，由外部注入以解耦对 globalKernel 单例的直接依赖。
   * 若为 undefined 则跳过记忆召回。
   */
  memoryService?: any;
  showCustomAlert: (msg: string) => void | Promise<void>;
  draftsRef: React.MutableRefObject<Record<string, string>>;
}

/**
 * 封装"发送消息"与 Bison 连续推进逻辑的 Hook，
 * 不包含任何 UI 状态管理。
 */
export function useSendMessage(p: SendMessageParams) {
  const pRef = React.useRef<SendMessageParams>(p);
  pRef.current = p;

  const handleSendMessage = useCallback(async (
    textToSend: string,
    options?: { isBisonConsecutive?: boolean; skipAI?: boolean }
  ) => {
    const p = pRef.current;
    const isBisonConsecutive = !!options?.isBisonConsecutive;
    const skipAI = !!options?.skipAI;
    let isBisonChainActive = false;

    p.telemetryService.incrementUsageCount();
    p.setReplySuggestions([]);

    if (!isBisonConsecutive) {
      const hasUnsentUserMessages =
        p.activeSession &&
        Array.isArray(p.activeSession.messages) &&
        p.activeSession.messages.length > 0 &&
        p.activeSession.messages[p.activeSession.messages.length - 1].sender === "user";

      if (
        (!textToSend || typeof textToSend !== "string" || !textToSend.trim()) &&
        !hasUnsentUserMessages
      ) return;

      // isSendingRef 是发送与重发共享的同步事务锁；React state 仅负责 UI 展示。
      // streamingMessageId 只覆盖流式阶段，不能用于推断提示词构建或持久化阶段是否空闲。
      if (p.isSending || p.isSendingRef.current) {
        return;
      }

      if (!p.activeCharacter || !p.activeSession) return;

      const modelToReport = p.settings.api.apiKey
        ? (p.settings.api.modelName || FALLBACK_MODEL)
        : "openrouter/free";
      p.telemetryService.reportUsage("send_message", {
        modelName: modelToReport,
        characterName: p.activeCharacter.name,
      });
    } else {
      if (!p.activeCharacter || !p.activeSession) return;
    }

    if (!isBisonConsecutive && p.activeSessionIdRef.current) {
      p.draftsRef.current[p.activeSessionIdRef.current] = "";
    }

    // skipAI：仅保存用户消息，不调用 LLM
    if (skipAI && !isBisonConsecutive && textToSend && textToSend.trim()) {
      try {
        const updatedSession = await p.multiMessageService.queueUserMessage(p.activeSession!, textToSend);
        p.setSessions((prev) => prev.map((s) => (s.id === updatedSession.id ? updatedSession : s)));
      } catch (err: any) {
        console.error("Failed to save session user message:", err);
      }
      p.triggerScroll("smooth");
      return;
    }

    // API 参数解析（试用 / 正式 Key 选择）
    let finalApiKey = p.settings.api.apiKey;
    let finalBaseUrl = p.settings.api.baseUrl;
    let finalModel = p.settings.api.modelName || FALLBACK_MODEL;
    let finalChatPath = p.settings?.api?.chatPath;
    let isTrialMode = false;

    if (!p.settings.api.apiKey || !p.settings.api.apiKey.trim()) {
      if (getTrialCount() >= 10) {
        p.showCustomAlert("💡 您的 10 次公共免 Key 体验次数已用完，请前往\"设置 -> API配置\"中填写您自己的 API Key。");
        return;
      }
      isTrialMode = true;
      finalApiKey = TRIAL_OPENROUTER_KEY;
      finalBaseUrl = "https://openrouter.ai/api/v1";
      finalModel = "openrouter/free";
      finalChatPath = undefined;
    } else {
      if (!p.settings.api.modelName) {
        p.showCustomAlert("对话失败: 目前尚未配置具体的接口模型，请前往设置[接口]页面获取并选择。");
        return;
      }
    }

    const currentSession = p.sessionsRef.current.find((s) => s.id === p.activeSessionIdRef.current) || p.activeSession;
    if (!currentSession) return;
    p.isSendingRef.current = true;
    p.setIsSending(true);
    if (typeof window !== "undefined") {
      (window as WindowWithTavernHelpers).TavernHelperIsSending = true;
    }

    const requestId = ++p.activeRequestIdRef.current;
    let updatedSession = currentSession;

    // 关键修复：流式消息 ID 精确标记
    // 解决 isSending React state 异步更新延迟导致的 iframe 抢跑问题：
    //   1. 流式开始瞬间 isSending 可能还是 false → FormattedText 误判为非流式 → 直接渲染 iframe（抢跑）
    //   2. Bison 模式 500ms 间隔内 isSending 仍为 true，已完成的第一条消息被误判为流式 → iframe 被替换为 loading placeholder（丢失）
    // 通过 window 全局同步标记当前正在生成的消息 ID，MessageBubble 可精确判断哪条消息正在流式。
    const __streamingMsgIdGuard = (v: string | null) => {
      if (typeof window !== "undefined") {
        (window as WindowWithTavernHelpers).TavernHelperStreamingMessageId = v;
      }
    };

    if (!isBisonConsecutive && textToSend && textToSend.trim()) {
      try {
        updatedSession = await p.multiMessageService.queueUserMessage(currentSession, textToSend);
        p.setSessions((prev) => prev.map((s) => (s.id === updatedSession.id ? updatedSession : s)));
      } catch (err: any) {
        console.error("Failed to save session user message:", err);
        p.isSendingRef.current = false;
        p.setIsSending(false);
        if (typeof window !== "undefined") {
          (window as WindowWithTavernHelpers).TavernHelperIsSending = false;
        }
        return;
      }
      p.triggerScroll("smooth");
    }

    const controller = new AbortController();
    p.abortControllerRef.current = controller;

    const responseChunks: string[] = [];
    const reasoningChunks: string[] = [];
    const aiMsgId = generateUniqueId("msg_ai_");
    const startTime = performance.now();
    let tokenUsage = { prompt: 0, completion: 0 };
    let isFirstTokenForSpeed = true;
    let ttftMs = 0;

    const { throttledUpdate, isStreamActiveRef } = buildThrottledUpdater(
      p.setSessions, updatedSession.id, aiMsgId,
      responseChunks, reasoningChunks, p.pendingUpdateTimeoutRef
    );

    try {
      // 组合 Lorebook：全局 + 其他角色世界书 + 自定义世界书
      const otherCharGlobals = p.characters
        .filter((c) => c.isWorldbookGlobal && c.id !== p.activeCharacter!.id)
        .flatMap((c) => c.lorebookEntries || []);
      const customWorldbookGlobals = (Object.values(p.customWorldbooks || {}) as CustomWorldbook[])
        .filter((wb) => wb.enabled)
        .flatMap((wb) => wb.entries || []);
      const combinedGlobals = [...(p.globalLorebook || []), ...otherCharGlobals, ...customWorldbookGlobals];

      // 1. 异步执行记忆召回
      let recalledMemories: any[] = [];
      try {
        const memoryService = p.memoryService;
        if (memoryService && p.settings.memory?.enableRecall !== false) {
          const recallTopK = p.settings.memory?.recallTopK ?? 3;
          recalledMemories = await memoryService.getRecall().recall(
            updatedSession.id,
            isBisonConsecutive ? "" : textToSend,
            { topK: recallTopK }
          );
          if (import.meta.env?.DEV) {
            console.log("[useSendMessage] 记忆召回完成:", recalledMemories.length, "条，topK:", recallTopK);
          }
        } else {
          if (import.meta.env?.DEV) {
            console.warn("[useSendMessage] memoryService 未注入，跳过召回");
          }
        }
      } catch (err) {
        console.warn("[useSendMessage] Memory recall failed:", err);
      }

      const promptPayload = p.promptService.assemblePrompt({
        character: p.activeCharacter!,
        chat: updatedSession,
        userInput: isBisonConsecutive ? "" : textToSend,
        settings: p.settings,
        globalLorebook: combinedGlobals,
        recalledMemories: recalledMemories,
        signal: controller.signal,
      });

      // 审计快照以最终 Prompt 编排轨迹为准，只保留在当前聊天运行时。
      const memoryAudit = buildMemoryAuditSnapshot({
        session: updatedSession,
        query: isBisonConsecutive ? "" : textToSend,
        recalled: recalledMemories,
        settings: p.settings,
        traces: promptPayload.traces,
        estimateTokens: (content) => p.promptService.estimateTokens(content),
      });
      if (p.publishMemoryAudit) p.publishMemoryAudit(memoryAudit);
      else p.publishRecalledMemories?.(updatedSession.id, recalledMemories);

      // 放置 AI 消息占位符
      console.log("--- AI 发言流式开始 ---");
      // 关键：在添加占位符之前同步设置 streamingMessageId，
      // 确保 MessageBubble 首次渲染占位符时 isStreaming 就能精确命中（避免 iframe 抢跑）
      __streamingMsgIdGuard(aiMsgId);
      const placeholderAiMsg = { id: aiMsgId, sender: "assistant" as const, content: "💭...", timestamp: Date.now() };
      p.setSessions((prev) =>
        prev.map((s) => s.id === updatedSession.id ? { ...s, messages: [...s.messages, placeholderAiMsg] } : s)
      );

      const stream = p.chatStreamService.streamLlmResponse({
        baseUrl: finalBaseUrl,
        apiKey: finalApiKey,
        chatPath: finalChatPath,
        bypassProxy: p.settings.api.bypassProxy,
        disableReasoning: p.settings.api.disableReasoning,
        forceBasicParams: p.settings.api.forceBasicParams,
        reqBody: {
          model: finalModel,
          stream: true,
          ...(p.settings.api.type !== "anthropic" && !p.settings.api.forceBasicParams && {
            stream_options: { include_usage: true }
          }),
          messages: promptPayload.messages || [
            {
              role: "system",
              content: [promptPayload.systemInstruction, promptPayload.dynamicInstruction].filter(Boolean).join("\n\n"),
            },
            ...promptPayload.history.map((h: any) => {
              const msgObj: any = { role: h.role === "model" ? "assistant" : h.role, content: h.content };
              if (p.settings.api.sendNames && h.name) msgObj.name = h.name;
              return msgObj;
            }),
          ],
          temperature: p.settings.preset.temperature,
          top_p: p.settings.preset.topP,
          top_k: p.settings.preset.topK,
          min_p: p.settings.preset.minP,
          max_tokens: isBisonConsecutive ? 300 : p.settings.preset.maxTokens,
          presence_penalty: p.settings.preset.presencePenalty ?? 0.0,
          frequency_penalty: p.settings.preset.frequencyPenalty ?? 0.0,
          repetition_penalty: p.settings.preset.repetitionPenalty ?? 1.0,
        },
        signal: controller.signal,
      });

      for await (const chunk of stream) {
        // StreamChunk 类型未声明 error 字段，但服务商错误响应可能携带，故局部扩展类型
        const chunkError = (chunk as StreamChunk & { error?: string | { message?: string } }).error;
        if (chunkError) {
          const errMsg = typeof chunkError === "string"
            ? chunkError
            : (chunkError.message || JSON.stringify(chunkError));
          throw new Error(`[API Error] ${errMsg}`);
        }
        if (chunk.__rescuedContent) {
          responseChunks.push(chunk.__rescuedContent);
        } else {
          const reasoning = chunk.choices?.[0]?.delta?.reasoning_content;
          const delta = chunk.choices?.[0]?.delta?.content || chunk.choices?.[0]?.message?.content || chunk.choices?.[0]?.text;
          const finishReason = chunk.choices?.[0]?.finish_reason;

          if (finishReason && finishReason === "content_filter") {
            throw new Error("内容被服务商的安全过滤（Content Filter）拦截，生成终止。");
          }

          if (reasoning && !delta) {
            reasoningChunks.push(reasoning);
          } else if (delta) {
            responseChunks.push(delta);
            if (isFirstTokenForSpeed) { isFirstTokenForSpeed = false; ttftMs = performance.now() - startTime; }
          }
          if (chunk.usage) {
            tokenUsage = { prompt: chunk.usage.prompt_tokens || 0, completion: chunk.usage.completion_tokens || 0 };
          }
        }
        throttledUpdate(responseChunks.join(""), reasoningChunks.join(""));
      }

      console.log("=== [RAW AI RESPONSE] ===");
      if (reasoningChunks.length > 0) {
        console.log("<think>\n" + reasoningChunks.join("") + "\n</think>");
      }
      const finalSendText = responseChunks.join("");
      console.log(finalSendText);
      console.log("=========================");
      console.debug("[send_message]", finalSendText);

      isStreamActiveRef.current = false;
      if (p.pendingUpdateTimeoutRef.current) { clearTimeout(p.pendingUpdateTimeoutRef.current); p.pendingUpdateTimeoutRef.current = null; }
      // 流式正常完成：清除 streamingMessageId，触发 FormattedText 从 loading placeholder 切换到真实 iframe 渲染
      __streamingMsgIdGuard(null);

      const latestSession = p.sessionsRef.current.find((s) => s.id === updatedSession.id);
      if (!latestSession) { console.warn("[useSendMessage] Aborted save, session was deleted:", updatedSession.id); return; }

      // 关键修复：流式"正常完成"但 AI 返回空内容（API 返回空响应/网络中断未 throw 等场景）
      // 旧逻辑：buildFinalAiMessage 生成 content 为空的消息 → UI 显示"*(未生成任何内容)*"但无报错弹窗
      // 新逻辑：检测空响应，显示报错弹窗 + 删除占位符，让用户明确知道发送失败
      const rawResponseText = responseChunks.join("");
      const rawReasoningText = reasoningChunks.join("");
      if (!rawResponseText.trim() && !rawReasoningText.trim()) {
        console.warn("[useSendMessage] 流式正常结束但 AI 返回空内容，判定为发送失败");
        const isStillActive = p.activeSessionIdRef.current === updatedSession.id;
        // 删除占位符，避免 UI 残留空消息
        const nextSession = { ...latestSession, messages: latestSession.messages.filter((m) => m.id !== aiMsgId) };
        if (isStillActive) {
          p.setSessions((prev) => prev.map((s) => (s.id === nextSession.id ? nextSession : s)));
          p.showCustomAlert("发送失败：AI 未返回任何内容，请检查 API 配置、网络连接或模型是否可用。");
        }
        await p.databaseService.saveSession(nextSession).catch((e) => console.error("[useSendMessage] Failed to save after empty response:", e));
        return;
      }

      const { finalAiMsg, suggestions } = buildFinalAiMessage({
        aiMsgId, responseText: responseChunks.join(""), reasoningText: reasoningChunks.join(""),
        startTime, tokenUsage, enableReplySuggestions: p.settings.enableReplySuggestions, latestSession,
      });

      if (p.settings.enableReplySuggestions && suggestions.length > 0) {
        p.setReplySuggestions(suggestions);
      }

      const trueFinalSession = replacePlaceholderMessage(latestSession, finalAiMsg);
      const isStillActive = p.activeSessionIdRef.current === updatedSession.id;

      if (isStillActive) {
        const outputCtx = await runOutputPipelineAndSave({
          kernel: p.kernel,
          session: trueFinalSession,
          responseText: extractThinkContent(responseChunks.join("").trim(), reasoningChunks.join("").trim(), false).content,
          reasoningText: extractThinkContent(responseChunks.join("").trim(), reasoningChunks.join("").trim(), false).reasoningContent || "",
          settings: p.settings,
          activeCharacter: p.activeCharacter!,
          controller,
          isStillActive,
          isBisonConsecutive,
          bisonRemainingCount: p.bisonRemainingCountRef.current,
          setSessions: p.setSessions,
          databaseService: p.databaseService,
          triggerScroll: () => p.triggerScroll("smooth"),
        });

        if (isTrialMode) incrementTrialCount();

        try {
          p.telemetryService.reportLlmPerformance(
            updatedSession.id,
            finalModel,
            ttftMs,
            tokenUsage.prompt + tokenUsage.completion,
            performance.now() - startTime,
            tokenUsage.prompt,
            tokenUsage.completion,
            p.activeCharacter!.name,
            p.settings.userName
          );
        } catch (telemetryErr) {
          console.warn("Failed to report LLM performance telemetry:", telemetryErr);
        }

        if (outputCtx.shouldTriggerBison) {
          p.bisonRemainingCountRef.current = outputCtx.nextBisonRemainingCount ?? 0;
          isBisonChainActive = true;
          p.setIsBisonLocking(true);
          // P1-8: 先清理可能残留的旧 timer，避免快速触发导致多个 setTimeout 堆积竞态
          if (p.bisonChainTimerRef.current) {
            clearTimeout(p.bisonChainTimerRef.current);
            p.bisonChainTimerRef.current = null;
          }
          // P1-8: 保存 timer id 到 ref，供会话切换/卸载/手动停止时清理
          const timer = setTimeout(() => {
            p.bisonChainTimerRef.current = null;
            handleSendMessage("", { isBisonConsecutive: true }).catch((err) =>
              console.error("Failed in bison consecutive send:", err)
            );
          }, 500);
          p.bisonChainTimerRef.current = timer;
        } else {
          p.bisonRemainingCountRef.current = 0;
          p.setIsBisonLocking(false);
        }
      } else {
        await p.databaseService.saveSession(trueFinalSession);
        // saveSession 只存元数据，会话切换场景需显式写入 AI 消息
        const switchedAiMsg = trueFinalSession.messages[trueFinalSession.messages.length - 1];
        if (switchedAiMsg && switchedAiMsg.sender === "assistant") {
          await p.databaseService.appendSessionMessage(trueFinalSession.id, switchedAiMsg, trueFinalSession.messages.length - 1)
            .catch((e) => console.error("[useSendMessage] Failed to save AI message after session switch:", e));
        }
        console.log("[useSendMessage] Session switched during generation, saved silently:", updatedSession.id);
      }
    } catch (err: any) {
      const responseText = responseChunks.join("");
      p.bisonRemainingCountRef.current = 0;
      p.setIsBisonLocking(false);
      if (requestId !== p.activeRequestIdRef.current) {
        // 当前请求已被新请求取代，清理旧占位符（仅当占位符未被替换为真实内容时）
        // 避免 UI 残留"💭..."或空消息导致"发送后无反馈/未生成"假象
        const latestSessionForCleanup = p.sessionsRef.current.find((s) => s.id === updatedSession.id);
        if (latestSessionForCleanup) {
          const placeholderMsg = latestSessionForCleanup.messages.find((m) => m.id === aiMsgId);
          if (placeholderMsg && (placeholderMsg.content === "💭..." || !placeholderMsg.content?.trim())) {
            const nextSession = { ...latestSessionForCleanup, messages: latestSessionForCleanup.messages.filter((m) => m.id !== aiMsgId) };
            p.setSessions((prev) => prev.map((s) => (s.id === nextSession.id ? nextSession : s)));
          }
        }
        return;
      }
      isStreamActiveRef.current = false;
      if (p.pendingUpdateTimeoutRef.current) { clearTimeout(p.pendingUpdateTimeoutRef.current); p.pendingUpdateTimeoutRef.current = null; }
      // 异常/中断分支：同样清除 streamingMessageId，避免残留导致 FormattedText 卡在 loading placeholder
      __streamingMsgIdGuard(null);

      const isManualAbort = err.name === "AbortError" || err.message?.includes("aborted") || controller.signal.aborted;
      const isStillActive = p.activeSessionIdRef.current === updatedSession.id;
      const latestSession = p.sessionsRef.current.find((s) => s.id === updatedSession.id);

      if (isManualAbort) {
        if (responseText.trim().length > 0 && latestSession) {
          const parsed = extractThinkContent(responseText.trim(), undefined, false);
          const finishedAiMsg = { id: aiMsgId, sender: "assistant" as const, content: parsed.content, timestamp: Date.now(), reasoningContent: parsed.reasoningContent };
          const trueFinalSession = replacePlaceholderMessage(latestSession, finishedAiMsg);
          if (isStillActive) {
            await runOutputPipelineAndSave({ kernel: p.kernel, session: trueFinalSession, responseText: parsed.content, reasoningText: parsed.reasoningContent || "", settings: p.settings, activeCharacter: p.activeCharacter!, controller, isStillActive, isBisonConsecutive: false, bisonRemainingCount: 0, setSessions: p.setSessions, databaseService: p.databaseService });
          } else {
            await p.databaseService.saveSession(trueFinalSession);
            // saveSession 只存元数据，abort 场景需显式写入 AI 消息
            await p.databaseService.appendSessionMessage(trueFinalSession.id, finishedAiMsg, trueFinalSession.messages.length - 1)
              .catch((e) => console.error("[useSendMessage] Failed to save AI message on abort:", e));
          }
        } else if (latestSession) {
          const nextSession = { ...latestSession, messages: latestSession.messages.filter((m) => m.id !== aiMsgId) };
          if (isStillActive) p.setSessions((prev) => prev.map((s) => (s.id === nextSession.id ? nextSession : s)));
          await p.databaseService.saveSession(nextSession).catch((e) => console.error("Failed to save after abort:", e));
        }
      } else {
        if (isStillActive) p.showCustomAlert("发送失败，对话连接异常: " + err.message);
        if (responseText.trim().length > 0 && latestSession) {
          const parsed = extractThinkContent(responseText.trim(), undefined, false);
          const finishedAiMsg = { id: aiMsgId, sender: "assistant" as const, content: (parsed.content || "") + CONNECTION_INTERRUPTED_SUFFIX, timestamp: Date.now(), reasoningContent: parsed.reasoningContent };
          const trueFinalSession = replacePlaceholderMessage(latestSession, finishedAiMsg);
          if (isStillActive) {
            await runOutputPipelineAndSave({ kernel: p.kernel, session: trueFinalSession, responseText: parsed.content, responseSuffix: CONNECTION_INTERRUPTED_SUFFIX, reasoningText: parsed.reasoningContent || "", settings: p.settings, activeCharacter: p.activeCharacter!, controller, isStillActive, isBisonConsecutive: false, bisonRemainingCount: 0, setSessions: p.setSessions, databaseService: p.databaseService });
          } else {
            await p.databaseService.saveSession(trueFinalSession);
            // saveSession 只存元数据，error 场景需显式写入 AI 消息
            await p.databaseService.appendSessionMessage(trueFinalSession.id, finishedAiMsg, trueFinalSession.messages.length - 1)
              .catch((e) => console.error("[useSendMessage] Failed to save AI message on error:", e));
          }
        } else if (latestSession) {
          const nextSession = { ...latestSession, messages: latestSession.messages.filter((m) => m.id !== aiMsgId) };
          if (isStillActive) p.setSessions((prev) => prev.map((s) => (s.id === nextSession.id ? nextSession : s)));
          await p.databaseService.saveSession(nextSession).catch((e) => console.error("Failed to save on error:", e));
        }
      }
    } finally {
      isStreamActiveRef.current = false;
      if (p.pendingUpdateTimeoutRef.current) { clearTimeout(p.pendingUpdateTimeoutRef.current); p.pendingUpdateTimeoutRef.current = null; }
      // finally 兜底：确保 streamingMessageId 被清除，避免任何未捕获路径残留导致 FormattedText 卡死在 loading placeholder
      __streamingMsgIdGuard(null);
      if (p.abortControllerRef.current === controller) p.abortControllerRef.current = null;
      if (requestId === p.activeRequestIdRef.current) {
        const isBisonScheduled = p.settings.enableBisonMode && (p.bisonRemainingCountRef.current > 0 || isBisonChainActive);
        if (!isBisonScheduled) {
          p.isSendingRef.current = false;
          p.setIsSending(false);
          p.setIsBisonLocking(false);
          if (typeof window !== "undefined") {
            (window as WindowWithTavernHelpers).TavernHelperIsSending = false;
          }
        }
      }
    }
  }, []);

  const handleStopGeneration = useCallback(() => {
    const p = pRef.current;
    if (p.abortControllerRef.current) {
      p.abortControllerRef.current.abort();
      p.abortControllerRef.current = null;
    }
    // P1-8: 手动停止时清理 Bison 链 timer，避免停止后仍触发下一次连续推进
    if (p.bisonChainTimerRef.current) {
      clearTimeout(p.bisonChainTimerRef.current);
      p.bisonChainTimerRef.current = null;
    }
    p.isSendingRef.current = false;
    p.setIsSending(false);
    if (typeof window !== "undefined") {
      (window as WindowWithTavernHelpers).TavernHelperIsSending = false;
    }
    p.bisonRemainingCountRef.current = 0;
    p.setIsBisonLocking(false);
  }, []);

  return { handleSendMessage, handleStopGeneration };
}
