import React, { useCallback } from "react";
import { publicEnvironment } from "../../config";
import { ChatSession, ChatSessionMetadataPatch, UserSettings, CharacterCard, LorebookEntry, CustomWorldbook, ReplyChoice, Message, SummaryCard } from "../../types";
import {
  IDatabaseService, IPromptService,
  ITelemetryService, IChatStreamService, IMultiMessageService,
  StreamChunk, IKernel, IAttachmentService, IAgentRuntimeService, IToolPluginRuntimeService, KernelServices,
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
import {
  resolveApiCredentials,
  TrialExhaustedError,
  TrialKeyFetchError,
  ModelNotConfiguredError,
  type ResolvedApiCredentials,
} from "../../utils/resolveApiCredentials";
import {
  generateUniqueId, buildThrottledUpdater, buildFinalAiMessage, recallWithTimeout,
  replacePlaceholderMessage,
  incrementTrialCount,
} from "./helpers";
import { extractThinkContent } from "./helpers";
import { CONNECTION_INTERRUPTED_SUFFIX, runOutputPipelineAndSave } from "./pipelineHelpers";
import type { MemoryAuditSnapshot, RecalledMessage } from "../../application/services/memory/types";
import { buildMemoryAuditSnapshot } from "../../application/services/memory/MemoryAudit";
import { Logger, generateTraceId } from "../../utils/logger";
import { buildAuthoritativePromptSession } from "../../application/useCases/promptHistoryUseCases";
import {
  projectMessagePartsForProvider,
  type OpenAiProviderMessage,
} from "../../application/useCases/multimodalProviderProjection";
import { isDirectApiCharacter } from "../../domain/agents/directApiMode";
import {
  executeOpenAiToolLoop,
  OpenAiToolCallAccumulator,
  type OpenAiToolLoopModelStep,
} from "../../application/useCases/openAiToolLoop";
import { setCompatibilityGenerationState } from "../../application/useCases/compatibilityGenerationState";
import { canRunSessionWithProfile, getSessionRuntimeProfileId } from "../../application/useCases/runtimeProfileSession";
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
  ) => Promise<void>>(async () => undefined);

  const runLegacyTurn = useCallback(async (
    textToSend: string,
    options?: SendMessageOptions,
    agentTurn?: AgentTurnExecutionContext,
  ) => {
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
      ) return;

      // isSendingRef 是发送与重发共享的同步事务锁；React state 仅负责 UI 展示。
      // streamingMessageId 只覆盖流式阶段，不能用于推断提示词构建或持久化阶段是否空闲。
      if (p.isSendingRef.current) {
        return;
      }

      if (!p.activeCharacter || !p.activeSession) return;

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
        const modelAudioParts = pendingMultimodalParts.filter((part) =>
          part.type === "audio" && part.purpose === "model-input",
        );
        const canInspectMediaProcessors = typeof agentRuntime.listMediaProcessors === "function";
        const registeredMediaProcessors = canInspectMediaProcessors
          ? agentRuntime.listMediaProcessors().map((processor) => processor.id)
          : [];
        if (
          agentTurn
          && canInspectMediaProcessors
          && attachmentAudioParts.length > 0
          && !registeredMediaProcessors.includes(AUDIO_ASR_PROCESSOR_ID)
        ) {
          await p.showCustomAlert("当前 Agent Profile 未启用音频 ASR 降级，无法把音频发送给当前 Provider。");
          return;
        }
        if (
          agentTurn
          && canInspectMediaProcessors
          && pendingMultimodalParts.some((part) => part.type === "video")
          && !registeredMediaProcessors.includes(VIDEO_KEYFRAME_PROCESSOR_ID)
        ) {
          await p.showCustomAlert("当前 Agent Profile 未启用视频关键帧降级，无法把视频发送给当前 Provider。");
          return;
        }
        if (
          attachmentAudioParts.length > 0
          && (!p.settings.asrConfig?.enabled || p.settings.asrConfig.provider !== "openai")
        ) {
          await p.showCustomAlert("发送音频前需要启用 OpenAI ASR 文件转写；Web Speech 仅支持实时麦克风输入。");
          return;
        }
        if (modelAudioParts.length > 0 && p.settings.api.supportsAudioInput !== true) {
          await p.showCustomAlert("当前 API 配置未启用模型原生语音输入，请先确认当前模型支持 input_audio。");
          return;
        }
        const needsVision = pendingMultimodalParts.some(part =>
          part.type === "image" || part.type === "video",
        );
        if (needsVision && p.settings.api.supportsVision !== true) {
          await p.showCustomAlert("当前 API 配置未启用图片输入能力，请先在 API 配置中确认模型支持视觉输入。");
          return;
        }
        const provider = agentTurn?.provider
          ?? agentRuntime.getProvider(resolveBuiltinProviderId(p.settings.api.type));
        const unsupportedPart = pendingMultimodalParts.find(part => {
          if (part.type === "audio") {
            return part.purpose === "model-input"
              && !provider.capabilities.inputModalities.includes("audio");
          }
          const requiredModality = part.type === "video" ? "image" : part.type;
          return !provider.capabilities.inputModalities.includes(requiredModality);
        });
        if (unsupportedPart) {
          await p.showCustomAlert(`当前 Provider 未声明 ${unsupportedPart.type} 输入能力，请切换 Provider 或配置媒体降级。`);
          return;
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
      if (!p.activeCharacter || !p.activeSession) return;
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
      return;
    }

    // API 参数解析（试用 / 正式 Key 选择）：收口到 resolveApiCredentials helper
    let creds: ResolvedApiCredentials;
    try {
      creds = resolveApiCredentials(p.settings, { requireModel: true });
    } catch (e) {
      if (e instanceof TrialExhaustedError) {
        p.showCustomAlert("💡 您的 10 次公共免 Key 体验次数已用完，请前往\"设置 -> API配置\"中填写您自己的 API Key。");
        return;
      }
      if (e instanceof ModelNotConfiguredError) {
        p.showCustomAlert("对话失败: 目前尚未配置具体的接口模型，请前往设置[接口]页面获取并选择。");
        return;
      }
      throw e;
    }
    const { apiKey: finalApiKey, baseUrl: finalBaseUrl, model: finalModel, chatPath: finalChatPath, isTrial: isTrialMode } = creds;

    let currentSession = p.sessionsRef.current.find((s) => s.id === p.activeSessionIdRef.current) || p.activeSession;
    if (!currentSession) return;
    if (!currentSession.compositionSnapshot && agentTurn) {
      const baseCompositionSnapshot = p.kernel
        .getService<IAgentRuntimeService>(KernelServices.AgentRuntime)
        .getCompositionSnapshot();
      const compositionSnapshot = baseCompositionSnapshot && p.kernel.hasService(KernelServices.ToolConnectors)
        ? p.kernel.getService<IToolPluginRuntimeService>(KernelServices.ToolConnectors).extendComposition(baseCompositionSnapshot)
        : baseCompositionSnapshot;
      if (compositionSnapshot) {
        await p.databaseService.updateSessionMetadata(currentSession.id, { compositionSnapshot });
        const sessionWithComposition = { ...currentSession, compositionSnapshot };
        currentSession = sessionWithComposition;
        p.setSessionViews((previous) => previous.map((session) =>
          session.id === sessionWithComposition.id ? sessionWithComposition : session,
        ));
      }
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
        return;
      }
      p.triggerScroll("smooth");
    }

    const controller = new AbortController();
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
      let recalledMemories: RecalledMessage[] = [];
      try {
        const memoryService = p.memoryService;
        if (memoryService && p.settings.memory?.enableRecall !== false) {
          const recallTopK = p.settings.memory?.recallTopK ?? 3;
          recalledMemories = await recallWithTimeout(
            memoryService.getRecall().recall(
              updatedSession.id,
              isBisonConsecutive ? "" : textToSend,
              { topK: recallTopK }
            ),
            p.settings.memory?.recallTimeoutMs,
            "useSendMessage"
          );
          if (publicEnvironment.isDevelopment) {
            log.info("记忆召回完成", { count: recalledMemories.length, topK: recallTopK });
          }
        } else {
          if (publicEnvironment.isDevelopment) {
            log.warn("memoryService 未注入，跳过召回");
          }
        }
      } catch (err) {
        log.warn("Memory recall failed", err);
      }

      const latestUserIndex = findLastUserMessageIndex(updatedSession.messages);
      const latestUserMessage = latestUserIndex >= 0 ? updatedSession.messages[latestUserIndex] : undefined;
      if (agentTurn && latestUserMessage?.parts) {
        const processedParts: MessageContentPart[] = [];
        let mediaChanged = false;
        for (const part of latestUserMessage.parts) {
          if (part.type === "audio") {
            const hasTranscript = latestUserMessage.parts.some(candidate =>
              candidate.type === "text" && candidate.text.startsWith("[音频转写]"),
            );
            processedParts.push(part);
            if (part.purpose !== "model-input" && !hasTranscript) {
              const result = await agentTurn.processMedia(AUDIO_ASR_PROCESSOR_ID, {
                assetId: part.assetId,
                kind: "audio",
                options: p.settings.asrConfig,
              });
              processedParts.push(...result.projectionParts);
              mediaChanged = true;
            }
            continue;
          }
          if (part.type === "video" && (!part.frameAssetIds || part.frameAssetIds.length === 0)) {
            const result = await agentTurn.processMedia(VIDEO_KEYFRAME_PROCESSOR_ID, {
              assetId: part.assetId,
              kind: "video",
            });
            processedParts.push(...result.projectionParts);
            mediaChanged = true;
            continue;
          }
          processedParts.push(part);
        }
        if (mediaChanged) {
          const normalizedParts = normalizeMessageContentParts(processedParts);
          const processedMessage: Message = {
            ...latestUserMessage,
            contentVersion: 2,
            parts: normalizedParts,
            content: getMessageContentText(normalizedParts),
          };
          await p.databaseService.updateSessionMessage(
            updatedSession.id,
            processedMessage,
            {},
            controller.signal,
          );
          updatedSession = {
            ...updatedSession,
            messages: updatedSession.messages.map((message, index) =>
              index === latestUserIndex ? processedMessage : message,
            ),
          };
          p.setSessionViews(previous => previous.map(session =>
            session.id === updatedSession.id ? updatedSession : session,
          ));
        }
      }

      const promptSession = await buildAuthoritativePromptSession(
        p.databaseService,
        updatedSession,
        p.settings,
      );
      const promptPayload = p.promptService.assemblePrompt({
        character: p.activeCharacter!,
        chat: promptSession,
        userInput: isBisonConsecutive ? "" : textToSend,
        settings: p.settings,
        globalLorebook: combinedGlobals,
        recalledMemories: recalledMemories,
        signal: controller.signal,
        traceId,
      });

      const baseProviderMessages: OpenAiProviderMessage[] = promptPayload.messages || [
        {
          role: "system",
          content: [promptPayload.systemInstruction, promptPayload.dynamicInstruction].filter(Boolean).join("\n\n"),
        },
        ...promptPayload.history.map((historyMessage: { role: "model" | "user" | "assistant"; name?: string; content: string }) => {
          const providerMessage: OpenAiProviderMessage = {
            role: historyMessage.role === "model" ? "assistant" : historyMessage.role,
            content: historyMessage.content,
          };
          if (p.settings.api.sendNames && historyMessage.name) providerMessage.name = historyMessage.name;
          return providerMessage;
        }),
      ];

      // DeepSeek 思考模式 + tools：官方要求历史 assistant 消息必须回传 reasoning_content，否则 400。
      // 编译链路不保留思维链，这里按 content 精确匹配从原始会话消息回填。
      if (finalBaseUrl?.toLowerCase().includes("api.deepseek.com")) {
        const reasoningByContent = new Map<string, string>();
        for (const sessionMessage of promptSession.messages) {
          if (
            sessionMessage.sender === "assistant"
            && typeof sessionMessage.content === "string"
            && sessionMessage.reasoningContent
          ) {
            reasoningByContent.set(sessionMessage.content, sessionMessage.reasoningContent);
          }
        }
        if (reasoningByContent.size > 0) {
          for (const providerMessage of baseProviderMessages) {
            if (providerMessage.role === "assistant" && typeof providerMessage.content === "string") {
              const reasoning = reasoningByContent.get(providerMessage.content);
              if (reasoning) providerMessage.reasoning_content = reasoning;
            }
          }
        }
      }
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

      // 审计快照以最终 Prompt 编排轨迹为准，只保留在当前聊天运行时。
      const memoryAudit = buildMemoryAuditSnapshot({
        session: promptSession,
        query: isBisonConsecutive ? "" : textToSend,
        recalled: recalledMemories,
        settings: p.settings,
        traces: promptPayload.traces,
        estimateTokens: (content) => p.promptService.estimateTokens(content),
      });
      if (p.publishMemoryAudit) p.publishMemoryAudit(memoryAudit);
      else p.publishRecalledMemories?.(updatedSession.id, recalledMemories);

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
          temperature: p.settings.preset.temperature,
          top_p: p.settings.preset.topP,
          top_k: p.settings.preset.topK,
          min_p: p.settings.preset.minP,
          max_tokens: isBisonConsecutive ? 300 : p.settings.preset.maxTokens,
          presence_penalty: p.settings.preset.presencePenalty ?? 0.0,
          frequency_penalty: p.settings.preset.frequencyPenalty ?? 0.0,
          repetition_penalty: p.settings.preset.repetitionPenalty ?? 1.0,
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
            if (reasoning && !delta) {
              reasoningChunks.push(reasoning);
            } else if (delta) {
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
        const enabledToolNames = new Set(isDirectApiCharacter(p.activeCharacter!)
          ? []
          : updatedSession.compositionSnapshot?.contributionOrder.tool
            ?? runtime.getCompositionSnapshot()?.contributionOrder.tool
            ?? []);
        await executeOpenAiToolLoop({
          context: agentTurn,
          tools: provider.capabilities.supportsTools && typeof runtime.listTools === "function"
            ? runtime.listTools().filter((tool) => enabledToolNames.has(tool.name))
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
      if (!latestSession) { log.warn("Aborted save, session was deleted", { sessionId: updatedSession.id }); return; }

      // 关键修复：流式"正常完成"但 AI 返回空内容（API 返回空响应/网络中断未 throw 等场景）
      // 旧逻辑：buildFinalAiMessage 生成 content 为空的消息 → UI 显示"*(未生成任何内容)*"但无报错弹窗
      // 新逻辑：检测空响应，显示报错弹窗 + 删除占位符，让用户明确知道发送失败
      const rawResponseText = responseChunks.join("");
      const rawReasoningText = reasoningChunks.join("");
      if (!rawResponseText.trim() && !rawReasoningText.trim()) {
        log.warn("流式正常结束但 AI 返回空内容，判定为发送失败");
        const isStillActive = p.activeSessionIdRef.current === updatedSession.id;
        // 删除占位符，避免 UI 残留空消息
        const nextSession = { ...latestSession, messages: latestSession.messages.filter((m) => m.id !== aiMsgId) };
        if (isStillActive) {
          p.setSessionViews((prev) => prev.map((s) => (s.id === nextSession.id ? nextSession : s)));
          p.showCustomAlert("发送失败：AI 未返回任何内容，请检查 API 配置、网络连接或模型是否可用。");
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
        return;
      }
      isStreamActiveRef.current = false;
      if (p.pendingUpdateTimeoutRef.current) { clearTimeout(p.pendingUpdateTimeoutRef.current); p.pendingUpdateTimeoutRef.current = null; }
      // 异常/中断分支：同样清除 streamingMessageId，避免残留导致 FormattedText 卡在 loading placeholder
      __streamingMsgIdGuard(null);

      const isManualAbort = getErrorName(err) === "AbortError" || getErrorMessage(err)?.includes("aborted") || controller.signal.aborted;
      const isStillActive = p.activeSessionIdRef.current === updatedSession.id;
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
        return;
      }

      if (isManualAbort) {
        if (responseText.trim().length > 0 && latestSession) {
          const parsed = extractThinkContent(responseText.trim(), undefined, false);
          const finishedAiMsg = { id: aiMsgId, sender: "assistant" as const, content: parsed.content, timestamp: Date.now(), reasoningContent: parsed.reasoningContent };
          const trueFinalSession = replacePlaceholderMessage(latestSession, finishedAiMsg);
          if (isStillActive) {
            await runOutputPipelineAndSave({ kernel: p.kernel, session: trueFinalSession, responseText: parsed.content, reasoningText: parsed.reasoningContent || "", settings: p.settings, activeCharacter: p.activeCharacter!, controller, isStillActive, isBisonConsecutive: false, bisonRemainingCount: 0, setSessionViews: p.setSessionViews, databaseService: p.databaseService, traceId });
          } else {
            await p.databaseService.appendSessionMessage(trueFinalSession.id, finishedAiMsg, undefined, undefined, traceId)
              .catch((e) => log.error("Failed to save AI message on abort", e));
          }
        } else if (latestSession) {
          const nextSession = { ...latestSession, messages: latestSession.messages.filter((m) => m.id !== aiMsgId) };
          if (isStillActive) p.setSessionViews((prev) => prev.map((s) => (s.id === nextSession.id ? nextSession : s)));
        }
      } else {
        if (isStillActive) p.showCustomAlert("发送失败，对话连接异常: " + getErrorMessage(err));
        if (responseText.trim().length > 0 && latestSession) {
          const parsed = extractThinkContent(responseText.trim(), undefined, false);
          const finishedAiMsg = { id: aiMsgId, sender: "assistant" as const, content: (parsed.content || "") + CONNECTION_INTERRUPTED_SUFFIX, timestamp: Date.now(), reasoningContent: parsed.reasoningContent };
          const trueFinalSession = replacePlaceholderMessage(latestSession, finishedAiMsg);
          if (isStillActive) {
            await runOutputPipelineAndSave({ kernel: p.kernel, session: trueFinalSession, responseText: parsed.content, responseSuffix: CONNECTION_INTERRUPTED_SUFFIX, reasoningText: parsed.reasoningContent || "", settings: p.settings, activeCharacter: p.activeCharacter!, controller, isStillActive, isBisonConsecutive: false, bisonRemainingCount: 0, setSessionViews: p.setSessionViews, databaseService: p.databaseService, traceId });
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
    const baseComposition = current.activeSession?.compositionSnapshot ?? runtime.getCompositionSnapshot();
    const composition = !current.activeSession?.compositionSnapshot
      && baseComposition
      && current.kernel.hasService(KernelServices.ToolConnectors)
      ? current.kernel.getService<IToolPluginRuntimeService>(KernelServices.ToolConnectors).extendComposition(baseComposition)
      : baseComposition;
    const enabledToolNames = isDirectApiCharacter(current.activeCharacter!)
      ? []
      : composition?.contributionOrder.tool ?? [];
    const enabledToolNameSet = new Set(enabledToolNames);
    const registeredTools = typeof runtime.listTools === "function" ? runtime.listTools() : [];
    const enabledTools = registeredTools.filter((tool) => enabledToolNameSet.has(tool.name));
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
  ): Promise<void> => {
    const current = pRef.current;
    const activeProfile = current.kernel
      .getService<IAgentRuntimeService>(KernelServices.AgentRuntime)
      .getCompositionSnapshot();
    if (!canRunSessionWithProfile(current.activeSession, activeProfile)) {
      await current.showCustomAlert(
        `此会话固定使用 ${getSessionRuntimeProfileId(current.activeSession)} v${current.activeSession?.compositionSnapshot?.profileVersion ?? "legacy"}，当前运行时为 ${activeProfile ? `${activeProfile.profileId} v${activeProfile.profileVersion}` : "未装载"}。请在设置 → 插件与 Agent Profiles 中切换后再继续。`,
      );
      return;
    }
    const handle = ensureAgentHandle();
    if (!handle) {
      await runLegacyTurn(textToSend, options);
      return;
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
