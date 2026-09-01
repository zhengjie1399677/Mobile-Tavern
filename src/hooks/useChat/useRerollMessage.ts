import React, { useCallback } from "react";
import { publicEnvironment } from "../../config";
import { ChatSession, ChatSessionMetadataPatch, UserSettings, CharacterCard, LorebookEntry, CustomWorldbook, Message, ReplyChoice, SummaryCard } from "../../types";
import {
  IDatabaseService, IPromptService,
  ITelemetryService, IChatStreamService,
  IKernel, IAttachmentService, IAgentRuntimeService, KernelServices,
} from "@/src/application/serviceContracts";
import { FALLBACK_MODEL } from "../../utils/apiClient";
import {
  resolveApiCredentials,
  TrialExhaustedError,
  TrialKeyFetchError,
  ModelNotConfiguredError,
  type ResolvedApiCredentials,
} from "../../utils/resolveApiCredentials";
import {
  generateUniqueId, buildThrottledUpdater, buildFinalAiMessage, recallWithTimeout,
  incrementTrialCount, extractThinkContent, replacePlaceholderMessage,
  reconcileSummaryBoundary,
} from "./helpers";
import { CONNECTION_INTERRUPTED_SUFFIX, runOutputPipelineAndSave } from "./pipelineHelpers";
import type { MemoryAuditSnapshot, RecalledMessage } from "../../application/services/memory/types";
import { buildMemoryAuditSnapshot } from "../../application/services/memory/MemoryAudit";
import { Logger, generateTraceId } from "../../utils/logger";
import { assembleAuthoritativePromptEnvelope } from "../../application/useCases/assemblePromptEnvelopeUseCase";
import type { MemoryServiceTyped } from "../../application/services/memory";
import { attachSessionStateSnapshot } from "../../domain/chat/sessionStateSnapshot";
import {
  projectMessagePartsForProvider,
  type OpenAiProviderMessage,
} from "../../application/useCases/multimodalProviderProjection";
import { preserveAssistantReasoning } from "../../application/services/llmCompatibility";
import { resolveBuiltinProviderId } from "../../application/runtimePlugins/agentSpineRuntimePlugin";
import { setCompatibilityGenerationState } from "../../application/useCases/compatibilityGenerationState";
import { canRunSessionWithProfile, getSessionRuntimeProfileId } from "../../application/useCases/runtimeProfileSession";
import { resolveAgentSessionSettings } from "../../application/useCases/resolveAgentSessionSettings";


import { getErrorMessage, getErrorName } from '../../utils/errorUtils';
const logger = Logger.create("useRerollMessage");

interface RerollMessageParams {
  kernel: IKernel;
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
  pendingUpdateTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setSessionViews: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  setIsSending: (v: boolean) => void;
  setReplySuggestions: React.Dispatch<React.SetStateAction<ReplyChoice[]>>;
  publishMemoryAudit?: (snapshot: MemoryAuditSnapshot) => void;
  /** 迁移期兼容旧消费方；新代码应使用 publishMemoryAudit。 */
  publishRecalledMemories?: (sessionId: string, items: MemoryAuditSnapshot["recalled"]) => void;
  triggerScroll: (behavior?: "smooth" | "instant" | "auto") => void;
  databaseService: IDatabaseService<ChatSession, CharacterCard, SummaryCard, Message, ChatSessionMetadataPatch>;
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
  React.useLayoutEffect(() => {
    pRef.current = p;
  }, [p]);

  const handleRerollFromMessage = useCallback(async (targetMsg: Message) => {
    const p = pRef.current;
    p.setReplySuggestions([]);
    const traceId = generateTraceId();
    const log = logger.withTrace(traceId);

    const currentSession = p.sessionsRef.current.find((s) => s.id === p.activeSessionIdRef.current) || p.activeSession;

    const activeProfile = p.kernel.hasService?.(KernelServices.AgentRuntime)
      ? p.kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime)
        .getCompositionSnapshot()
      : null;
    if (!canRunSessionWithProfile(currentSession, activeProfile)) {
      await p.showCustomAlert(
        `此会话固定使用 ${getSessionRuntimeProfileId(currentSession)} v${currentSession?.compositionSnapshot?.profileVersion ?? "legacy"}，当前运行时为 ${activeProfile ? `${activeProfile.profileId} v${activeProfile.profileVersion}` : "未装载"}。请先切换 Agent Profile。`,
      );
      return;
    }

    // isSendingRef 是发送与重发共享的同步事务锁。
    // 不得以 streamingMessageId 为空作为“残留锁”判断：提示词构建、旧分支持久化期间
    // 尚未创建流式占位消息，第二次触发会因此误解锁并启动并行重发。
    if (p.isSendingRef.current) {
      return;
    }

    if (!targetMsg?.id || !p.activeCharacter || !currentSession) return;

    let effectiveSettings: UserSettings;
    try {
      effectiveSettings = resolveAgentSessionSettings(
        p.settings,
        currentSession.compositionSnapshot,
      );
    } catch (error: unknown) {
      await p.showCustomAlert(
        error instanceof Error && error.message.startsWith("AGENT_PROMPT_PRESET_NOT_FOUND")
          ? "此会话固定使用的行为预设已不存在，请恢复该预设或新建 Agent 会话。"
          : "此会话的 Agent 行为快照无效，已停止重发以避免静默改用其他配置。",
      );
      return;
    }

    // 立即锁定发送状态（防止异步弹窗与后续重复点击导致竞争）
    p.isSendingRef.current = true;
    p.setIsSending(true);
    setCompatibilityGenerationState(p.kernel, { isSending: true });

    // API 参数解析（试用 / 正式 Key 选择）：收口到 resolveApiCredentials helper
    let creds: ResolvedApiCredentials;
    try {
      creds = resolveApiCredentials(effectiveSettings, { requireModel: true });
    } catch (e) {
      if (e instanceof TrialExhaustedError) {
        await p.showCustomAlert("💡 您的 10 次公共免 Key 体验次数已用完，请前往\"设置 -> API配置\"中填写您自己的 API Key。");
        p.isSendingRef.current = false;
        p.setIsSending(false);
        setCompatibilityGenerationState(p.kernel, { isSending: false });
        return;
      }
      if (e instanceof ModelNotConfiguredError) {
        await p.showCustomAlert("重发失败: 目前尚未配置具体的接口模型，请前往设置[接口]页面获取并选择。");
        p.isSendingRef.current = false;
        p.setIsSending(false);
        setCompatibilityGenerationState(p.kernel, { isSending: false });
        return;
      }
      throw e;
    }
    const { apiKey: finalApiKey, baseUrl: finalBaseUrl, model: finalModel, chatPath: finalChatPath, isTrial: isTrialMode } = creds;

    const requestId = ++p.activeRequestIdRef.current;

    const rawMessages = currentSession.messages || [];
    // 重发目标定位与截断必须基于全量消息列表：若按"剔除占位符与空正文"后的
    // 历史定位，"正文为空但带思维链"的已完成助手消息会被过滤掉而无法重发。
    const targetIdx = rawMessages.findIndex((m) => m.id === targetMsg.id);
    if (targetIdx === -1) {
      await p.showCustomAlert("该消息已不存在或已被清理，无法重新生成。");
      p.isSendingRef.current = false;
      p.setIsSending(false);
      setCompatibilityGenerationState(p.kernel, { isSending: false });
      return;
    }

    if (targetIdx < rawMessages.length - 1) {
      const ok = await p.showCustomConfirm("从该条对白开始重新生成，将会抹除整条分支此后的所有对话。确认继续吗？");
      if (!ok) {
        p.isSendingRef.current = false;
        p.setIsSending(false);
        setCompatibilityGenerationState(p.kernel, { isSending: false });
        return;
      }
    }

    const nextMsgsIdx = targetMsg.sender === "user" ? targetIdx + 1 : targetIdx;
    const nextMsgs = rawMessages.slice(0, nextMsgsIdx);

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
      setCompatibilityGenerationState(p.kernel, { isSending: false });
      return;
    }

    const modelToReport = effectiveSettings.api.apiKey ? (effectiveSettings.api.modelName || FALLBACK_MODEL) : "openrouter/free";
    p.telemetryService.reportUsage("regenerate_message", { modelName: modelToReport, characterName: p.activeCharacter.name, traceId });

    const removedMessageIds = rawMessages.slice(nextMsgsIdx).map((message) => message.id);
    // 重发可能截断到归档边界之前（对已归档消息重发）：同步维护年表卡片与
    // 最后总结位置，避免 lastSummarizedMessageId 悬空导致折叠与总结失效。
    const reconciled = reconcileSummaryBoundary(
      removedMessageIds,
      currentSession.summaries,
      currentSession.lastSummarizedMessageId
    );
    let updatedSession = {
      ...currentSession,
      messages: nextMsgs,
      summaries: reconciled.summaries,
      lastSummarizedMessageId: reconciled.lastSummarizedMessageId,
    };
    let restoredState: ChatSessionMetadataPatch;
    try {
      restoredState = await p.databaseService.getSessionStateBeforeMessage(
        currentSession.id,
        targetMsg.id,
      );
    } catch (error) {
      log.error("Failed to restore session state for reroll", error);
      await p.showCustomAlert("无法恢复该时间点的变量与状态，已取消重新生成以避免污染存档。");
      p.isSendingRef.current = false;
      p.setIsSending(false);
      setCompatibilityGenerationState(p.kernel, { isSending: false });
      return;
    }
    const rerollParts = nextMsgs[lastUserIdx].parts ?? [];
    if (rerollParts.some(part => part.type !== "text")) {
      const needsVision = rerollParts.some(part => part.type === "image" || part.type === "video");
      const needsNativeAudio = rerollParts.some(part =>
        part.type === "audio" && part.purpose === "model-input",
      );
      const reason = needsVision && p.settings.api.supportsVision !== true
        ? "当前 API 配置未启用图片输入能力，请先在 API 配置中确认模型支持视觉输入。"
        : needsNativeAudio && p.settings.api.supportsAudioInput !== true
          ? "当前 API 配置未启用模型原生语音输入，请先确认当前模型支持 input_audio。"
        : p.settings.api.type === "anthropic" && (needsVision || needsNativeAudio)
          ? "当前阶段尚未提供 Anthropic 原生多模态投影，请改用 OpenAI-compatible 接口。"
          : null;
      if (reason) {
        await p.showCustomAlert(reason);
        p.isSendingRef.current = false;
        p.setIsSending(false);
        setCompatibilityGenerationState(p.kernel, { isSending: false });
        return;
      }
    }
    updatedSession = { ...updatedSession, ...restoredState };
    const persistRerollSession = (session: ChatSession) => {
      const newMessages = session.messages.slice(nextMsgs.length).map((message) =>
        message.sender === "assistant"
          ? attachSessionStateSnapshot(message, session)
          : message
      );
      const sessionWithSnapshots = {
        ...session,
        messages: [...session.messages.slice(0, nextMsgs.length), ...newMessages],
      };
      return p.databaseService.replaceSessionBranch(
        sessionWithSnapshots,
        removedMessageIds,
        newMessages,
      );
    };

    // 这里只更新 UI 工作副本；旧分支在生成成功前继续完整保留于数据库。
    p.setSessionViews((prev) => prev.map((s) => (s.id === updatedSession.id ? updatedSession : s)));
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
      p.setSessionViews, updatedSession.id, aiMsgId,
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
      let recalledMemories: RecalledMessage[] = [];
      try {
        const memoryService = p.kernel.getService<MemoryServiceTyped>("memory");
        if (memoryService && effectiveSettings.memory?.enableRecall !== false) {
          const recallTopK = effectiveSettings.memory?.recallTopK ?? 3;
          recalledMemories = await recallWithTimeout(
            memoryService.getRecall().recall(
              updatedSession.id,
              lastUserText,
              {
                topK: recallTopK,
                currentTurnIndex: targetMsg.turnIndex ?? nextMsgsIdx,
              }
            ),
            effectiveSettings.memory?.recallTimeoutMs,
            "useRerollMessage"
          );
        }
      } catch (err) {
        log.warn("Memory recall failed", err);
      }

      const { promptSession, promptEnvelope: promptPayload } = await assembleAuthoritativePromptEnvelope({
        databaseService: p.databaseService,
        promptService: p.promptService,
        character: p.activeCharacter!,
        session: updatedSession,
        userInput: lastUserText,
        settings: effectiveSettings,
        globalLorebook: combinedGlobals,
        recalledMemories,
        beforeMessageId: targetMsg.id,
        signal: controller.signal,
        traceId,
      });
      const assembledProviderMessages: OpenAiProviderMessage[] = promptPayload.messages;
      const baseProviderMessages = preserveAssistantReasoning(
        assembledProviderMessages,
        promptSession.messages,
        finalBaseUrl,
        finalModel,
      );
      const latestMultimodalUserMessage = [...promptSession.messages]
        .reverse()
        .find(message => message.sender === "user" && message.parts?.some(part => part.type !== "text"));
      const runtime = p.kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime);
      const provider = typeof runtime.getProvider === "function"
        ? runtime.getProvider(resolveBuiltinProviderId(p.settings.api.type))
        : {
            id: resolveBuiltinProviderId(p.settings.api.type),
            capabilities: {
              inputModalities: [
                "text" as const,
                ...(p.settings.api.supportsVision === true ? ["image" as const] : []),
                ...(p.settings.api.supportsAudioInput === true ? ["audio" as const] : []),
              ],
              supportedMimeTypes: [
                "image/png",
                "image/jpeg",
                "image/gif",
                "image/webp",
                "audio/wav",
                "audio/mpeg",
              ],
              supportsStreaming: true,
              supportsTools: false,
            },
          };
      const providerMessages = latestMultimodalUserMessage
        ? (await projectMessagePartsForProvider(
            baseProviderMessages,
            latestMultimodalUserMessage,
            p.kernel.getService<IAttachmentService>(KernelServices.Attachments),
            { providerId: provider.id, capabilities: provider.capabilities },
          )).messages
        : baseProviderMessages;

      const memoryAudit = buildMemoryAuditSnapshot({
        session: updatedSession,
        query: lastUserText,
        recalled: recalledMemories,
        settings: effectiveSettings,
        traces: promptPayload.traces,
        estimateTokens: (content) => p.promptService.estimateTokens(content),
      });
      if (p.publishMemoryAudit) p.publishMemoryAudit(memoryAudit);
      else p.publishRecalledMemories?.(updatedSession.id, recalledMemories);

      if (publicEnvironment.isDevelopment) {
        log.info("AI 发言重新生成流式开始");
      }
      // 关键修复：同步设置 streamingMessageId，与 useSendMessage 保持一致，避免 iframe 抢跑
      setCompatibilityGenerationState(p.kernel, { streamingMessageId: aiMsgId });
      const placeholderAiMsg = { id: aiMsgId, sender: "assistant" as const, content: "💭...", timestamp: Date.now() };
      p.setSessionViews((prev) =>
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
          messages: providerMessages,
          ...(promptPayload.stopSequences?.length ? { stop: promptPayload.stopSequences } : {}),
          temperature: effectiveSettings.preset.temperature,
          top_p: effectiveSettings.preset.topP,
          top_k: effectiveSettings.preset.topK,
          min_p: effectiveSettings.preset.minP,
          max_tokens: effectiveSettings.preset.maxTokens,
          presence_penalty: effectiveSettings.preset.presencePenalty ?? 0.0,
          frequency_penalty: effectiveSettings.preset.frequencyPenalty ?? 0.0,
          repetition_penalty: effectiveSettings.preset.repetitionPenalty ?? 1.0,
        },
        signal: controller.signal,
        traceId,
      });

      for await (const chunk of stream) {
        if (chunk.error) {
          const errMsg = typeof chunk.error === "string"
            ? chunk.error
            : ((chunk.error as { message?: string }).message || JSON.stringify(chunk.error));
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

          if (reasoning) reasoningChunks.push(reasoning);
          if (delta) {
            responseChunks.push(delta);
            if (isFirstTokenForSpeed) { isFirstTokenForSpeed = false; ttftMs = performance.now() - startTime; }
          }
          if (chunk.usage) {
            tokenUsage = { prompt: chunk.usage.prompt_tokens || 0, completion: chunk.usage.completion_tokens || 0 };
          }
        }
        throttledUpdate(responseChunks.join(""), reasoningChunks.join(""));
      }

      if (publicEnvironment.isDevelopment) {
        log.debug("RAW AI RESPONSE", {
          content: responseChunks.join(""),
          reasoning: reasoningChunks.length > 0 ? reasoningChunks.join("") : undefined,
        });
      }

      isStreamActiveRef.current = false;
      if (p.pendingUpdateTimeoutRef.current) { clearTimeout(p.pendingUpdateTimeoutRef.current); p.pendingUpdateTimeoutRef.current = null; }
      // 流式正常完成：清除 streamingMessageId
      setCompatibilityGenerationState(p.kernel, { streamingMessageId: null });

      const latestSession = p.sessionsRef.current.find((s) => s.id === updatedSession.id);
      if (!latestSession) { log.warn("Aborted save, session was deleted", { sessionId: updatedSession.id }); return; }
      // 若期间已有更新的重发请求接管（requestId 被推进），本请求结果必须丢弃，
      // 否则会出现低概率的“连续发两条”。
      if (requestId !== p.activeRequestIdRef.current) {
        log.warn("Superseded reroll result discarded", { requestId, activeRequestId: p.activeRequestIdRef.current });
        return;
      }

      // 关键修复：流式"正常完成"但 AI 返回空内容（与 useSendMessage 一致）
      const rawResponseText = responseChunks.join("");
      const rawReasoningText = reasoningChunks.join("");
      if (!rawResponseText.trim() && !rawReasoningText.trim()) {
        log.warn("流式正常结束但 AI 返回空内容，判定为重新生成失败");
        const isStillActive = p.activeSessionIdRef.current === updatedSession.id;
        // 尚未提交分支事务，直接恢复原始会话即可。
        const restoreSession = currentSession;
        if (isStillActive) {
          p.setSessionViews((prev) => prev.map((s) => (s.id === restoreSession.id ? restoreSession : s)));
          p.showCustomAlert("重新生成失败：AI 未返回任何内容，请检查 API 配置、网络连接或模型是否可用。");
        }
        return;
      }

      const { finalAiMsg, replyChoices } = buildFinalAiMessage({
        aiMsgId, responseText: responseChunks.join(""), reasoningText: reasoningChunks.join(""),
        startTime, tokenUsage, enableReplySuggestions: p.settings.enableReplySuggestions ?? false, latestSession,
      });

      if (p.settings.enableReplySuggestions && replyChoices.length > 0) {
        p.setReplySuggestions(replyChoices);
      }

      const trueFinalSession = replacePlaceholderMessage(latestSession, finalAiMsg);
      const isStillActive = p.activeSessionIdRef.current === updatedSession.id;

      if (isStillActive) {
        await runOutputPipelineAndSave({
          kernel: p.kernel,
          session: trueFinalSession,
          responseText: extractThinkContent(responseChunks.join("").trim(), reasoningChunks.join("").trim(), false).content,
          reasoningText: extractThinkContent(responseChunks.join("").trim(), reasoningChunks.join("").trim(), false).reasoningContent || "",
          settings: effectiveSettings,
          activeCharacter: p.activeCharacter!,
          controller,
          isStillActive,
          isBisonConsecutive: false,
          bisonRemainingCount: 0,
          setSessionViews: p.setSessionViews,
          databaseService: p.databaseService,
          persistSession: persistRerollSession,
          triggerScroll: () => p.triggerScroll(),
          traceId,
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
            p.settings.userName,
            traceId
          );
        } catch (telemetryErr) {
          log.warn("Failed to report LLM performance telemetry", { error: telemetryErr });
        }
      } else {
        await persistRerollSession(trueFinalSession);
        log.info("Session switched during reroll, saved silently", { sessionId: updatedSession.id });
      }
    } catch (e: unknown) {
      const responseText = responseChunks.join("");
      if (requestId !== p.activeRequestIdRef.current) {
        // 当前请求已被新请求取代，清理旧占位符（仅当占位符未被替换为真实内容时）
        const latestSessionForCleanup = p.sessionsRef.current.find((s) => s.id === updatedSession.id);
        if (latestSessionForCleanup) {
          const placeholderMsg = latestSessionForCleanup.messages.find((m) => m.id === aiMsgId);
          if (placeholderMsg && (placeholderMsg.content === "💭..." || !placeholderMsg.content?.trim())) {
            const nextSession = { ...latestSessionForCleanup, messages: latestSessionForCleanup.messages.filter((m) => m.id !== aiMsgId) };
            p.setSessionViews((prev) => prev.map((s) => (s.id === nextSession.id ? nextSession : s)));
          }
        }
        return;
      }
      isStreamActiveRef.current = false;
      if (p.pendingUpdateTimeoutRef.current) { clearTimeout(p.pendingUpdateTimeoutRef.current); p.pendingUpdateTimeoutRef.current = null; }
      // 异常/中断分支：清除 streamingMessageId
      setCompatibilityGenerationState(p.kernel, { streamingMessageId: null });
      const isManualAbort = getErrorName(e) === "AbortError" || getErrorMessage(e)?.includes("aborted") || controller.signal.aborted;
      const isStillActive = p.activeSessionIdRef.current === updatedSession.id;
      const latestSession = p.sessionsRef.current.find((s) => s.id === updatedSession.id);

      // 试用 Key 拉取失败：提示用户配置自己的 API Key，不展示通用连接异常信息
      if (e instanceof TrialKeyFetchError) {
        if (isStillActive) {
          await p.showCustomAlert("💡 免费试用服务暂不可用，请前往\"设置 -> API配置\"中填写您自己的 API Key。");
        }
        if (latestSession) {
          const nextSession = { ...latestSession, messages: latestSession.messages.filter((m) => m.id !== aiMsgId) };
          if (isStillActive) p.setSessionViews((prev) => prev.map((s) => (s.id === nextSession.id ? nextSession : s)));
        }
        return;
      }

      if (isManualAbort) {
        if (responseText.trim().length > 0 && latestSession) {
          const parsed = extractThinkContent(responseText.trim(), undefined, false);
          const finishedAiMsg = { id: aiMsgId, sender: "assistant" as const, content: parsed.content, timestamp: Date.now(), reasoningContent: parsed.reasoningContent };
          const trueFinalSession = replacePlaceholderMessage(latestSession, finishedAiMsg);
          if (isStillActive) {
            await runOutputPipelineAndSave({ kernel: p.kernel, session: trueFinalSession, responseText: parsed.content, reasoningText: parsed.reasoningContent || "", settings: effectiveSettings, activeCharacter: p.activeCharacter!, controller, isStillActive, isBisonConsecutive: false, bisonRemainingCount: 0, setSessionViews: p.setSessionViews, databaseService: p.databaseService, persistSession: persistRerollSession, traceId });
          } else {
            await persistRerollSession(trueFinalSession);
          }
        } else if (latestSession) {
          const nextSession = currentSession;
          if (isStillActive) p.setSessionViews((prev) => prev.map((s) => (s.id === nextSession.id ? nextSession : s)));
        }
      } else {
        if (isStillActive) {
          log.error("AI Regeneration failed", e);
          p.telemetryService.reportUsage("api_error", { detail: String(getErrorMessage(e) || "Unknown error"), playerName: p.settings.userName, characterName: p.activeCharacter!.name, modelName: p.settings.api.modelName, sessionId: updatedSession.id, traceId });
        }
        if (responseText.trim().length > 0 && latestSession) {
          const parsed = extractThinkContent(responseText.trim(), undefined, false);
          const finishedAiMsg = { id: aiMsgId, sender: "assistant" as const, content: (parsed.content || "") + CONNECTION_INTERRUPTED_SUFFIX, timestamp: Date.now(), reasoningContent: parsed.reasoningContent };
          const trueFinalSession = replacePlaceholderMessage(latestSession, finishedAiMsg);
          if (isStillActive) {
            await runOutputPipelineAndSave({ kernel: p.kernel, session: trueFinalSession, responseText: parsed.content, responseSuffix: CONNECTION_INTERRUPTED_SUFFIX, reasoningText: parsed.reasoningContent || "", settings: effectiveSettings, activeCharacter: p.activeCharacter!, controller, isStillActive, isBisonConsecutive: false, bisonRemainingCount: 0, setSessionViews: p.setSessionViews, databaseService: p.databaseService, persistSession: persistRerollSession, traceId });
          } else {
            await persistRerollSession(trueFinalSession);
          }
        } else {
          // 纯失败不提交任何分支变更，恢复重发前的完整会话。
          if (isStillActive) {
            p.setSessionViews((prev) => prev.map((s) => (s.id === currentSession.id ? currentSession : s)));
            p.showCustomAlert(`重新生成失败：${getErrorMessage(e) || "未知错误"}`);
          }
        }
        if (isStillActive) p.triggerScroll();
      }
    } finally {
      isStreamActiveRef.current = false;
      if (p.pendingUpdateTimeoutRef.current) { clearTimeout(p.pendingUpdateTimeoutRef.current); p.pendingUpdateTimeoutRef.current = null; }
      // finally 兜底：确保 streamingMessageId 被清除，避免任何未捕获路径残留导致 FormattedText 卡死
      setCompatibilityGenerationState(p.kernel, { streamingMessageId: null });
      if (p.abortControllerRef.current === controller) p.abortControllerRef.current = null;
      if (requestId === p.activeRequestIdRef.current) {
        p.isSendingRef.current = false;
        p.setIsSending(false);
        setCompatibilityGenerationState(p.kernel, { isSending: false });
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
