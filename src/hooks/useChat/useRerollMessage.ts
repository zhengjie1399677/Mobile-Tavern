import React, { useCallback } from "react";
import { ChatSession, UserSettings, CharacterCard, LorebookEntry, CustomWorldbook, Message } from "../../types";
import {
  IDatabaseService, IPromptService,
  ITelemetryService, IChatStreamService,
} from "../../kernel/types";
import { globalKernel } from "../../kernel";
import { FALLBACK_MODEL, TRIAL_OPENROUTER_KEY } from "../../utils/apiClient";
import {
  generateUniqueId, buildThrottledUpdater, buildFinalAiMessage,
  replacePlaceholderMessage,
  getTrialCount, incrementTrialCount, extractThinkContent,
} from "./helpers";
import { runOutputPipelineAndSave } from "./pipelineHelpers";

interface RerollMessageParams {
  settings: UserSettings;
  globalLorebook: LorebookEntry[];
  customWorldbooks: Record<string, CustomWorldbook>;
  characters: CharacterCard[];
  activeCharacter: CharacterCard | null;
  activeSession: ChatSession | null;
  isSendingRef: React.MutableRefObject<boolean>;
  activeRequestIdRef: React.MutableRefObject<number>;
  activeSessionIdRef: React.MutableRefObject<string | null>;
  sessionsRef: React.MutableRefObject<ChatSession[]>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  pendingUpdateTimeoutRef: React.MutableRefObject<any>;
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  setIsSending: (v: boolean) => void;
  setReplySuggestions: React.Dispatch<React.SetStateAction<string[]>>;
  triggerScroll: (behavior?: "smooth" | "instant" | "auto") => void;
  databaseService: IDatabaseService;
  promptService: IPromptService;
  telemetryService: ITelemetryService;
  chatStreamService: IChatStreamService;
  showCustomAlert: (msg: string) => Promise<void>;
  showCustomConfirm: (msg: string) => Promise<boolean>;
}

/**
 * 封装"重新生成（Reroll）"消息的流式请求 Hook，
 * 与 useSendMessage 共享 streamHelpers 纯函数，消除代码重复。
 */
export function useRerollMessage(p: RerollMessageParams) {
  const pRef = React.useRef<RerollMessageParams>(p);
  pRef.current = p;

  const handleRerollFromMessage = useCallback(async (targetMsg: Message) => {
    const p = pRef.current;
    p.setReplySuggestions([]);

    const currentSession = p.sessionsRef.current.find((s) => s.id === p.activeSessionIdRef.current) || p.activeSession;

    // 互斥锁检查 + 兜底自愈（与 useSendMessage 一致）
    // isSendingRef 可能因 finally 块的 requestId !== activeRequestIdRef 检查而残留 true
    if (p.isSendingRef.current) {
      const streamingId = typeof window !== "undefined" ? (window as any).TavernHelperStreamingMessageId : null;
      if (!streamingId) {
        console.warn("[useRerollMessage] 检测到 isSendingRef 残留但无活跃流式，强制重置互斥锁");
        p.isSendingRef.current = false;
        p.setIsSending(false);
        if (typeof window !== "undefined") {
          (window as any).TavernHelperIsSending = false;
        }
      } else {
        return;
      }
    }

    if (!targetMsg?.id || !p.activeCharacter || !currentSession) return;

    // 立即锁定发送状态（防止异步弹窗与后续重复点击导致竞争）
    p.isSendingRef.current = true;
    p.setIsSending(true);
    if (typeof window !== "undefined") {
      (window as any).TavernHelperIsSending = true;
    }

    let finalApiKey = p.settings.api.apiKey;
    let finalBaseUrl = p.settings.api.baseUrl;
    let finalModel = p.settings.api.modelName || FALLBACK_MODEL;
    let finalChatPath = p.settings?.api?.chatPath;
    let isTrialMode = false;

    if (!p.settings.api.apiKey || !p.settings.api.apiKey.trim()) {
      if (getTrialCount() >= 10) {
        await p.showCustomAlert("💡 您的 10 次公共免 Key 体验次数已用完，请前往\"设置 -> API配置\"中填写您自己的 API Key。");
        p.isSendingRef.current = false;
        p.setIsSending(false);
        if (typeof window !== "undefined") {
          (window as any).TavernHelperIsSending = false;
        }
        return;
      }
      isTrialMode = true;
      finalApiKey = TRIAL_OPENROUTER_KEY;
      finalBaseUrl = "https://openrouter.ai/api/v1";
      finalModel = "openrouter/free";
      finalChatPath = undefined;
    } else {
      if (!p.settings.api.modelName) {
        await p.showCustomAlert("重发失败: 目前尚未配置具体的接口模型，请前往设置[接口]页面获取并选择。");
        p.isSendingRef.current = false;
        p.setIsSending(false);
        if (typeof window !== "undefined") {
          (window as any).TavernHelperIsSending = false;
        }
        return;
      }
    }

    const requestId = ++p.activeRequestIdRef.current;

    const cleanHistory = (currentSession.messages || []).filter(
      (m) => !(m.sender === "assistant" && (m.content === "💭..." || !m.content))
    );
    const targetIdx = cleanHistory.findIndex((m) => m.id === targetMsg.id);
    if (targetIdx === -1) {
      p.isSendingRef.current = false;
      p.setIsSending(false);
      if (typeof window !== "undefined") {
        (window as any).TavernHelperIsSending = false;
      }
      return;
    }

    if (targetIdx < cleanHistory.length - 1) {
      const ok = await p.showCustomConfirm("从该条对白开始重新生成，将会抹除整条分支此后的所有对话。确认继续吗？");
      if (!ok) {
        p.isSendingRef.current = false;
        p.setIsSending(false);
        if (typeof window !== "undefined") {
          (window as any).TavernHelperIsSending = false;
        }
        return;
      }
    }

    const nextMsgsIdx = targetMsg.sender === "user" ? targetIdx + 1 : targetIdx;
    const nextMsgs = cleanHistory.slice(0, nextMsgsIdx);

    // 寻找最近的一条用户消息作为驱动对白，但不删除夹在中间的系统或助手消息（如野牛模式的静默指令）
    let lastUserText = "";
    let lastUserIdx = -1;
    for (let i = nextMsgs.length - 1; i >= 0; i--) {
      if (nextMsgs[i].sender === "user") {
        lastUserText = nextMsgs[i].content;
        lastUserIdx = i;
        break;
      }
    }

    if (lastUserIdx === -1) {
      await p.showCustomAlert("重新生成回复之前，需要前置有一条用户消息作为驱动对白！");
      p.isSendingRef.current = false;
      p.setIsSending(false);
      if (typeof window !== "undefined") {
        (window as any).TavernHelperIsSending = false;
      }
      return;
    }

    const modelToReport = p.settings.api.apiKey ? (p.settings.api.modelName || FALLBACK_MODEL) : "openrouter/free";
    p.telemetryService.reportUsage("regenerate_message", { modelName: modelToReport, characterName: p.activeCharacter.name });

    let updatedSession = { ...currentSession, messages: nextMsgs };
    p.setSessions((prev) => prev.map((s) => (s.id === updatedSession.id ? updatedSession : s)));
    try {
      await p.databaseService.saveSession(updatedSession);
      // saveSession 不再做孤儿清理，需显式删除被 reroll 移除的旧消息
      const removedMsgs = cleanHistory.slice(nextMsgsIdx);
      for (const msg of removedMsgs) {
        await p.databaseService.deleteMessageById(msg.id).catch((e) =>
          console.error("[useRerollMessage] Failed to delete old message:", e)
        );
      }
    } catch (err: any) {
      console.error("Failed to save session for reroll:", err);
      p.isSendingRef.current = false;
      p.setIsSending(false);
      if (typeof window !== "undefined") {
        (window as any).TavernHelperIsSending = false;
      }
      return;
    }
    p.triggerScroll();

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
      const otherCharGlobals = p.characters
        .filter((c) => c.isWorldbookGlobal && c.id !== p.activeCharacter!.id)
        .flatMap((c) => (c.lorebookEntries || []).map((entry) => ({
          ...entry,
          content: `[来自世界书: ${c.name}]\n${entry.content}`,
        })));
      const customWorldbookGlobals = (Object.values(p.customWorldbooks || {}) as CustomWorldbook[])
        .filter((wb) => wb.enabled)
        .flatMap((wb) => (wb.entries || []).map((entry) => ({
          ...entry,
          content: `[来自世界书: ${wb.name}]\n${entry.content}`,
        })));
      const combinedGlobals = [...(p.globalLorebook || []), ...otherCharGlobals, ...customWorldbookGlobals];

      // 1. 异步执行记忆召回
      let recalledMemories: any[] = [];
      try {
        const memoryService = globalKernel.getService<any>("memory");
        if (memoryService && p.settings.memory?.enableRecall !== false) {
          const recallTopK = p.settings.memory?.recallTopK ?? 3;
          recalledMemories = await memoryService.getRecall().recall(
            updatedSession.id,
            lastUserText,
            { topK: recallTopK }
          );
        }
      } catch (err) {
        console.warn("[useRerollMessage] Memory recall failed:", err);
      }

      // 将召回的消息快照挂在 session 内存临时变量上供 UI 面板提取
      updatedSession = {
        ...updatedSession,
        lastRecalledMemories: recalledMemories
      };

      console.log("[Reroll Debug] updatedSession messages:", JSON.stringify(updatedSession.messages.map(m => ({ id: m.id, sender: m.sender, content: m.content }))));

      const promptPayload = p.promptService.assemblePrompt({
        character: p.activeCharacter!,
        chat: updatedSession,
        userInput: lastUserText,
        settings: p.settings,
        globalLorebook: combinedGlobals,
        recalledMemories: recalledMemories,
      });

      console.clear();
      console.log("--- AI 发言重新生成流式开始 ---");
      // 关键修复：同步设置 streamingMessageId，与 useSendMessage 保持一致，避免 iframe 抢跑
      if (typeof window !== "undefined") {
        (window as any).TavernHelperStreamingMessageId = aiMsgId;
      }
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
          max_tokens: p.settings.preset.maxTokens,
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
      const finalRerollText = responseChunks.join("");
      console.log(finalRerollText);
      console.log("=========================");
      console.debug("[reroll]", finalRerollText);

      isStreamActiveRef.current = false;
      if (p.pendingUpdateTimeoutRef.current) { clearTimeout(p.pendingUpdateTimeoutRef.current); p.pendingUpdateTimeoutRef.current = null; }
      // 流式正常完成：清除 streamingMessageId
      if (typeof window !== "undefined") {
        (window as any).TavernHelperStreamingMessageId = null;
      }

      const latestSession = p.sessionsRef.current.find((s) => s.id === updatedSession.id);
      if (!latestSession) { console.warn("[useRerollMessage] Aborted save, session was deleted:", updatedSession.id); return; }

      // 关键修复：流式"正常完成"但 AI 返回空内容（与 useSendMessage 一致）
      const rawResponseText = responseChunks.join("");
      const rawReasoningText = reasoningChunks.join("");
      if (!rawResponseText.trim() && !rawReasoningText.trim()) {
        console.warn("[useRerollMessage] 流式正常结束但 AI 返回空内容，判定为重新生成失败");
        const isStillActive = p.activeSessionIdRef.current === updatedSession.id;
        // 恢复原始消息（重新生成场景：删除占位符，恢复被删除的原消息）
        const restoreSession = { ...latestSession, messages: latestSession.messages.filter((m) => m.id !== aiMsgId) };
        if (isStillActive) {
          p.setSessions((prev) => prev.map((s) => (s.id === restoreSession.id ? restoreSession : s)));
          p.showCustomAlert("重新生成失败：AI 未返回任何内容，请检查 API 配置、网络连接或模型是否可用。");
        }
        await p.databaseService.saveSession(restoreSession).catch((e) => console.error("[useRerollMessage] Failed to save after empty response:", e));
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
        await runOutputPipelineAndSave({
          session: trueFinalSession,
          responseText: extractThinkContent(responseChunks.join("").trim(), reasoningChunks.join("").trim(), false).content,
          reasoningText: extractThinkContent(responseChunks.join("").trim(), reasoningChunks.join("").trim(), false).reasoningContent || "",
          settings: p.settings,
          activeCharacter: p.activeCharacter!,
          controller,
          isStillActive,
          isBisonConsecutive: false,
          bisonRemainingCount: 0,
          setSessions: p.setSessions,
          databaseService: p.databaseService,
          triggerScroll: () => p.triggerScroll(),
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
      } else {
        await p.databaseService.saveSession(trueFinalSession);
        // saveSession 只存元数据，AI 消息需显式写入 messages Store
        await p.databaseService
          .appendSessionMessage(trueFinalSession.id, trueFinalSession.messages[trueFinalSession.messages.length - 1], trueFinalSession.messages.length - 1)
          .catch((e) => console.error("[useRerollMessage] Failed to save AI message on session switch:", e));
        console.log("[useRerollMessage] Session switched during reroll, saved silently:", updatedSession.id);
      }
    } catch (e: any) {
      const responseText = responseChunks.join("");
      if (requestId !== p.activeRequestIdRef.current) {
        // 当前请求已被新请求取代，清理旧占位符（仅当占位符未被替换为真实内容时）
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
      // 异常/中断分支：清除 streamingMessageId
      if (typeof window !== "undefined") {
        (window as any).TavernHelperStreamingMessageId = null;
      }
      const isManualAbort = e.name === "AbortError" || e.message?.includes("aborted") || controller.signal.aborted;
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
            // saveSession 只存元数据，AI 消息需显式写入 messages Store
            await p.databaseService
              .appendSessionMessage(trueFinalSession.id, finishedAiMsg, trueFinalSession.messages.length - 1)
              .catch((e) => console.error("[useRerollMessage] Failed to save AI message on abort:", e));
          }
        } else if (latestSession) {
          const nextSession = { ...latestSession, messages: latestSession.messages.filter((m) => m.id !== aiMsgId) };
          if (isStillActive) p.setSessions((prev) => prev.map((s) => (s.id === nextSession.id ? nextSession : s)));
          await p.databaseService.saveSession(nextSession).catch((err) => console.error("Failed to save after reroll abort:", err));
        }
      } else {
        if (isStillActive) {
          console.error("AI Regeneration failed:", e);
          p.telemetryService.reportUsage("api_error", { detail: String(e.message || "Unknown error"), playerName: p.settings.userName, characterName: p.activeCharacter!.name, modelName: p.settings.api.modelName, sessionId: updatedSession.id });
        }
        if (responseText.trim().length > 0 && latestSession) {
          const parsed = extractThinkContent(responseText.trim(), undefined, false);
          const finishedAiMsg = { id: aiMsgId, sender: "assistant" as const, content: (parsed.content || "") + "\n\n*(连接中断，仅保留部分生成内容)*", timestamp: Date.now(), reasoningContent: parsed.reasoningContent };
          const trueFinalSession = replacePlaceholderMessage(latestSession, finishedAiMsg);
          if (isStillActive) {
            await runOutputPipelineAndSave({ session: trueFinalSession, responseText: parsed.content, reasoningText: parsed.reasoningContent || "", settings: p.settings, activeCharacter: p.activeCharacter!, controller, isStillActive, isBisonConsecutive: false, bisonRemainingCount: 0, setSessions: p.setSessions, databaseService: p.databaseService });
          } else {
            await p.databaseService.saveSession(trueFinalSession);
            // saveSession 只存元数据，AI 消息需显式写入 messages Store
            await p.databaseService
              .appendSessionMessage(trueFinalSession.id, finishedAiMsg, trueFinalSession.messages.length - 1)
              .catch((e) => console.error("[useRerollMessage] Failed to save AI message on error:", e));
          }
        } else {
          const errorMsg = { id: generateUniqueId("msg_err_"), sender: "system" as const, content: `【连接错误】重新生成失败。请检查端口或API秘钥状态。详细错误: ${e.message}`, timestamp: Date.now() };
          if (latestSession) {
            const finalMessages = latestSession.messages.filter((m) => m.id !== aiMsgId).concat(errorMsg);
            const finalSession = { ...latestSession, messages: finalMessages };
            if (isStillActive) p.setSessions((prev) => prev.map((s) => (s.id === finalSession.id ? finalSession : s)));
            await p.databaseService.saveSession(finalSession).catch((err) => console.error("Failed to save error message:", err));
            // saveSession 只存元数据，错误消息需显式写入 messages Store
            await p.databaseService
              .appendSessionMessage(finalSession.id, errorMsg, finalSession.messages.length - 1)
              .catch((e) => console.error("[useRerollMessage] Failed to save error message to messages Store:", e));
          }
        }
        if (isStillActive) p.triggerScroll();
      }
    } finally {
      isStreamActiveRef.current = false;
      if (p.pendingUpdateTimeoutRef.current) { clearTimeout(p.pendingUpdateTimeoutRef.current); p.pendingUpdateTimeoutRef.current = null; }
      // finally 兜底：确保 streamingMessageId 被清除，避免任何未捕获路径残留导致 FormattedText 卡死
      if (typeof window !== "undefined") {
        (window as any).TavernHelperStreamingMessageId = null;
      }
      if (p.abortControllerRef.current === controller) p.abortControllerRef.current = null;
      if (requestId === p.activeRequestIdRef.current) {
        p.isSendingRef.current = false;
        p.setIsSending(false);
        if (typeof window !== "undefined") {
          (window as any).TavernHelperIsSending = false;
        }
      }
    }
  }, []);

  const handleRerollLast = useCallback(async () => {
    const p = pRef.current;
    
    // Resolve the latest session synchronously from the ref
    const currentSession = p.sessionsRef.current.find((s) => s.id === p.activeSessionIdRef.current) || p.activeSession;
    if (!currentSession || !Array.isArray(currentSession.messages) || currentSession.messages.length === 0) return;

    const messages = currentSession.messages;

    // 寻找最后一条用户消息和最后一条 AI 回复（规避 index 0 的欢迎词）
    let lastUserIdx = -1;
    let lastAiIdx = -1;

    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender === "user" && lastUserIdx === -1) {
        lastUserIdx = i;
      }
      if (messages[i].sender === "assistant" && lastAiIdx === -1) {
        if (i === 0) continue; // 规避首条欢迎词
        lastAiIdx = i;
      }
    }

    if (lastUserIdx === -1 && lastAiIdx === -1) {
      await p.showCustomAlert("对话中尚未存在可供重新生成的对白！");
      return;
    }

    // 决策：如果最后的用户消息在最后的 AI 回复之后（说明最后一条用户消息发送后失败了、被中断了，或者尚未得到回复）
    // 此时应当针对最后一条用户消息重新生成回复。
    if (lastUserIdx > lastAiIdx) {
      await handleRerollFromMessage(messages[lastUserIdx]);
    } else {
      await handleRerollFromMessage(messages[lastAiIdx]);
    }
  }, [handleRerollFromMessage]);

  return { handleRerollFromMessage, handleRerollLast };
}
