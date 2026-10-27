import React, { useCallback } from "react";
import { publicEnvironment } from "../../config";
import { ChatSession, ChatSessionMetadataPatch, UserSettings, CharacterCard, LorebookEntry, CustomWorldbook, ReplyChoice, Message, SummaryCard } from "../../types";
import {
  IDatabaseService, IPromptService,
  ITelemetryService, IChatStreamService, IMultiMessageService,
  StreamChunk, IKernel, IAttachmentService, IAgentRuntimeService, IToolPluginRuntimeService, IExternalSourceRuntimeService, KernelServices,
} from "@/src/application/serviceContracts";
import type {
  AgentHandle,
  AgentTurnExecutionContext,
} from "../../domain/agents/contracts";
import {
  collectMessageAssetIds,
  getMessageContentText,
  normalizeMessageContentParts,
  type MessageContentPart,
} from "../../domain/messages/messageContent";
import type { MemoryServiceTyped } from "../../application/services/memory";
import { FALLBACK_MODEL } from "../../utils/apiClient";
import { preserveAssistantReasoning } from "../../application/services/llmCompatibility";
import {
  resolveApiCredentials,
  TrialExhaustedError,
  TrialKeyFetchError,
  ModelNotConfiguredError,
  type ResolvedApiCredentials,
} from "../../utils/resolveApiCredentials";
import {
  generateUniqueId, buildThrottledUpdater, buildFinalAiMessage,
  replacePlaceholderMessage,
  incrementTrialCount,
} from "./helpers";
import { extractThinkContent } from "./helpers";
import { processTurnMediaParts } from "./helpers/processTurnMediaParts";
import { CONNECTION_INTERRUPTED_SUFFIX, runOutputPipelineAndSave } from "./pipelineHelpers";
import type { MemoryAuditSnapshot } from "../../application/services/memory/types";
import { Logger, generateTraceId } from "../../utils/logger";
import { assembleAuthoritativePromptEnvelope } from "../../application/useCases/assemblePromptEnvelopeUseCase";
import type { PromptAuditSnapshot } from "../../domain/promptAudit";
import { recallMemoriesForTurn } from "./helpers/recallForTurn";
import { resolveTurnContextContributions } from "../../application/contextSources/resolveTurnContextContributions";
import { publishTurnMemoryAudit } from "./helpers/publishMemoryAudit";
import { createFreshnessPort, createTurnToken, isStale } from "../../application/useCases/turnToken";
import {
  projectMessagePartsForProvider,
  type OpenAiProviderMessage,
} from "../../application/useCases/multimodalProviderProjection";
import {
  AUDIO_TRANSCRIPT_PREFIX,
  describeMultimodalSendRefusal,
  hasAudioTranscriptPart,
  resolveMultimodalSendRefusal,
} from "../../application/useCases/multimodalSendGuards";
import { buildSendFailureAlert } from "../../application/useCases/sendFailureDiagnostics";
import {
  executeOpenAiToolLoop,
  OpenAiToolCallAccumulator,
  type OpenAiToolLoopModelStep,
} from "../../application/useCases/openAiToolLoop";
import { setCompatibilityGenerationState } from "../../application/useCases/compatibilityGenerationState";
import { canRunSessionWithProfile, getSessionRuntimeProfileId } from "../../application/useCases/runtimeProfileSession";
import { resolveAgentSessionSettings } from "../../application/useCases/resolveAgentSessionSettings";
import { resolveSessionEnabledToolNames } from "../../application/useCases/sessionToolComposition";
import {
  MOBILE_TAVERN_CHAT_DRIVER_ID,
  AUDIO_ASR_PROCESSOR_ID,
  VIDEO_KEYFRAME_PROCESSOR_ID,
  resolveBuiltinProviderId,
} from "../../application/runtimePlugins";

import { getErrorMessage, getErrorName } from '../../utils/errorUtils';
const logger = Logger.create("useSendMessage");

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
  pendingUpdateTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  bisonRemainingCountRef: React.MutableRefObject<number>;
  // P1-8: Bison 连续推进 setTimeout 的 timer id，供会话切换/卸载/手动停止时清理
  bisonChainTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setSessionViews: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  setIsSending: (v: boolean) => void;
  setIsBisonLocking: React.Dispatch<React.SetStateAction<boolean>>;
  setReplySuggestions: React.Dispatch<React.SetStateAction<ReplyChoice[]>>;
  publishMemoryAudit?: (snapshot: MemoryAuditSnapshot) => void;
  /** 发布本轮 Prompt 组装审计（世界书命中与提示词分区），仅保留在运行时。 */
  publishPromptAudit?: (snapshot: PromptAuditSnapshot) => void;
  /** 迁移期兼容旧消费方；新代码应使用 publishMemoryAudit。 */
  publishRecalledMemories?: (sessionId: string, items: MemoryAuditSnapshot["recalled"]) => void;
  triggerScroll: (behavior?: "smooth" | "instant" | "auto") => void;
  databaseService: IDatabaseService<ChatSession, CharacterCard, SummaryCard, Message, ChatSessionMetadataPatch>;
  promptService: IPromptService;
  telemetryService: ITelemetryService;
  chatStreamService: IChatStreamService;
  multiMessageService: IMultiMessageService<ChatSession>;
  /**
   * 记忆服务实例，由外部注入以解耦对 globalKernel 单例的直接依赖。
   * 若为 undefined 则跳过记忆召回。
   */
  memoryService?: MemoryServiceTyped;
  showCustomAlert: (msg: string) => void | Promise<void>;
  draftsRef: React.MutableRefObject<Record<string, string>>;
}

interface SendMessageOptions {
  isBisonConsecutive?: boolean;
  skipAI?: boolean;
  attachmentIds?: string[];
  attachmentParts?: MessageContentPart[];
}

/**
 * 封装"发送消息"与 Bison 连续推进逻辑的 Hook，
 * 不包含任何 UI 状态管理。
 */
export function useSendMessage(p: SendMessageParams) {
  const pRef = React.useRef<SendMessageParams>(p);
  React.useLayoutEffect(() => {
    pRef.current = p;
  }, [p]);
  const agentHandleRef = React.useRef<AgentHandle | null>(null);
  const agentHandleKeyRef = React.useRef<string | null>(null);
  const runLegacyTurnRef = React.useRef<(
    textToSend: string,
    options: SendMessageOptions | undefined,
    context: AgentTurnExecutionContext,
  ) => Promise<void>>(async () => undefined);
  const sendThroughAgentRef = React.useRef<(
    textToSend: string,
    options?: SendMessageOptions,
  ) => Promise<unknown>>(async () => undefined);

  /**
   * 旧版发送链路。
   * 返回 false 表示被前置校验/守卫拒绝（此时**不得**清空输入区的草稿与附件），
   * 返回 true 表示用户消息已落库（哪怕随后 API 失败，界面也应清空以免重复发送）。
   */
  const runLegacyTurn = useCallback(async (
    textToSend: string,
    options?: SendMessageOptions,
    agentTurn?: AgentTurnExecutionContext,
  ): Promise<boolean> => {
    const p = pRef.current;
    const isBisonConsecutive = !!options?.isBisonConsecutive;
    const skipAI = !!options?.skipAI;
    const additionalParts = options?.attachmentParts
      ?? (options?.attachmentIds ?? []).map(assetId => ({ type: "image" as const, assetId }));
    const attachmentIds = Array.from(new Set(additionalParts.flatMap(part =>
      collectMessageAssetIds([part]),
    )));
    const hasNewUserContent = typeof textToSend === "string"
      && (textToSend.trim().length > 0 || attachmentIds.length > 0);
    let isBisonChainActive = false;
    const traceId = generateTraceId();
    const log = logger.withTrace(traceId);

    p.telemetryService.incrementUsageCount();
    p.setReplySuggestions([]);

    if (!isBisonConsecutive) {
      const hasUnsentUserMessages =
        p.activeSession &&
        Array.isArray(p.activeSession.messages) &&
        p.activeSession.messages.length > 0 &&
        p.activeSession.messages[p.activeSession.messages.length - 1].sender === "user";

      if (
        !hasNewUserContent &&
        !hasUnsentUserMessages
      ) return false;

      // isSendingRef 是发送与重发共享的同步事务锁；React state 仅负责 UI 展示。
      // streamingMessageId 只覆盖流式阶段，不能用于推断提示词构建或持久化阶段是否空闲。
      if (p.isSendingRef.current) {
        return false;
      }

      if (!p.activeCharacter || !p.activeSession) return false;

      const latestQueuedUserMessage = hasUnsentUserMessages
        ? p.activeSession.messages[p.activeSession.messages.length - 1]
        : undefined;
      const pendingMultimodalParts = additionalParts.length > 0
        ? additionalParts
        : latestQueuedUserMessage?.parts?.filter(part => part.type !== "text") ?? [];
      const needsMultimodalProjection = pendingMultimodalParts.length > 0;
      if (!skipAI && needsMultimodalProjection) {
        const agentRuntime = p.kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime);
        const attachmentAudioParts = pendingMultimodalParts.filter((part) =>
          part.type === "audio" && part.purpose !== "model-input",
        );
        const canInspectMediaProcessors = typeof agentRuntime.listMediaProcessors === "function";
        const registeredMediaProcessors = canInspectMediaProcessors
          ? agentRuntime.listMediaProcessors().map((processor) => processor.id)
          : [];
        const provider = agentTurn?.provider
          ?? agentRuntime.getProvider(resolveBuiltinProviderId(p.settings.api.type));
        const refusal = resolveMultimodalSendRefusal({
          parts: pendingMultimodalParts,
          // 转写要从未滤除文本的部件里找：新附件不可能有转写，队列里的旧消息可能有。
          hasAudioTranscript: hasAudioTranscriptPart(
            additionalParts.length > 0
              ? additionalParts
              : latestQueuedUserMessage?.parts ?? pendingMultimodalParts,
          ),
          providerCapabilities: provider.capabilities,
          plainAudioProcessorMissing: !!agentTurn
            && canInspectMediaProcessors
            && attachmentAudioParts.length > 0
            && !registeredMediaProcessors.includes(AUDIO_ASR_PROCESSOR_ID),
          plainAudioTranscriptionDisabled: attachmentAudioParts.length > 0
            && !(p.settings.asrConfig?.enabled === true && p.settings.asrConfig.provider === "openai"),
          videoKeyframesMissing: !!agentTurn
            && canInspectMediaProcessors
            && pendingMultimodalParts.some((part) => part.type === "video")
            && !registeredMediaProcessors.includes(VIDEO_KEYFRAME_PROCESSOR_ID),
        });
        // 必须在这里拦：消息一旦落库，投影阶段的异常会留下一轮永远发不出去的对话。
        if (refusal) {
          await p.showCustomAlert(describeMultimodalSendRefusal(refusal));
          return false;
        }
      }

      const modelToReport = p.settings.api.apiKey
        ? (p.settings.api.modelName || FALLBACK_MODEL)
        : "openrouter/free";
      p.telemetryService.reportUsage("send_message", {
        modelName: modelToReport,
        characterName: p.activeCharacter.name,
        traceId,
      });
    } else {
      if (!p.activeCharacter || !p.activeSession) return false;
    }

    if (!isBisonConsecutive && p.activeSessionIdRef.current) {
      p.draftsRef.current[p.activeSessionIdRef.current] = "";
    }

    // skipAI：仅保存用户消息，不调用 LLM
    if (skipAI && !isBisonConsecutive && hasNewUserContent) {
      try {
        const updatedSession = await p.multiMessageService.queueUserMessage(
          p.activeSession!,
          textToSend,
          additionalParts,
        );
        p.setSessionViews((prev) => prev.map((s) => (s.id === updatedSession.id ? updatedSession : s)));
      } catch (err: unknown) {
        log.error("Failed to save session user message", err);
        if (attachmentIds.length > 0) {
          await p.showCustomAlert("附件消息保存失败，附件已保留在输入区，请重试。");
          throw err;
        }
      }
      p.triggerScroll("smooth");
      return true;
    }

    // API 参数解析（试用 / 正式 Key 选择）：收口到 resolveApiCredentials helper
    let creds: ResolvedApiCredentials;
    try {
      creds = resolveApiCredentials(p.settings, { requireModel: true });
    } catch (e) {
      if (e instanceof TrialExhaustedError) {
        p.showCustomAlert("💡 您的 10 次公共免 Key 体验次数已用完，请前往\"设置 -> API配置\"中填写您自己的 API Key。");
        return false;
      }
      if (e instanceof ModelNotConfiguredError) {
        p.showCustomAlert("对话失败: 目前尚未配置具体的接口模型，请前往设置[接口]页面获取并选择。");
        return false;
      }
      throw e;
    }
    const { apiKey: finalApiKey, baseUrl: finalBaseUrl, model: finalModel, chatPath: finalChatPath, isTrial: isTrialMode } = creds;

    let currentSession = p.sessionsRef.current.find((s) => s.id === p.activeSessionIdRef.current) || p.activeSession;
    if (!currentSession) return false;
    if (!currentSession.compositionSnapshot && agentTurn) {
      const baseCompositionSnapshot = p.kernel
        .getService<IAgentRuntimeService>(KernelServices.AgentRuntime)
        .getCompositionSnapshot();
      const toolComposition = baseCompositionSnapshot && p.kernel.hasService(KernelServices.ToolConnectors)
        ? p.kernel.getService<IToolPluginRuntimeService>(KernelServices.ToolConnectors).extendComposition(baseCompositionSnapshot)
        : baseCompositionSnapshot;
      const compositionSnapshot = toolComposition && p.kernel.hasService(KernelServices.ExternalSources)
        ? p.kernel.getService<IExternalSourceRuntimeService>(KernelServices.ExternalSources).extendComposition(toolComposition)
        : toolComposition;
      if (compositionSnapshot) {
        await p.databaseService.updateSessionMetadata(currentSession.id, { compositionSnapshot });
        const sessionWithComposition = { ...currentSession, compositionSnapshot };
        currentSession = sessionWithComposition;
        p.setSessionViews((previous) => previous.map((session) =>
          session.id === sessionWithComposition.id ? sessionWithComposition : session,
        ));
      }
    }
    let effectiveSettings: UserSettings;
    try {
      effectiveSettings = resolveAgentSessionSettings(
        p.settings,
        currentSession.compositionSnapshot,
      );
    } catch {
      await p.showCustomAlert("此会话的 Agent 行为快照无效，已停止发送以避免静默改用其他配置。");
      return false;
    }
    p.isSendingRef.current = true;
    p.setIsSending(true);
    setCompatibilityGenerationState(p.kernel, { isSending: true });

    const requestId = ++p.activeRequestIdRef.current;
    let updatedSession = currentSession;

    // 关键修复：流式消息 ID 精确标记
    // 解决 isSending React state 异步更新延迟导致的 iframe 抢跑问题：
    //   1. 流式开始瞬间 isSending 可能还是 false → FormattedText 误判为非流式 → 直接渲染 iframe（抢跑）
    //   2. Bison 模式 500ms 间隔内 isSending 仍为 true，已完成的第一条消息被误判为流式 → iframe 被替换为 loading placeholder（丢失）
    // 通过可选 Compatibility Host 同步标记当前正在生成的消息 ID。
    const __streamingMsgIdGuard = (v: string | null) => {
      setCompatibilityGenerationState(p.kernel, { streamingMessageId: v });
    };

    if (!isBisonConsecutive && hasNewUserContent) {
      try {
        updatedSession = await p.multiMessageService.queueUserMessage(
          currentSession,
          textToSend,
          additionalParts,
        );
        p.setSessionViews((prev) => prev.map((s) => (s.id === updatedSession.id ? updatedSession : s)));
      } catch (err: unknown) {
        log.error("Failed to save session user message", err);
        p.isSendingRef.current = false;
        p.setIsSending(false);
        setCompatibilityGenerationState(p.kernel, { isSending: false });
        if (attachmentIds.length > 0) {
          await p.showCustomAlert("附件消息保存失败，附件已保留在输入区，请重试。");
          throw err;
        }
        return false;
      }
      p.triggerScroll("smooth");
    }

    const controller = new AbortController();
    // 本轮新鲜度：唯一判断入口，替代散落的 activeSessionIdRef 比较（STATE-AUTHORITY:R3）。
    const freshnessPort = createFreshnessPort(p.activeSessionIdRef, p.sessionsRef);
    const turnToken = createTurnToken({
      sessionId: updatedSession.id, signal: controller.signal, baseRevision: updatedSession.contentRevision,
    });
    p.abortControllerRef.current = controller;
    const relayAgentAbort = () => {
      if (!controller.signal.aborted) controller.abort(agentTurn?.signal.reason);
    };
    if (agentTurn?.signal.aborted) relayAgentAbort();
    else agentTurn?.signal.addEventListener("abort", relayAgentAbort, { once: true });

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
      // 组合 Lorebook：全局 + 其他角色世界书 + 自定义世界书
      const otherCharGlobals = p.characters
        .filter((c) => c.isWorldbookGlobal && c.id !== p.activeCharacter!.id)
        .flatMap((c) => c.lorebookEntries || []);
      const customWorldbookGlobals = (Object.values(p.customWorldbooks || {}) as CustomWorldbook[])
        .filter((wb) => wb.enabled)
        .flatMap((wb) => wb.entries || []);
      const combinedGlobals = [...(p.globalLorebook || []), ...otherCharGlobals, ...customWorldbookGlobals];

      // 1. 异步执行记忆召回
      const recalledMemories = await recallMemoriesForTurn({
        memoryService: p.memoryService,
        enabled: effectiveSettings.memory?.enableRecall !== false,
        sessionId: updatedSession.id,
        query: isBisonConsecutive ? "" : textToSend,
        topK: effectiveSettings.memory?.recallTopK ?? 3,
        timeoutMs: effectiveSettings.memory?.recallTimeoutMs,
        log,
      });
      // 记忆召回与注册来源走同一通道进入提示词：与注册来源同类型，只是取值来源不同。
      const contextContributions = await resolveTurnContextContributions(
        p.kernel, recalledMemories,
        { sessionId: updatedSession.id, userInput: isBisonConsecutive ? "" : textToSend, signal: controller.signal },
      );

      // 媒体降级（ASR 转写 / 视频关键帧）抽到 helper：只在这里被调用一次。
      if (agentTurn) {
        updatedSession = await processTurnMediaParts({
          session: updatedSession,
          agentTurn,
          settings: effectiveSettings,
          databaseService: p.databaseService,
          setSessionViews: p.setSessionViews,
          signal: controller.signal,
          log,
        });
      }

      const { promptSession, promptEnvelope: promptPayload } = await assembleAuthoritativePromptEnvelope({
        databaseService: p.databaseService,
        promptService: p.promptService,
        character: p.activeCharacter!,
        session: updatedSession,
        userInput: isBisonConsecutive ? "" : textToSend,
        settings: effectiveSettings,
        globalLorebook: combinedGlobals,
        contextContributions,
        signal: controller.signal,
        traceId,
        generationType: "normal",
      });
      if (promptPayload.audit) p.publishPromptAudit?.(promptPayload.audit);

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
      const provider = agentTurn?.provider
        ?? p.kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime)
          .getProvider(resolveBuiltinProviderId(p.settings.api.type));
      const projection = latestMultimodalUserMessage
        ? await projectMessagePartsForProvider(
            baseProviderMessages,
            latestMultimodalUserMessage,
            p.kernel.getService<IAttachmentService>(KernelServices.Attachments),
            { providerId: provider.id, capabilities: provider.capabilities },
          )
        : {
            messages: baseProviderMessages,
            decision: {
              providerId: provider.id,
              messageId: promptSession.messages[promptSession.messages.length - 1]?.id ?? "none",
              strategy: "text-only" as const,
              sourceAssetIds: [] as string[],
              projectedAssetIds: [] as string[],
            },
          };
      const providerMessages = projection.messages;
      await agentTurn?.recordDecision("media.projection", projection.decision);

      // 审计快照只保留在当前聊天运行时，不写入会话。
      publishTurnMemoryAudit(
        { publishMemoryAudit: p.publishMemoryAudit, publishRecalledMemories: p.publishRecalledMemories,
          estimateTokens: (content) => p.promptService.estimateTokens(content) },
        { session: promptSession, query: isBisonConsecutive ? "" : textToSend, recalled: recalledMemories,
          settings: effectiveSettings, contextContributions },
      );

      // 放置 AI 消息占位符
      log.info("AI 发言流式开始");
      // 关键：在添加占位符之前同步设置 streamingMessageId，
      // 确保 MessageBubble 首次渲染占位符时 isStreaming 就能精确命中（避免 iframe 抢跑）
      __streamingMsgIdGuard(aiMsgId);
      const placeholderAiMsg = { id: aiMsgId, sender: "assistant" as const, content: "💭...", timestamp: Date.now() };
      p.setSessionViews((prev) =>
        prev.map((s) => s.id === updatedSession.id ? { ...s, messages: [...s.messages, placeholderAiMsg] } : s)
      );

      const executeProviderStep = async (step: OpenAiToolLoopModelStep) => {
        responseChunks.splice(0, responseChunks.length);
        reasoningChunks.splice(0, reasoningChunks.length);
        const toolCallAccumulator = new OpenAiToolCallAccumulator();
        const commonRequestBody: Record<string, unknown> = {
          model: finalModel,
          stream: true,
          ...(p.settings.api.type !== "anthropic" && !p.settings.api.forceBasicParams && {
            stream_options: { include_usage: true }
          }),
          messages: [...providerMessages, ...step.continuationMessages],
          ...(step.tools.length > 0 ? { tools: step.tools, tool_choice: "auto" } : {}),
          ...(promptPayload.stopSequences?.length ? { stop: promptPayload.stopSequences } : {}),
          temperature: effectiveSettings.preset.temperature,
          top_p: effectiveSettings.preset.topP,
          top_k: effectiveSettings.preset.topK,
          top_a: effectiveSettings.preset.topA,
          min_p: effectiveSettings.preset.minP,
          max_tokens: isBisonConsecutive ? 300 : effectiveSettings.preset.maxTokens,
          presence_penalty: effectiveSettings.preset.presencePenalty ?? 0.0,
          frequency_penalty: effectiveSettings.preset.frequencyPenalty ?? 0.0,
          repetition_penalty: effectiveSettings.preset.repetitionPenalty ?? 1.0,
          // ST 约定 seed < 0 为随机；不发送才能让服务端每次重新采样。
          ...(typeof effectiveSettings.preset.seed === "number" && effectiveSettings.preset.seed >= 0
            ? { seed: effectiveSettings.preset.seed }
            : {}),
        };
        const providerRequestBody = provider.buildRequestBody(commonRequestBody);
        await agentTurn?.recordDecision("provider.request", {
          step: step.step,
          providerId: provider.id,
          providerVersion: provider.version,
          model: finalModel,
          apiType: p.settings.api.type,
          streaming: provider.capabilities.supportsStreaming,
          tools: step.tools.map((tool) => tool.function.name),
        });

        const stream = p.chatStreamService.streamLlmResponse({
          baseUrl: finalBaseUrl,
          apiKey: finalApiKey,
          chatPath: finalChatPath,
          bypassProxy: p.settings.api.bypassProxy,
          disableReasoning: p.settings.api.disableReasoning,
          reasoningStrength: p.settings.api.reasoningStrength,
          forceBasicParams: p.settings.api.forceBasicParams,
          reqBody: providerRequestBody,
          signal: controller.signal,
          traceId,
        });

        for await (const chunk of stream) {
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
            const choice = chunk.choices?.[0];
            const reasoning = choice?.delta?.reasoning_content;
            const delta = choice?.delta?.content || choice?.message?.content || choice?.text;
            const finishReason = choice?.finish_reason;
            toolCallAccumulator.append(choice?.delta?.tool_calls ?? choice?.message?.tool_calls);

            if (finishReason === "content_filter") {
              throw new Error("内容被服务商的安全过滤（Content Filter）拦截，生成终止。");
            }
            if (reasoning) reasoningChunks.push(reasoning);
            if (delta) {
              responseChunks.push(delta);
              if (isFirstTokenForSpeed) { isFirstTokenForSpeed = false; ttftMs = performance.now() - startTime; }
            }
            if (chunk.usage) {
              tokenUsage = {
                prompt: tokenUsage.prompt + (chunk.usage.prompt_tokens || 0),
                completion: tokenUsage.completion + (chunk.usage.completion_tokens || 0),
              };
            }
          }
          throttledUpdate(responseChunks.join(""), reasoningChunks.join(""));
        }
        return {
          content: responseChunks.join(""),
          toolCalls: toolCallAccumulator.finalize(),
          reasoningContent: reasoningChunks.join(""),
        };
      };

      if (agentTurn) {
        const runtime = p.kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime);
        // 统一入口：冻结快照仍会叠加"当前已启用的外部能力源"，启用 MCP 后无需新建会话。
        const enabledToolNames = new Set(resolveSessionEnabledToolNames({
          kernel: p.kernel,
          character: p.activeCharacter,
          sessionComposition: updatedSession.compositionSnapshot,
        }));
        await executeOpenAiToolLoop({
          context: agentTurn,
          // 声明 autoInvoke:false 的工具（如收费联网检索）不进入模型工具列表，只保留手动执行入口。
          tools: provider.capabilities.supportsTools && typeof runtime.listTools === "function"
            ? runtime.listTools().filter((tool) => enabledToolNames.has(tool.name) && tool.autoInvoke !== false)
            : [],
          executeModelStep: executeProviderStep,
        });
      } else {
        await executeProviderStep({ step: 0, continuationMessages: [], tools: [] });
      }

      if (publicEnvironment.isDevelopment) {
        log.debug("RAW AI RESPONSE", {
          content: responseChunks.join(""),
          reasoning: reasoningChunks.length > 0 ? reasoningChunks.join("") : undefined,
        });
      }

      isStreamActiveRef.current = false;
      if (p.pendingUpdateTimeoutRef.current) { clearTimeout(p.pendingUpdateTimeoutRef.current); p.pendingUpdateTimeoutRef.current = null; }
      // 流式正常完成：清除 streamingMessageId，触发 FormattedText 从 loading placeholder 切换到真实 iframe 渲染
      __streamingMsgIdGuard(null);

      const latestSession = p.sessionsRef.current.find((s) => s.id === updatedSession.id);
      if (!latestSession) { log.warn("Aborted save, session was deleted", { sessionId: updatedSession.id }); return true; }

      // 关键修复：流式"正常完成"但 AI 返回空内容（API 返回空响应/网络中断未 throw 等场景）
      // 旧逻辑：buildFinalAiMessage 生成 content 为空的消息 → UI 显示"*(未生成任何内容)*"但无报错弹窗
      // 新逻辑：检测空响应，显示报错弹窗 + 删除占位符，让用户明确知道发送失败
      const rawResponseText = responseChunks.join("");
      const rawReasoningText = reasoningChunks.join("");
      if (!rawResponseText.trim() && !rawReasoningText.trim()) {
        log.warn("流式正常结束但 AI 返回空内容，判定为发送失败");
        const isStillActive = !isStale(turnToken, freshnessPort);
        // 删除占位符，避免 UI 残留空消息
        const nextSession = { ...latestSession, messages: latestSession.messages.filter((m) => m.id !== aiMsgId) };
        if (isStillActive) {
          p.setSessionViews((prev) => prev.map((s) => (s.id === nextSession.id ? nextSession : s)));
          p.showCustomAlert("发送失败：AI 未返回任何内容，请检查 API 配置、网络连接或模型是否可用。");
        }
        return true;
      }

      const { finalAiMsg, replyChoices } = buildFinalAiMessage({
        aiMsgId, responseText: responseChunks.join(""), reasoningText: reasoningChunks.join(""),
        startTime, tokenUsage, enableReplySuggestions: p.settings.enableReplySuggestions ?? false, latestSession,
      });

      if (p.settings.enableReplySuggestions && replyChoices.length > 0) {
        p.setReplySuggestions(replyChoices);
      }

      const trueFinalSession = replacePlaceholderMessage(latestSession, finalAiMsg);
      const isStillActive = !isStale(turnToken, freshnessPort);

      if (isStillActive) {
        const outputCtx = await runOutputPipelineAndSave({
          kernel: p.kernel,
          session: trueFinalSession,
          responseText: extractThinkContent(responseChunks.join("").trim(), reasoningChunks.join("").trim(), false).content,
          reasoningText: extractThinkContent(responseChunks.join("").trim(), reasoningChunks.join("").trim(), false).reasoningContent || "",
          settings: effectiveSettings,
          activeCharacter: p.activeCharacter!,
          controller,
          isStillActive,
          isBisonConsecutive,
          bisonRemainingCount: p.bisonRemainingCountRef.current,
          setSessionViews: p.setSessionViews,
          databaseService: p.databaseService,
          triggerScroll: () => p.triggerScroll("smooth"),
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
            sendThroughAgentRef.current("", { isBisonConsecutive: true }).catch((err) =>
              log.error("Failed in bison consecutive send", err)
            );
          }, 500);
          p.bisonChainTimerRef.current = timer;
        } else {
          p.bisonRemainingCountRef.current = 0;
          p.setIsBisonLocking(false);
        }
      } else {
        const switchedAiMsg = trueFinalSession.messages[trueFinalSession.messages.length - 1];
        if (switchedAiMsg && switchedAiMsg.sender === "assistant") {
          await p.databaseService.commitSessionTurn(
            trueFinalSession.id,
            {
              variables: undefined,
              runtimePluginState: trueFinalSession.runtimePluginState,
              tableMemory: trueFinalSession.tableMemory,
            },
            [switchedAiMsg],
            undefined,
            traceId,
          )
            .catch((e) => log.error("Failed to save AI message after session switch", e));
          log.info("Session switched during generation, saved silently", { sessionId: updatedSession.id });
        }
      }
    } catch (err: unknown) {
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
            p.setSessionViews((prev) => prev.map((s) => (s.id === nextSession.id ? nextSession : s)));
          }
        }
        return true;
      }
      isStreamActiveRef.current = false;
      if (p.pendingUpdateTimeoutRef.current) { clearTimeout(p.pendingUpdateTimeoutRef.current); p.pendingUpdateTimeoutRef.current = null; }
      // 异常/中断分支：同样清除 streamingMessageId，避免残留导致 FormattedText 卡在 loading placeholder
      __streamingMsgIdGuard(null);

      const isManualAbort = getErrorName(err) === "AbortError" || getErrorMessage(err)?.includes("aborted") || controller.signal.aborted;
      const isStillActive = !isStale(turnToken, freshnessPort);
      const latestSession = p.sessionsRef.current.find((s) => s.id === updatedSession.id);

      // 试用 Key 拉取失败：提示用户配置自己的 API Key，不展示通用连接异常信息
      if (err instanceof TrialKeyFetchError) {
        if (isStillActive) {
          p.showCustomAlert("💡 免费试用服务暂不可用，请前往\"设置 -> API配置\"中填写您自己的 API Key。");
        }
        if (latestSession) {
          const nextSession = { ...latestSession, messages: latestSession.messages.filter((m) => m.id !== aiMsgId) };
          if (isStillActive) p.setSessionViews((prev) => prev.map((s) => (s.id === nextSession.id ? nextSession : s)));
        }
        return true;
      }

      if (isManualAbort) {
        if (responseText.trim().length > 0 && latestSession) {
          const parsed = extractThinkContent(responseText.trim(), undefined, false);
          const finishedAiMsg = { id: aiMsgId, sender: "assistant" as const, content: parsed.content, timestamp: Date.now(), reasoningContent: parsed.reasoningContent };
          const trueFinalSession = replacePlaceholderMessage(latestSession, finishedAiMsg);
          if (isStillActive) {
            await runOutputPipelineAndSave({ kernel: p.kernel, session: trueFinalSession, responseText: parsed.content, reasoningText: parsed.reasoningContent || "", settings: effectiveSettings, activeCharacter: p.activeCharacter!, controller, isStillActive, isBisonConsecutive: false, bisonRemainingCount: 0, setSessionViews: p.setSessionViews, databaseService: p.databaseService, traceId });
          } else {
            await p.databaseService.appendSessionMessage(trueFinalSession.id, finishedAiMsg, undefined, undefined, traceId)
              .catch((e) => log.error("Failed to save AI message on abort", e));
          }
        } else if (latestSession) {
          const nextSession = { ...latestSession, messages: latestSession.messages.filter((m) => m.id !== aiMsgId) };
          if (isStillActive) p.setSessionViews((prev) => prev.map((s) => (s.id === nextSession.id ? nextSession : s)));
        }
      } else {
        if (isStillActive) {
          log.error("AI Generation failed", err);
          p.telemetryService.reportUsage("api_error", {
            detail: String(getErrorMessage(err) || "Unknown error"),
            playerName: p.settings.userName,
            characterName: p.activeCharacter?.name || "未知",
            modelName: p.settings.api.modelName,
            sessionId: updatedSession.id,
            traceId,
          });
          const rawMsg = String(getErrorMessage(err) || "未知错误");
          p.showCustomAlert(buildSendFailureAlert(rawMsg));
        }
        if (responseText.trim().length > 0 && latestSession) {
          const parsed = extractThinkContent(responseText.trim(), undefined, false);
          const finishedAiMsg = { id: aiMsgId, sender: "assistant" as const, content: (parsed.content || "") + CONNECTION_INTERRUPTED_SUFFIX, timestamp: Date.now(), reasoningContent: parsed.reasoningContent };
          const trueFinalSession = replacePlaceholderMessage(latestSession, finishedAiMsg);
          if (isStillActive) {
            await runOutputPipelineAndSave({ kernel: p.kernel, session: trueFinalSession, responseText: parsed.content, responseSuffix: CONNECTION_INTERRUPTED_SUFFIX, reasoningText: parsed.reasoningContent || "", settings: effectiveSettings, activeCharacter: p.activeCharacter!, controller, isStillActive, isBisonConsecutive: false, bisonRemainingCount: 0, setSessionViews: p.setSessionViews, databaseService: p.databaseService, traceId });
          } else {
            await p.databaseService.appendSessionMessage(trueFinalSession.id, finishedAiMsg, undefined, undefined, traceId)
              .catch((e) => log.error("Failed to save AI message on error", e));
          }
        } else if (latestSession) {
          const nextSession = { ...latestSession, messages: latestSession.messages.filter((m) => m.id !== aiMsgId) };
          if (isStillActive) p.setSessionViews((prev) => prev.map((s) => (s.id === nextSession.id ? nextSession : s)));
        }
      }
    } finally {
      agentTurn?.signal.removeEventListener("abort", relayAgentAbort);
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
          setCompatibilityGenerationState(p.kernel, { isSending: false });
        }
      }
    }
    return true;
  }, []);
  React.useLayoutEffect(() => {
    runLegacyTurnRef.current = async (textToSend, options, context) => {
      await runLegacyTurn(textToSend, options, context);
    };
  }, [runLegacyTurn]);

  const ensureAgentHandle = useCallback((): AgentHandle | null => {
    const current = pRef.current;
    const sessionId = current.activeSessionIdRef.current ?? current.activeSession?.id;
    if (!sessionId) return null;
    const providerId = resolveBuiltinProviderId(current.settings.api.type);
    const runtime = current.kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime);
    // 与发送链路共用同一套工具解析：外部能力源是实时开关，冻结快照也会叠加当前已启用来源。
    const enabledToolNames = resolveSessionEnabledToolNames({
      kernel: current.kernel,
      character: current.activeCharacter,
      sessionComposition: current.activeSession?.compositionSnapshot,
    });
    const enabledToolNameSet = new Set(enabledToolNames);
    const registeredTools = typeof runtime.listTools === "function" ? runtime.listTools() : [];
    const enabledTools = registeredTools.filter((tool) => enabledToolNameSet.has(tool.name) && tool.autoInvoke !== false);
    const handleKey = `${sessionId}:${MOBILE_TAVERN_CHAT_DRIVER_ID}:${providerId}:${enabledToolNames.join(",")}`;
    if (agentHandleRef.current && agentHandleKeyRef.current === handleKey) {
      return agentHandleRef.current;
    }
    if (agentHandleRef.current) void agentHandleRef.current.dispose();
    const handle = runtime.openHandle({
      sessionId,
      driverId: MOBILE_TAVERN_CHAT_DRIVER_ID,
      providerId,
      executeLegacy: (context) => runLegacyTurnRef.current(
        context.input.text,
        {
          isBisonConsecutive: context.input.continuation,
          skipAI: context.input.skipModel,
          attachmentIds: [...context.input.attachmentIds],
          attachmentParts: context.input.attachmentParts
            ? [...context.input.attachmentParts]
            : undefined,
        },
        context,
      ),
      grantedPermissions: [...new Set(enabledTools.flatMap((tool) => tool.permissions))],
      enabledToolNames,
    });
    agentHandleRef.current = handle;
    agentHandleKeyRef.current = handleKey;
    return handle;
  }, []);

  const handleSendMessage = useCallback(async (
    textToSend: string,
    options?: SendMessageOptions,
  ): Promise<boolean> => {
    const current = pRef.current;
    const activeProfile = current.kernel
      .getService<IAgentRuntimeService>(KernelServices.AgentRuntime)
      .getCompositionSnapshot();
    if (!canRunSessionWithProfile(current.activeSession, activeProfile)) {
      await current.showCustomAlert(
        `此会话固定使用 ${getSessionRuntimeProfileId(current.activeSession)} v${current.activeSession?.compositionSnapshot?.profileVersion ?? "legacy"}，当前运行时为 ${activeProfile ? `${activeProfile.profileId} v${activeProfile.profileVersion}` : "未装载"}。请在设置 → 插件与 Agent Profiles 中切换后再继续。`,
      );
      return false;
    }
    const handle = ensureAgentHandle();
    if (!handle) {
      return await runLegacyTurn(textToSend, options);
    }
    const agentAttachmentIds = options?.attachmentParts
      ? collectMessageAssetIds(options.attachmentParts)
      : options?.attachmentIds ?? [];
    await handle.send({
      text: textToSend,
      attachmentIds: Array.from(new Set(agentAttachmentIds)),
      attachmentParts: options?.attachmentParts ? [...options.attachmentParts] : undefined,
      skipModel: options?.skipAI,
      continuation: options?.isBisonConsecutive,
    });
    return true;
  }, [ensureAgentHandle, runLegacyTurn]);
  React.useLayoutEffect(() => {
    sendThroughAgentRef.current = handleSendMessage;
  }, [handleSendMessage]);

  const stopLegacyGeneration = useCallback(() => {
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
    setCompatibilityGenerationState(p.kernel, { isSending: false });
    p.bisonRemainingCountRef.current = 0;
    p.setIsBisonLocking(false);
  }, []);

  const handleStopGeneration = useCallback(() => {
    void agentHandleRef.current?.stop("user");
    stopLegacyGeneration();
  }, [stopLegacyGeneration]);

  React.useEffect(() => () => {
    const handle = agentHandleRef.current;
    agentHandleRef.current = null;
    agentHandleKeyRef.current = null;
    if (handle) void handle.dispose();
  }, [p.activeSession?.id, p.settings.api.type]);

  return { handleSendMessage, handleStopGeneration };
}

function findLastUserMessageIndex(messages: readonly Message[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].sender === "user") return index;
  }
  return -1;
}
