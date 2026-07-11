import React, { useCallback } from "react";
import { ChatSession, UserSettings, CharacterCard, LorebookEntry, CustomWorldbook } from "../../types";
import {
  IDatabaseService, IPromptService,
  ITelemetryService, IChatStreamService, IMultiMessageService,
} from "../../kernel/types";
import { FALLBACK_MODEL, TRIAL_OPENROUTER_KEY } from "../../utils/apiClient";
import {
  generateUniqueId, buildThrottledUpdater, buildFinalAiMessage,
  replacePlaceholderMessage,
  getTrialCount, incrementTrialCount,
} from "./helpers";
import { extractThinkContent } from "./helpers";
import { runOutputPipelineAndSave } from "./pipelineHelpers";

interface SendMessageParams {
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

      if (p.isSending || p.isSendingRef.current || !p.activeCharacter || !p.activeSession) return;

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

    const requestId = ++p.activeRequestIdRef.current;
    let updatedSession = currentSession;

    if (!isBisonConsecutive && textToSend && textToSend.trim()) {
      try {
        updatedSession = await p.multiMessageService.queueUserMessage(currentSession, textToSend);
        p.setSessions((prev) => prev.map((s) => (s.id === updatedSession.id ? updatedSession : s)));
      } catch (err: any) {
        console.error("Failed to save session user message:", err);
        p.isSendingRef.current = false;
        p.setIsSending(false);
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

      // 将召回的消息快照挂在 session 内存临时变量上供 UI 面板提取
      updatedSession = {
        ...updatedSession,
        lastRecalledMemories: recalledMemories
      };

      const promptPayload = p.promptService.assemblePrompt({
        character: p.activeCharacter!,
        chat: updatedSession,
        userInput: isBisonConsecutive ? "" : textToSend,
        settings: p.settings,
        globalLorebook: combinedGlobals,
        recalledMemories: recalledMemories,
      });

      // 放置 AI 消息占位符
      console.log("--- AI 发言流式开始 ---");
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
        if (chunk.error) {
          const errMsg = typeof chunk.error === "string"
            ? chunk.error
            : ((chunk.error as any).message || JSON.stringify(chunk.error));
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

      const latestSession = p.sessionsRef.current.find((s) => s.id === updatedSession.id);
      if (!latestSession) { console.warn("[useSendMessage] Aborted save, session was deleted:", updatedSession.id); return; }

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
      if (requestId !== p.activeRequestIdRef.current) return;
      isStreamActiveRef.current = false;
      if (p.pendingUpdateTimeoutRef.current) { clearTimeout(p.pendingUpdateTimeoutRef.current); p.pendingUpdateTimeoutRef.current = null; }

      const isManualAbort = err.name === "AbortError" || err.message?.includes("aborted") || controller.signal.aborted;
      const isStillActive = p.activeSessionIdRef.current === updatedSession.id;
      const latestSession = p.sessionsRef.current.find((s) => s.id === updatedSession.id);

      if (isManualAbort) {
        if (responseText.trim().length > 0 && latestSession) {
          const parsed = extractThinkContent(responseText.trim(), undefined, false);
          const finishedAiMsg = { id: aiMsgId, sender: "assistant" as const, content: parsed.content, timestamp: Date.now(), reasoningContent: parsed.reasoningContent };
          const trueFinalSession = replacePlaceholderMessage(latestSession, finishedAiMsg);
          if (isStillActive) {
            await runOutputPipelineAndSave({ session: trueFinalSession, responseText: parsed.content, reasoningText: parsed.reasoningContent || "", settings: p.settings, activeCharacter: p.activeCharacter!, controller, isStillActive, isBisonConsecutive: false, bisonRemainingCount: 0, setSessions: p.setSessions, databaseService: p.databaseService });
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
          const finishedAiMsg = { id: aiMsgId, sender: "assistant" as const, content: (parsed.content || "") + "\n\n*(连接中断，仅保留部分生成内容)*", timestamp: Date.now(), reasoningContent: parsed.reasoningContent };
          const trueFinalSession = replacePlaceholderMessage(latestSession, finishedAiMsg);
          if (isStillActive) {
            await runOutputPipelineAndSave({ session: trueFinalSession, responseText: parsed.content, reasoningText: parsed.reasoningContent || "", settings: p.settings, activeCharacter: p.activeCharacter!, controller, isStillActive, isBisonConsecutive: false, bisonRemainingCount: 0, setSessions: p.setSessions, databaseService: p.databaseService });
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
      if (p.abortControllerRef.current === controller) p.abortControllerRef.current = null;
      if (requestId === p.activeRequestIdRef.current) {
        const isBisonScheduled = p.settings.enableBisonMode && (p.bisonRemainingCountRef.current > 0 || isBisonChainActive);
        if (!isBisonScheduled) {
          p.isSendingRef.current = false;
          p.setIsSending(false);
          p.setIsBisonLocking(false);
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
    p.bisonRemainingCountRef.current = 0;
    p.setIsBisonLocking(false);
  }, []);

  return { handleSendMessage, handleStopGeneration };
}
