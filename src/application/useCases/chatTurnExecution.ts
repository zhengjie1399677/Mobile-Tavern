import type {
  AgentHandle,
  AgentProviderCapabilities,
  AgentProviderDefinition,
  AgentTurnExecutionContext,
} from "../../domain/agents/contracts";
import type { ContextContribution } from "../../domain/contextSources/contracts";
import type { PromptAuditSnapshot } from "../../domain/promptAudit";
import type {
  CharacterCard,
  ChatSession,
  ChatSessionMetadataPatch,
  CustomWorldbook,
  LorebookEntry,
  Message,
  SummaryCard,
  UserSettings,
} from "../../types";
import {
  KernelServices,
  type IAgentRuntimeService,
  type IAttachmentService,
  type IChatStreamService,
  type IDatabaseService,
  type IKernel,
  type IKernelService,
  type IPromptService,
  type StreamChunk,
} from "../serviceContracts";
import {
  MOBILE_TAVERN_CHAT_DRIVER_ID,
  resolveBuiltinProviderId,
} from "../runtimePlugins/agentSpineRuntimePlugin";
import { resolveTurnContextContributions } from "../contextSources/resolveTurnContextContributions";
import { preserveAssistantReasoning } from "../services/llmCompatibility";
import { buildMemoryAuditSnapshot } from "../services/memory/MemoryAudit";
import type { MemoryAuditSnapshot, RecalledMessage } from "../services/memory/types";
import { assembleAuthoritativePromptEnvelope } from "./assemblePromptEnvelopeUseCase";
import {
  projectMessagePartsForProvider,
  type OpenAiProviderMessage,
} from "./multimodalProviderProjection";
import {
  executeOpenAiToolLoop,
  OpenAiToolCallAccumulator,
  type OpenAiToolLoopModelStep,
} from "./openAiToolLoop";
import { resolveSessionEnabledToolNames } from "./sessionToolComposition";

/** Shared helper: merge global lorebook, other global character books, and enabled custom worldbooks. */
export function combineTurnLorebooks(
  globalLorebook: readonly LorebookEntry[] | undefined,
  characters: readonly CharacterCard[],
  customWorldbooks: Readonly<Record<string, CustomWorldbook>> | undefined,
  activeCharacterId: string,
): LorebookEntry[] {
  const otherCharGlobals = characters
    .filter((character) => character.isWorldbookGlobal && character.id !== activeCharacterId)
    .flatMap((character) => character.lorebookEntries || []);
  const customWorldbookGlobals = (Object.values(customWorldbooks || {}) as CustomWorldbook[])
    .filter((worldbook) => worldbook.enabled)
    .flatMap((worldbook) => worldbook.entries || []);
  return [...(globalLorebook || []), ...otherCharGlobals, ...customWorldbookGlobals];
}

/**
 * Compute authoritative 0-based `turnIndex` for turn context sources on both Send and Reroll.
 *
 * Uses persisted `turnIndex` metadata when available so paginated message windows
 * keep global turn alignment across initial sends and regenerations.
 */
export function resolveTurnIndexForContext(
  messages: readonly Message[],
  targetMsg?: Message,
): number {
  if (targetMsg && typeof targetMsg.turnIndex === "number") {
    return targetMsg.sender === "user" ? targetMsg.turnIndex + 1 : targetMsg.turnIndex;
  }
  let historySlice = messages;
  if (targetMsg) {
    const targetIdx = messages.findIndex(
      (message) => message === targetMsg || (targetMsg.id && message.id === targetMsg.id),
    );
    if (targetIdx >= 0) {
      historySlice = messages.slice(
        0,
        targetMsg.sender === "user" ? targetIdx + 1 : targetIdx,
      );
    }
  }
  for (let i = historySlice.length - 1; i >= 0; i -= 1) {
    const turnIndex = historySlice[i]?.turnIndex;
    if (typeof turnIndex === "number") {
      return turnIndex + (historySlice.length - i);
    }
  }
  return historySlice.length;
}

export interface PublishTurnMemoryAuditPorts {
  readonly publishMemoryAudit?: (snapshot: MemoryAuditSnapshot) => void;
  readonly publishRecalledMemories?: (
    sessionId: string,
    items: MemoryAuditSnapshot["recalled"],
  ) => void;
  readonly estimateTokens: (content: string) => number;
}

/** Build and publish runtime memory audit snapshot without writing transient fields into ChatSession. */
export function publishTurnMemoryAuditSnapshot(
  ports: PublishTurnMemoryAuditPorts,
  input: {
    readonly session: ChatSession;
    readonly query: string;
    readonly recalled: RecalledMessage[];
    readonly settings: UserSettings;
    readonly contextContributions?: readonly ContextContribution[];
  },
): void {
  const snapshot = buildMemoryAuditSnapshot({
    session: input.session,
    query: input.query,
    recalled: input.recalled,
    settings: input.settings,
    ...(input.contextContributions ? { contextContributions: input.contextContributions } : {}),
    estimateTokens: ports.estimateTokens,
  });
  if (ports.publishMemoryAudit) ports.publishMemoryAudit(snapshot);
  else ports.publishRecalledMemories?.(input.session.id, input.recalled);
}

/** Resolve active AgentProviderDefinition with safe fallback for minimal test doubles. */
export function resolveTurnProvider(
  kernel: IKernel,
  settings: UserSettings,
  agentTurn?: AgentTurnExecutionContext,
): AgentProviderDefinition {
  if (agentTurn?.provider) return agentTurn.provider;
  const providerId = resolveBuiltinProviderId(settings.api.type);
  const runtime = safeGetKernelService<IAgentRuntimeService>(kernel, KernelServices.AgentRuntime);
  if (typeof runtime?.getProvider === "function") {
    return runtime.getProvider(providerId);
  }
  const fallbackCapabilities: AgentProviderCapabilities = {
    inputModalities: [
      "text",
      "image",
      ...(settings.api.supportsAudioInput === true ? ["audio" as const] : []),
    ],
    supportedMimeTypes: [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "audio/wav",
      "audio/mpeg",
      "audio/mp3",
    ],
    supportsStreaming: true,
    supportsTools: false,
  };
  return {
    id: providerId,
    version: "1.0.0",
    capabilities: fallbackCapabilities,
    buildRequestBody: (request) => ({ ...request }),
  };
}

export interface EnsureChatAgentHandleParams {
  readonly kernel: IKernel;
  readonly settings: UserSettings;
  readonly activeCharacter: CharacterCard | null;
  readonly session: ChatSession | null;
  readonly sessionIdOverride?: string | null;
  readonly handleRef: { current: AgentHandle | null };
  readonly handleKeyRef: { current: string | null };
  readonly executeLegacy: (context: AgentTurnExecutionContext) => Promise<void>;
}

/**
 * Shared AgentHandle lifecycle opener/memoizer bound to `mobile-tavern.chat.driver`.
 * Safely returns `null` only when the injected test kernel does not implement `openHandle`.
 */
export function ensureChatAgentHandle(params: EnsureChatAgentHandleParams): AgentHandle | null {
  const sessionId = params.sessionIdOverride ?? params.session?.id;
  if (!sessionId) return null;
  const runtime = safeGetKernelService<IAgentRuntimeService>(
    params.kernel,
    KernelServices.AgentRuntime,
  );
  if (typeof runtime?.openHandle !== "function") return null;

  const providerId = resolveBuiltinProviderId(params.settings.api.type);
  const enabledToolNames = resolveSessionEnabledToolNames({
    kernel: params.kernel,
    character: params.activeCharacter,
    sessionComposition: params.session?.compositionSnapshot,
  });
  const enabledToolNameSet = new Set(enabledToolNames);
  const registeredTools = typeof runtime.listTools === "function" ? runtime.listTools() : [];
  const enabledTools = registeredTools.filter(
    (tool) => enabledToolNameSet.has(tool.name) && tool.autoInvoke !== false,
  );
  const handleKey = `${sessionId}:${MOBILE_TAVERN_CHAT_DRIVER_ID}:${providerId}:${enabledToolNames.join(",")}`;
  if (params.handleRef.current && params.handleKeyRef.current === handleKey) {
    return params.handleRef.current;
  }
  if (params.handleRef.current) {
    void params.handleRef.current.dispose();
  }
  const handle = runtime.openHandle({
    sessionId,
    driverId: MOBILE_TAVERN_CHAT_DRIVER_ID,
    providerId,
    executeLegacy: params.executeLegacy,
    grantedPermissions: [...new Set(enabledTools.flatMap((tool) => tool.permissions))],
    enabledToolNames,
  });
  params.handleRef.current = handle;
  params.handleKeyRef.current = handleKey;
  return handle;
}

export interface ChatTurnModelPhaseParams {
  readonly kernel: IKernel;
  readonly agentTurn?: AgentTurnExecutionContext;
  readonly session: ChatSession;
  readonly character: CharacterCard;
  readonly effectiveSettings: UserSettings;
  readonly rawApiSettings: UserSettings["api"];
  readonly characters: readonly CharacterCard[];
  readonly globalLorebook: readonly LorebookEntry[];
  readonly customWorldbooks: Readonly<Record<string, CustomWorldbook>>;
  readonly queryText: string;
  readonly generationType: "normal" | "regenerate";
  readonly beforeMessageId?: string;
  readonly turnIndex: number;
  readonly credentials: {
    readonly apiKey: string;
    readonly baseUrl: string;
    readonly model: string;
    readonly chatPath?: string;
  };
  readonly isBisonConsecutive?: boolean;
  readonly signal: AbortSignal;
  readonly traceId: string;
  readonly responseChunks: string[];
  readonly reasoningChunks: string[];
  readonly databaseService: IDatabaseService<
    ChatSession,
    CharacterCard,
    SummaryCard,
    Message,
    ChatSessionMetadataPatch
  >;
  readonly promptService: IPromptService;
  readonly chatStreamService: IChatStreamService;
  readonly recallMemories: () => Promise<RecalledMessage[]>;
  readonly processMediaBeforePrompt?: (session: ChatSession) => Promise<ChatSession>;
  readonly onPromptAudit?: (snapshot: PromptAuditSnapshot) => void;
  readonly onMemoryAudit?: (snapshot: MemoryAuditSnapshot) => void;
  readonly onRecalledMemories?: (
    sessionId: string,
    items: MemoryAuditSnapshot["recalled"],
  ) => void;
  readonly onPlacePlaceholder: () => void;
  readonly onStreamDelta: (responseText: string, reasoningText: string) => void;
  readonly onStartStreamingLog?: () => void;
}

export interface ChatTurnModelPhaseResult {
  readonly workingSession: ChatSession;
  readonly promptSession: ChatSession;
  readonly tokenUsage: { prompt: number; completion: number };
  readonly ttftMs: number;
  readonly startTime: number;
}

/**
 * Shared Application-layer model turn pipeline for both initial send and reroll:
 * lorebook merge -> memory recall & context contributions (`turnIndex`) ->
 * optional media degradation -> authoritative prompt assembly -> reasoning replay ->
 * multimodal provider projection (`media.projection`) -> memory audit ->
 * OpenAI tool loop / streaming request (`provider.request`).
 */
export async function executeChatTurnModelPhase(
  params: ChatTurnModelPhaseParams,
): Promise<ChatTurnModelPhaseResult> {
  const startTime = performance.now();
  let tokenUsage = { prompt: 0, completion: 0 };
  let isFirstTokenForSpeed = true;
  let ttftMs = 0;

  const combinedGlobals = combineTurnLorebooks(
    params.globalLorebook,
    params.characters,
    params.customWorldbooks,
    params.character.id,
  );

  const recalledMemories = await params.recallMemories();
  const contextContributions = await resolveTurnContextContributions(
    params.kernel,
    recalledMemories,
    {
      sessionId: params.session.id,
      userInput: params.queryText,
      turnIndex: params.turnIndex,
      signal: params.signal,
    },
  );

  const workingSession = params.processMediaBeforePrompt
    ? await params.processMediaBeforePrompt(params.session)
    : params.session;

  const { promptSession, promptEnvelope: promptPayload } = await assembleAuthoritativePromptEnvelope({
    databaseService: params.databaseService,
    promptService: params.promptService,
    character: params.character,
    session: workingSession,
    userInput: params.queryText,
    settings: params.effectiveSettings,
    globalLorebook: combinedGlobals,
    contextContributions,
    ...(params.beforeMessageId ? { beforeMessageId: params.beforeMessageId } : {}),
    signal: params.signal,
    traceId: params.traceId,
    generationType: params.generationType,
  });
  if (promptPayload.audit) {
    params.onPromptAudit?.(promptPayload.audit);
  }

  const assembledProviderMessages: OpenAiProviderMessage[] = promptPayload.messages;
  const baseProviderMessages = preserveAssistantReasoning(
    assembledProviderMessages,
    promptSession.messages,
    params.credentials.baseUrl,
    params.credentials.model,
  );
  const latestMultimodalUserMessage = [...promptSession.messages]
    .reverse()
    .find((message) => message.sender === "user" && message.parts?.some((part) => part.type !== "text"));
  const provider = resolveTurnProvider(params.kernel, params.effectiveSettings, params.agentTurn);
  const attachments = latestMultimodalUserMessage
    ? safeGetKernelService<IAttachmentService>(params.kernel, KernelServices.Attachments)
    : undefined;
  const projection = latestMultimodalUserMessage && attachments
    ? await projectMessagePartsForProvider(
        baseProviderMessages,
        latestMultimodalUserMessage,
        attachments,
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
  await params.agentTurn?.recordDecision("media.projection", projection.decision);

  publishTurnMemoryAuditSnapshot(
    {
      publishMemoryAudit: params.onMemoryAudit,
      publishRecalledMemories: params.onRecalledMemories,
      estimateTokens: (content) => params.promptService.estimateTokens(content),
    },
    {
      session: promptSession,
      query: params.queryText,
      recalled: recalledMemories,
      settings: params.effectiveSettings,
      contextContributions,
    },
  );

  params.onStartStreamingLog?.();
  params.onPlacePlaceholder();

  const { effectiveSettings, rawApiSettings, credentials } = params;
  const executeProviderStep = async (step: OpenAiToolLoopModelStep) => {
    params.responseChunks.splice(0, params.responseChunks.length);
    params.reasoningChunks.splice(0, params.reasoningChunks.length);
    const toolCallAccumulator = new OpenAiToolCallAccumulator();
    const commonRequestBody: Record<string, unknown> = {
      model: credentials.model,
      stream: true,
      ...(rawApiSettings.type !== "anthropic" && !rawApiSettings.forceBasicParams && {
        stream_options: { include_usage: true },
      }),
      messages: [...providerMessages, ...step.continuationMessages],
      ...(step.tools.length > 0 ? { tools: step.tools, tool_choice: "auto" } : {}),
      ...(promptPayload.stopSequences?.length ? { stop: promptPayload.stopSequences } : {}),
      temperature: effectiveSettings.preset.temperature,
      top_p: effectiveSettings.preset.topP,
      top_k: effectiveSettings.preset.topK,
      top_a: effectiveSettings.preset.topA,
      min_p: effectiveSettings.preset.minP,
      max_tokens: params.isBisonConsecutive ? 300 : effectiveSettings.preset.maxTokens,
      presence_penalty: effectiveSettings.preset.presencePenalty ?? 0.0,
      frequency_penalty: effectiveSettings.preset.frequencyPenalty ?? 0.0,
      repetition_penalty: effectiveSettings.preset.repetitionPenalty ?? 1.0,
      // ST 约定 seed < 0 为随机；不发送才能让服务端每次重新采样。
      ...(typeof effectiveSettings.preset.seed === "number" && effectiveSettings.preset.seed >= 0
        ? { seed: effectiveSettings.preset.seed }
        : {}),
    };
    const providerRequestBody = provider.buildRequestBody(commonRequestBody);
    await params.agentTurn?.recordDecision("provider.request", {
      step: step.step,
      providerId: provider.id,
      providerVersion: provider.version,
      model: credentials.model,
      apiType: rawApiSettings.type,
      streaming: provider.capabilities.supportsStreaming,
      tools: step.tools.map((tool) => tool.function.name),
    });

    const stream = params.chatStreamService.streamLlmResponse({
      baseUrl: credentials.baseUrl,
      apiKey: credentials.apiKey,
      chatPath: credentials.chatPath,
      bypassProxy: rawApiSettings.bypassProxy,
      disableReasoning: rawApiSettings.disableReasoning,
      reasoningStrength: rawApiSettings.reasoningStrength,
      forceBasicParams: rawApiSettings.forceBasicParams,
      reqBody: providerRequestBody,
      signal: params.signal,
      traceId: params.traceId,
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
        params.responseChunks.push(chunk.__rescuedContent);
      } else {
        const choice = chunk.choices?.[0];
        const reasoning = choice?.delta?.reasoning_content;
        const delta = choice?.delta?.content || choice?.message?.content || choice?.text;
        const finishReason = choice?.finish_reason;
        toolCallAccumulator.append(choice?.delta?.tool_calls ?? choice?.message?.tool_calls);

        if (finishReason === "content_filter") {
          throw new Error("内容被服务商的安全过滤（Content Filter）拦截，生成终止。");
        }
        if (reasoning) params.reasoningChunks.push(reasoning);
        if (delta) {
          params.responseChunks.push(delta);
          if (isFirstTokenForSpeed) {
            isFirstTokenForSpeed = false;
            ttftMs = performance.now() - startTime;
          }
        }
        if (chunk.usage) {
          tokenUsage = {
            prompt: tokenUsage.prompt + (chunk.usage.prompt_tokens || 0),
            completion: tokenUsage.completion + (chunk.usage.completion_tokens || 0),
          };
        }
      }
      params.onStreamDelta(params.responseChunks.join(""), params.reasoningChunks.join(""));
    }

    return {
      content: params.responseChunks.join(""),
      toolCalls: toolCallAccumulator.finalize(),
      reasoningContent: params.reasoningChunks.join(""),
    };
  };

  if (params.agentTurn) {
    const runtime = safeGetKernelService<IAgentRuntimeService>(
      params.kernel,
      KernelServices.AgentRuntime,
    );
    const enabledToolNames = new Set(resolveSessionEnabledToolNames({
      kernel: params.kernel,
      character: params.character,
      sessionComposition: workingSession.compositionSnapshot,
    }));
    await executeOpenAiToolLoop({
      context: params.agentTurn,
      tools: provider.capabilities.supportsTools && typeof runtime?.listTools === "function"
        ? runtime.listTools().filter((tool) => enabledToolNames.has(tool.name) && tool.autoInvoke !== false)
        : [],
      executeModelStep: executeProviderStep,
    });
  } else {
    await executeProviderStep({ step: 0, continuationMessages: [], tools: [] });
  }

  return {
    workingSession,
    promptSession,
    tokenUsage,
    ttftMs,
    startTime,
  };
}

export function safeGetKernelService<T extends IKernelService>(
  kernel: IKernel,
  name: string,
): T | undefined {
  if (typeof kernel.hasService === "function" && !kernel.hasService(name)) {
    return undefined;
  }
  try {
    return kernel.getService<T>(name);
  } catch {
    return undefined;
  }
}

