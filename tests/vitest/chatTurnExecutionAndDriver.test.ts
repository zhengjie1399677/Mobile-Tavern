import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { BUILTIN_TAVERN_PROFILE_ID } from "../../src/application/runtimeProfiles/contracts";
import { MOBILE_TAVERN_CHAT_DRIVER_ID } from "../../src/application/runtimePlugins";
import {
  KernelServices,
  type IAgentRuntimeService,
  type IChatStreamService,
  type IContextSourceService,
  type IDatabaseService,
  type IKernel,
  type IMultiMessageService,
  type IPromptService,
  type ITelemetryService,
  type StreamChunk,
} from "../../src/application/serviceContracts";
import type { MemoryAuditSnapshot } from "../../src/application/services/memory/types";
import {
  MOBILE_TAVERN_CHAT_DRIVER_VERSION,
  runMobileTavernChatDriver,
} from "../../src/application/useCases/chatTurnDriver";
import { resolveTurnIndexForContext } from "../../src/application/useCases/chatTurnExecution";
import type {
  AgentCompositionSnapshot,
  AgentHandle,
  AgentProviderDefinition,
  AgentToolCall,
  AgentToolDefinition,
  AgentTurnExecutionContext,
  AgentTurnInput,
} from "../../src/domain/agents/contracts";
import type { ContextContribution } from "../../src/domain/contextSources/contracts";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import { useRerollMessage } from "../../src/hooks/useChat/useRerollMessage";
import { useSendMessage } from "../../src/hooks/useChat/useSendMessage";
import type {
  CharacterCard,
  ChatSession,
  ChatSessionMetadataPatch,
  Message,
  SummaryCard,
  UserSettings,
} from "../../src/types";

function createTestSettings(apiType: UserSettings["api"]["type"] = "openai"): UserSettings {
  const base = structuredClone(DEFAULT_SETTINGS) as UserSettings;
  return {
    ...base,
    api: {
      ...base.api,
      type: apiType,
      apiKey: "sk-test",
      baseUrl: "https://api.example.com/v1",
      modelName: "gpt-test",
    },
    memory: {
      ...base.memory,
      enableRecall: true,
      recallTopK: 3,
      enableAutoSummary: false,
    },
    enableReplySuggestions: false,
  };
}

function createTestCharacter(): CharacterCard {
  return {
    id: "char-1",
    name: "测试角色",
    description: "desc",
    personality: "calm",
    scenario: "lab",
    first_mes: "欢迎来到实验室。",
    mes_example: "",
    lorebookEntries: [],
  };
}

function createHarness(options: {
  readonly session: ChatSession;
  readonly apiType?: UserSettings["api"]["type"];
  readonly tools?: readonly AgentToolDefinition[];
  readonly streamFactory?: (params: {
    reqBody: Record<string, unknown>;
    callIndex: number;
  }) => AsyncGenerator<StreamChunk, void, unknown>;
  readonly contextContribution?: ContextContribution;
}) {
  const settings = createTestSettings(options.apiType);
  const character = createTestCharacter();
  const sessionsState: ChatSession[] = [structuredClone(options.session)];
  const sessionsRef = { current: sessionsState };
  const activeSessionIdRef = { current: options.session.id as string | null };
  const isSendingRef = { current: false };
  const activeRequestIdRef = { current: 0 };
  const abortControllerRef = { current: null as AbortController | null };
  const pendingUpdateTimeoutRef = { current: null as ReturnType<typeof setTimeout> | null };
  const bisonChainTimerRef = { current: null as ReturnType<typeof setTimeout> | null };

  const decisions: Array<{ kind: string; payload: unknown }> = [];
  const openHandleCalls: Array<{
    sessionId: string;
    driverId: string;
    providerId: string;
    enabledToolNames?: readonly string[];
  }> = [];
  const disposedHandleCount = { value: 0 };
  const executedTools: Array<{ name: string; input: unknown }> = [];
  const contextReadRequests: Array<{ sessionId: string; userInput: string; turnIndex: number }> = [];
  const memoryAudits: MemoryAuditSnapshot[] = [];
  const capturedStreamRequests: Array<Record<string, unknown>> = [];
  const savedBranches: Array<{
    session: ChatSession;
    removedMessageIds: readonly string[];
    newMessages: readonly Message[];
  }> = [];
  const savedSessions: ChatSession[] = [];

  const tools = [...(options.tools ?? [])];
  const composition: AgentCompositionSnapshot = {
    profileId: BUILTIN_TAVERN_PROFILE_ID,
    profileVersion: 1,
    pluginVersions: {},
    providerBindings: {},
    contributionOrder: {
      tool: tools.map((tool) => tool.name),
    },
    capabilityDecisions: {},
  };

  const provider: AgentProviderDefinition = {
    id: `provider.${settings.api.type}`,
    version: "1.0.0",
    capabilities: {
      inputModalities: ["text", "image"],
      supportedMimeTypes: ["image/png"],
      supportsStreaming: true,
      supportsTools: tools.length > 0,
    },
    buildRequestBody: (request) => ({ ...request }),
  };

  const agentRuntime: IAgentRuntimeService = {
    name: KernelServices.AgentRuntime,
    init: async () => undefined,
    registerDriver: () => () => undefined,
    registerProvider: () => () => undefined,
    registerTool: () => () => undefined,
    registerMediaProcessor: () => () => undefined,
    listDrivers: () => [],
    listProviders: () => [provider],
    listTools: () => tools,
    listMediaProcessors: () => [],
    getProvider: (providerId) => ({ ...provider, id: providerId }),
    openHandle(handleOpts) {
      openHandleCalls.push({
        sessionId: handleOpts.sessionId,
        driverId: handleOpts.driverId,
        providerId: handleOpts.providerId,
        enabledToolNames: handleOpts.enabledToolNames,
      });
      const turnId = `turn-${openHandleCalls.length}`;
      const handle: AgentHandle = {
        async send(input: AgentTurnInput) {
          const controller = new AbortController();
          const turnContext: AgentTurnExecutionContext = {
            turnId,
            sessionId: handleOpts.sessionId,
            driverId: handleOpts.driverId,
            providerId: handleOpts.providerId,
            provider,
            input,
            signal: controller.signal,
            async recordDecision(kind, payload) {
              decisions.push({ kind, payload });
            },
            async executeTool(call: AgentToolCall) {
              executedTools.push({ name: call.name, input: call.arguments });
              const found = tools.find((tool) => tool.name === call.name);
              if (!found) {
                throw new Error(`Tool not found: ${call.name}`);
              }
              return await found.execute(call.arguments, {
                sessionId: handleOpts.sessionId,
                turnId,
                callId: call.callId,
                signal: controller.signal,
              });
            },
            async processMedia() {
              throw new Error("processMedia not expected");
            },
            async executeLegacy() {
              await handleOpts.executeLegacy(turnContext);
            },
          };
          await runMobileTavernChatDriver(kernel, turnContext);
          return { turnId, status: "completed" };
        },
        async stop() {
          return undefined;
        },
        async dispose() {
          disposedHandleCount.value += 1;
        },
        getSnapshot() {
          return {
            sessionId: handleOpts.sessionId,
            driverId: handleOpts.driverId,
            providerId: handleOpts.providerId,
            status: "idle",
            activeTurnId: null,
          };
        },
        subscribe() {
          return () => undefined;
        },
      };
      return handle;
    },
    getDiagnostics: () => ({
      drivers: [],
      providers: [],
      tools: [],
      mediaProcessors: [],
      activeHandles: openHandleCalls.length,
    }),
    listJournalBySession: async () => [],
    appendJournal: async () => undefined,
    replaceJournal: async () => undefined,
    deleteJournalBySession: async () => undefined,
    bindComposition: () => () => undefined,
    getCompositionSnapshot: () => composition,
    listPendingToolApprovals: () => [],
    subscribeToolApprovals: () => () => undefined,
    resolveToolApproval: () => false,
    subscribeJournal: () => () => undefined,
  };

  const defaultContributionContent = "场景补充：实验室当前处于夜间值守状态。";
  const contextSource: ContextContribution = options.contextContribution ?? {
    sourceId: "source.scene",
    macroName: "context.scene",
    content: defaultContributionContent,
    status: "ok",
    characters: defaultContributionContent.length,
  };

  const contextSourceService: IContextSourceService = {
    name: KernelServices.ContextSources,
    init: async () => undefined,
    register: () => () => undefined,
    list: () => [],
    readAll: vi.fn(async (request) => {
      contextReadRequests.push({
        sessionId: request.sessionId,
        userInput: request.userInput,
        turnIndex: request.turnIndex ?? -1,
      });
      return [contextSource];
    }),
  };

  const kernel: IKernel = {
    hasService(name: string) {
      return name === KernelServices.AgentRuntime || name === KernelServices.ContextSources;
    },
    getService(name: string) {
      if (name === KernelServices.AgentRuntime) return agentRuntime as never;
      if (name === KernelServices.ContextSources) return contextSourceService as never;
      throw new Error(`Unexpected service: ${name}`);
    },
    getPipeline() {
      return {
        use: () => () => undefined,
        unuse: () => undefined,
        execute: async () => undefined,
        matches: () => true,
        list: () => [],
      };
    },
  } as unknown as IKernel;

  const databaseService = {
    getSessionById: vi.fn(async (id: string) => sessionsRef.current.find((s) => s.id === id) ?? null),
    getSessionPromptMessages: vi.fn(async (_sessionId: string, opts: { beforeMessageId?: string }) => {
      const current = sessionsRef.current[0]?.messages ?? [];
      if (!opts.beforeMessageId) return structuredClone(current);
      const boundaryIdx = current.findIndex((msg) => msg.id === opts.beforeMessageId);
      return boundaryIdx >= 0 ? structuredClone(current.slice(0, boundaryIdx)) : structuredClone(current);
    }),
    getSessionStateBeforeMessage: vi.fn(async () => ({}) as ChatSessionMetadataPatch),
    replaceSessionBranch: vi.fn(async (session, removedMessageIds, newMessages) => {
      savedBranches.push({ session, removedMessageIds, newMessages });
      sessionsRef.current = [session];
    }),
    saveSession: vi.fn(async (session) => {
      savedSessions.push(session);
      sessionsRef.current = [session];
    }),
    appendSessionMessage: vi.fn(async () => undefined),
    commitSessionTurn: vi.fn(async () => undefined),
    appendMessage: vi.fn(async (_sessionId, msg) => {
      const cur = sessionsRef.current[0];
      if (cur) {
        sessionsRef.current = [{ ...cur, messages: [...cur.messages, msg] }];
      }
    }),
    updateSessionMetadata: vi.fn(async () => undefined),
  } as unknown as IDatabaseService<ChatSession, CharacterCard, SummaryCard, Message, ChatSessionMetadataPatch>;

  const promptService = {
    assemblePrompt: vi.fn((params) => ({
      version: 1 as const,
      systemInstruction: "SYSTEM",
      history: [],
      dynamicInstruction: "",
      userInput: params.userInput,
      messages: [
        { role: "system" as const, content: "SYSTEM" },
        { role: "user" as const, content: params.userInput },
      ],
      diagnostics: [],
      traces: [],
      requestShaping: {
        enabled: false,
        originalMessageCount: 2,
        finalMessageCount: 2,
        mergedMessageCount: 0,
        squashedSystemMessageCount: 0,
        assistantPrefillAdded: false,
        stopSequences: [],
      },
    })),
    cleanNameForApi: vi.fn((name: string | undefined, fallback: string) => name || fallback),
    estimateTokens: vi.fn((text: string) => Math.max(1, Math.ceil(text.length / 4))),
    sanitizeName: vi.fn((name: string) => name),
    getTriggeredLorebookEntries: vi.fn(() => []),
  } as unknown as IPromptService<CharacterCard, ChatSession, UserSettings, never>;

  let streamCallIndex = 0;
  const chatStreamService: IChatStreamService = {
    name: KernelServices.ChatStream,
    init: async () => undefined,
    streamLlmResponse: vi.fn((params) => {
      const idx = streamCallIndex++;
      capturedStreamRequests.push(params.reqBody);
      if (options.streamFactory) {
        return options.streamFactory({ reqBody: params.reqBody, callIndex: idx });
      }
      return (async function* () {
        yield { choices: [{ delta: { content: `第 ${idx + 1} 次回复` }, finish_reason: "stop" }] };
      })();
    }),
  };

  const telemetryService = {
    reportUsage: vi.fn(),
    incrementUsageCount: vi.fn(),
  } as unknown as ITelemetryService;

  const draftsRef = { current: {} as Record<string, string> };

  const multiMessageService: IMultiMessageService<ChatSession> = {
    queueUserMessage: vi.fn(async (session, text, additionalParts) => {
      const userMessage: Message = {
        id: `u_${session.messages.length + 1}`,
        sender: "user",
        content: text,
        timestamp: Date.now(),
        ...(additionalParts?.length ? { parts: [...additionalParts] } : {}),
      };
      const updated: ChatSession = {
        ...session,
        messages: [...session.messages, userMessage],
      };
      sessionsRef.current = [updated];
      return updated;
    }),
  } as unknown as IMultiMessageService<ChatSession>;

  const setSessionViews = vi.fn((updater: React.SetStateAction<ChatSession[]>) => {
    sessionsRef.current =
      typeof updater === "function" ? updater(sessionsRef.current) : updater;
  });

  return {
    settings,
    character,
    kernel,
    databaseService,
    promptService,
    chatStreamService,
    multiMessageService,
    telemetryService,
    draftsRef,
    sessionsRef,
    activeSessionIdRef,
    isSendingRef,
    activeRequestIdRef,
    abortControllerRef,
    pendingUpdateTimeoutRef,
    bisonChainTimerRef,
    setSessionViews,
    decisions,
    openHandleCalls,
    disposedHandleCount,
    executedTools,
    contextReadRequests,
    memoryAudits,
    capturedStreamRequests,
    savedBranches,
    savedSessions,
    showCustomAlert: vi.fn(async () => undefined),
    showCustomConfirm: vi.fn(async () => true),
  };
}

describe("共享聊天编排、Driver 注入与重生成能力对齐", () => {
  it("runMobileTavernChatDriver 在执行编排前把 driver.orchestration 写入 Agent Journal", async () => {
    const decisions: Array<{ kind: string; payload: unknown }> = [];
    const callOrder: string[] = [];
    const composition: AgentCompositionSnapshot = {
      profileId: "profile-alpha",
      profileVersion: 2,
      pluginVersions: {},
      providerBindings: {},
      contributionOrder: {},
      capabilityDecisions: {},
    };
    const runtime = {
      listTools: () => [{ name: "tool.a" }, { name: "tool.b" }] as unknown as AgentToolDefinition[],
      getCompositionSnapshot: () => composition,
    } as unknown as IAgentRuntimeService;
    const kernel = {
      hasService: (name: string) => name === KernelServices.AgentRuntime,
      getService: () => runtime,
    } as unknown as IKernel;

    const context: AgentTurnExecutionContext = {
      turnId: "turn-driver",
      sessionId: "session-driver",
      driverId: MOBILE_TAVERN_CHAT_DRIVER_ID,
      providerId: "builtin.openai",
      provider: {
        id: "builtin.openai",
        version: "1.0.0",
        capabilities: {
          inputModalities: ["text"],
          supportsStreaming: true,
          supportsTools: true,
        },
        buildRequestBody: (req) => req,
      },
      input: {
        text: "你好",
        attachmentIds: [],
        skipModel: false,
        continuation: true,
      },
      signal: new AbortController().signal,
      async recordDecision(kind, payload) {
        callOrder.push(`decision:${kind}`);
        decisions.push({ kind, payload });
      },
      async executeTool() {
        return null;
      },
      async processMedia() {
        throw new Error("unused");
      },
      async executeLegacy() {
        callOrder.push("executeLegacy");
      },
    };

    await runMobileTavernChatDriver(kernel, context);

    expect(callOrder).toEqual(["decision:driver.orchestration", "executeLegacy"]);
    expect(decisions).toEqual([{
      kind: "driver.orchestration",
      payload: {
        driverId: MOBILE_TAVERN_CHAT_DRIVER_ID,
        driverVersion: MOBILE_TAVERN_CHAT_DRIVER_VERSION,
        providerId: "builtin.openai",
        profileId: "profile-alpha",
        profileVersion: 2,
        skipModel: false,
        continuation: true,
        supportsTools: true,
        supportsStreaming: true,
        registeredToolCount: 2,
      },
    }]);
  });

  it("resolveTurnIndexForContext 在发送、重生成用户消息与重生成助手消息时保持绝对轮次一致", () => {
    const msgs: Message[] = [
      { id: "m0", sender: "assistant", content: "开场白", timestamp: 1, turnIndex: 10 },
      { id: "m1", sender: "user", content: "提问", timestamp: 2, turnIndex: 11 },
      { id: "m2", sender: "assistant", content: "回答", timestamp: 3, turnIndex: 12 },
    ];

    expect(resolveTurnIndexForContext(msgs.slice(0, 2))).toBe(12);
    expect(resolveTurnIndexForContext(msgs.slice(0, 2), msgs[1])).toBe(12);
    expect(resolveTurnIndexForContext(msgs.slice(0, 2), msgs[2])).toBe(12);
  });

  it("重生成经 AgentHandle / Driver 记录决策、对齐 turnIndex 与记忆审计上下文，并消费 OpenAI tool_calls", async () => {
    const doubleTool: AgentToolDefinition = {
      name: "math.double",
      version: "1.0.0",
      description: "乘以二",
      inputSchema: z.object({ value: z.number() }),
      inputJsonSchema: {
        type: "object",
        properties: { value: { type: "number" } },
        required: ["value"],
        additionalProperties: false,
      },
      outputSchema: z.object({ value: z.number() }),
      permissions: ["compute.basic"],
      riskLevel: "low",
      sideEffect: "none",
      executionScope: "turn",
      policy: "allow",
      timeoutMs: 100,
      execute: async (input) => ({ value: Number((input as { value: number }).value) * 2 }),
    };

    const userMsg: Message = { id: "u1", sender: "user", content: "请把 4 乘以二", timestamp: 1, turnIndex: 4 };
    const aiMsg: Message = { id: "a1", sender: "assistant", content: "旧回复", timestamp: 2, turnIndex: 5 };
    const harness = createHarness({
      session: {
        id: "session-reroll-tools",
        characterId: "char-1",
        title: "Reroll Tools",
        messages: [userMsg, aiMsg],
        summaries: [],
        createdAt: 1,
      },
      tools: [doubleTool],
      streamFactory: async function* ({ reqBody, callIndex }) {
        if (callIndex === 0) {
          const advertisedTools = reqBody.tools as Array<{ function: { name: string } }>;
          expect(advertisedTools).toHaveLength(1);
          const providerToolName = advertisedTools[0].function.name;
          // 模拟服务端分两片下发 tool_calls
          yield {
            choices: [{
              delta: {
                content: "正在计算",
                tool_calls: [{ index: 0, id: "call-42", type: "function", function: { name: providerToolName.slice(0, 4), arguments: "{\"value\":" } }],
              },
            }],
          };
          yield {
            choices: [{
              delta: {
                tool_calls: [{ index: 0, function: { name: providerToolName.slice(4), arguments: "4}" } }],
              },
              finish_reason: "tool_calls",
            }],
          };
          return;
        }
        yield { choices: [{ delta: { content: "答案是 8" }, finish_reason: "stop" }] };
      },
    });

    const { result } = renderHook(() =>
      useRerollMessage({
        kernel: harness.kernel,
        settings: harness.settings,
        globalLorebook: [],
        customWorldbooks: {},
        characters: [harness.character],
        activeCharacter: harness.character,
        activeSession: harness.sessionsRef.current[0],
        isSendingRef: harness.isSendingRef,
        activeRequestIdRef: harness.activeRequestIdRef,
        activeSessionIdRef: harness.activeSessionIdRef,
        sessionsRef: harness.sessionsRef,
        abortControllerRef: harness.abortControllerRef,
        pendingUpdateTimeoutRef: harness.pendingUpdateTimeoutRef,
        setSessionViews: harness.setSessionViews,
        setIsSending: () => undefined,
        setReplySuggestions: () => undefined,
        publishMemoryAudit: (snapshot) => harness.memoryAudits.push(snapshot),
        triggerScroll: () => undefined,
        databaseService: harness.databaseService,
        promptService: harness.promptService,
        telemetryService: harness.telemetryService,
        chatStreamService: harness.chatStreamService,
        showCustomAlert: harness.showCustomAlert,
        showCustomConfirm: harness.showCustomConfirm,
      }),
    );

    await act(async () => {
      await result.current.handleRerollFromMessage(aiMsg);
    });

    expect(harness.showCustomAlert).not.toHaveBeenCalled();
    expect(harness.openHandleCalls).toHaveLength(1);
    expect(harness.openHandleCalls[0]).toMatchObject({
      sessionId: "session-reroll-tools",
      driverId: MOBILE_TAVERN_CHAT_DRIVER_ID,
      providerId: "provider.openai-compatible",
      enabledToolNames: ["math.double"],
    });
    expect(harness.decisions.map((item) => item.kind)).toEqual([
      "driver.orchestration",
      "media.projection",
      "provider.request",
      "tool.loop.step",
      "provider.request",
    ]);
    expect(harness.executedTools).toEqual([{ name: "math.double", input: { value: 4 } }]);
    expect(harness.contextReadRequests).toEqual([
      { sessionId: "session-reroll-tools", userInput: "请把 4 乘以二", turnIndex: 5 },
    ]);
    expect(harness.memoryAudits).toHaveLength(1);
    expect(harness.memoryAudits[0].sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "context.scene",
          included: true,
          characters: "场景补充：实验室当前处于夜间值守状态。".length,
        }),
      ]),
    );
    expect(harness.capturedStreamRequests).toHaveLength(2);
    const secondMessages = harness.capturedStreamRequests[1].messages as Array<{ role: string; content?: string }>;
    expect(secondMessages.some((msg) => msg.role === "tool" && String(msg.content).includes("8"))).toBe(true);
    expect(harness.savedBranches).toHaveLength(1);
    expect(harness.savedBranches[0].newMessages[0]?.content).toBe("答案是 8");
  });

  it("Send 与 Reroll 对同一个用户轮次向 ContextSource 传入完全一致的 turnIndex，且切库/切 API 时释放旧 Handle", async () => {
    const baseSession: ChatSession = {
      id: "session-turn-parity",
      characterId: "char-1",
      title: "Parity",
      messages: [
        { id: "m0", sender: "assistant", content: "欢迎", timestamp: 1, turnIndex: 7 },
      ],
      summaries: [],
      createdAt: 1,
    };
    const harness = createHarness({ session: baseSession });

    const sendHook = renderHook(
      ({ settings }: { settings: UserSettings }) =>
        useSendMessage({
          kernel: harness.kernel,
          settings,
          globalLorebook: [],
          customWorldbooks: {},
          characters: [harness.character],
          activeCharacter: harness.character,
          activeSession: harness.sessionsRef.current[0],
          isSending: false,
          isSendingRef: harness.isSendingRef,
          activeRequestIdRef: harness.activeRequestIdRef,
          activeSessionIdRef: harness.activeSessionIdRef,
          sessionsRef: harness.sessionsRef,
          abortControllerRef: harness.abortControllerRef,
          pendingUpdateTimeoutRef: harness.pendingUpdateTimeoutRef,
          bisonChainTimerRef: harness.bisonChainTimerRef,
          bisonRemainingCountRef: { current: 0 },
          setSessionViews: harness.setSessionViews,
          setIsSending: () => undefined,
          setIsBisonLocking: () => undefined,
          setReplySuggestions: () => undefined,
          triggerScroll: () => undefined,
          databaseService: harness.databaseService,
          promptService: harness.promptService,
          telemetryService: harness.telemetryService,
          chatStreamService: harness.chatStreamService,
          multiMessageService: harness.multiMessageService,
          draftsRef: harness.draftsRef,
          showCustomAlert: harness.showCustomAlert,
        }),
      { initialProps: { settings: harness.settings } },
    );

    await act(async () => {
      await sendHook.result.current.handleSendMessage("校验轮次");
    });

    expect(harness.showCustomAlert).not.toHaveBeenCalled();
    const persistedMessages = harness.sessionsRef.current[0].messages;
    const sentUserMsg = persistedMessages.find((msg) => msg.sender === "user")!;
    const sentAiMsg = persistedMessages[persistedMessages.length - 1]!;
    // 用户消息（turn 8）已进入 updatedSession，欢迎消息 turnIndex=7 推得 AI 响应轮次为 9
    expect(harness.contextReadRequests[0]).toEqual({
      sessionId: "session-turn-parity",
      userInput: "校验轮次",
      turnIndex: 9,
    });

    // 切到重生成：模拟落库后 user.turnIndex=8, ai.turnIndex=9 并切换 api.type 触发 Handle 刷新
    sentUserMsg.turnIndex = 8;
    sentAiMsg.turnIndex = 9;
    const rerollSettings = createTestSettings("anthropic");
    const rerollHook = renderHook(
      ({ settings }: { settings: UserSettings }) =>
        useRerollMessage({
          kernel: harness.kernel,
          settings,
          globalLorebook: [],
          customWorldbooks: {},
          characters: [harness.character],
          activeCharacter: harness.character,
          activeSession: harness.sessionsRef.current[0],
          isSendingRef: harness.isSendingRef,
          activeRequestIdRef: harness.activeRequestIdRef,
          activeSessionIdRef: harness.activeSessionIdRef,
          sessionsRef: harness.sessionsRef,
          abortControllerRef: harness.abortControllerRef,
          pendingUpdateTimeoutRef: harness.pendingUpdateTimeoutRef,
          setSessionViews: harness.setSessionViews,
          setIsSending: () => undefined,
          setReplySuggestions: () => undefined,
          triggerScroll: () => undefined,
          databaseService: harness.databaseService,
          promptService: harness.promptService,
          telemetryService: harness.telemetryService,
          chatStreamService: harness.chatStreamService,
          showCustomAlert: harness.showCustomAlert,
          showCustomConfirm: harness.showCustomConfirm,
        }),
      { initialProps: { settings: rerollSettings } },
    );

    await act(async () => {
      await rerollHook.result.current.handleRerollFromMessage(sentAiMsg);
    });
    await act(async () => {
      await rerollHook.result.current.handleRerollFromMessage(sentUserMsg);
    });

    expect(harness.contextReadRequests[1]).toEqual({
      sessionId: "session-turn-parity",
      userInput: "校验轮次",
      turnIndex: 9,
    });
    expect(harness.contextReadRequests[2]).toEqual({
      sessionId: "session-turn-parity",
      userInput: "校验轮次",
      turnIndex: 9,
    });
    expect(harness.disposedHandleCount.value).toBe(0);

    // 同一 Hook 实例上切换 api.type，应释放旧 Handle 并以新 providerId 重开 Handle
    rerollHook.rerender({ settings: createTestSettings("openai") });
    await act(async () => {
      await rerollHook.result.current.handleRerollFromMessage(sentUserMsg);
    });
    expect(harness.disposedHandleCount.value).toBe(1);
    expect(harness.openHandleCalls.map((call) => call.providerId)).toEqual([
      "provider.openai-compatible",
      "provider.anthropic-compatible",
      "provider.openai-compatible",
    ]);

    sendHook.unmount();
    rerollHook.unmount();
    expect(harness.disposedHandleCount.value).toBe(3);
  });

  it("分页窗口中 targetMsg 尚无 turnIndex 时仍依据前序持久化轮次计算一致 turnIndex", () => {
    const inMemoryAfterSend: Message[] = [
      { id: "m0", sender: "assistant", content: "欢迎", timestamp: 1, turnIndex: 7 },
      { id: "u1", sender: "user", content: "hi", timestamp: 2 },
      { id: "a1", sender: "assistant", content: "hello", timestamp: 3 },
    ];
    const partiallyPersisted: Message[] = [
      { id: "m0", sender: "assistant", content: "欢迎", timestamp: 1, turnIndex: 7 },
      { id: "u1", sender: "user", content: "hi", timestamp: 2, turnIndex: 8 },
      { id: "a1", sender: "assistant", content: "hello", timestamp: 3 },
    ];

    // useRerollMessage 截断后的 nextMsgs（[m0, u1]）与含 a1 的完整分页窗口结果应一致为 9
    expect(resolveTurnIndexForContext(inMemoryAfterSend.slice(0, 2), inMemoryAfterSend[2])).toBe(9);
    expect(resolveTurnIndexForContext(inMemoryAfterSend.slice(0, 2), inMemoryAfterSend[1])).toBe(9);
    expect(resolveTurnIndexForContext(inMemoryAfterSend, inMemoryAfterSend[2])).toBe(9);
    expect(resolveTurnIndexForContext(partiallyPersisted, partiallyPersisted[2])).toBe(9);
    expect(resolveTurnIndexForContext(partiallyPersisted.slice(0, 2), partiallyPersisted[1])).toBe(9);
  });

  it("AgentHandle 路径前置拒绝发送时 handleSendMessage 返回 false 并保留输入区草稿", async () => {
    const baseSession: ChatSession = {
      id: "session-reject-send",
      characterId: "char-1",
      title: "Reject",
      messages: [
        { id: "m0", sender: "assistant", content: "欢迎", timestamp: 1 },
      ],
      summaries: [],
      createdAt: 1,
    };
    const harness = createHarness({ session: baseSession });
    harness.draftsRef.current[baseSession.id] = "尚未发出的草稿";
    const missingModelSettings: UserSettings = {
      ...harness.settings,
      api: {
        ...harness.settings.api,
        modelName: "",
      },
    };

    const sendHook = renderHook(() =>
      useSendMessage({
        kernel: harness.kernel,
        settings: missingModelSettings,
        globalLorebook: [],
        customWorldbooks: {},
        characters: [harness.character],
        activeCharacter: harness.character,
        activeSession: harness.sessionsRef.current[0],
        isSending: false,
        isSendingRef: harness.isSendingRef,
        activeRequestIdRef: harness.activeRequestIdRef,
        activeSessionIdRef: harness.activeSessionIdRef,
        sessionsRef: harness.sessionsRef,
        abortControllerRef: harness.abortControllerRef,
        pendingUpdateTimeoutRef: harness.pendingUpdateTimeoutRef,
        bisonChainTimerRef: harness.bisonChainTimerRef,
        bisonRemainingCountRef: { current: 0 },
        setSessionViews: harness.setSessionViews,
        setIsSending: () => undefined,
        setIsBisonLocking: () => undefined,
        setReplySuggestions: () => undefined,
        triggerScroll: () => undefined,
        databaseService: harness.databaseService,
        promptService: harness.promptService,
        telemetryService: harness.telemetryService,
        chatStreamService: harness.chatStreamService,
        multiMessageService: harness.multiMessageService,
        draftsRef: harness.draftsRef,
        showCustomAlert: harness.showCustomAlert,
      }),
    );

    let sent: boolean | undefined;
    await act(async () => {
      sent = await sendHook.result.current.handleSendMessage("尚未发出的草稿");
    });

    expect(sent).toBe(false);
    expect(harness.draftsRef.current[baseSession.id]).toBe("尚未发出的草稿");
    expect(harness.sessionsRef.current[0].messages).toHaveLength(1);
    expect(harness.showCustomAlert).toHaveBeenCalledTimes(1);
    expect(harness.isSendingRef.current).toBe(false);
    sendHook.unmount();
  });

  it("openHandle 抛出异常时 useRerollMessage 仍能释放 isSendingRef 事务锁", async () => {
    const baseSession: ChatSession = {
      id: "session-reroll-unlock",
      characterId: "char-1",
      title: "Unlock",
      messages: [
        { id: "u1", sender: "user", content: "重发触发", timestamp: 1, turnIndex: 0 },
        { id: "a1", sender: "assistant", content: "旧回复", timestamp: 2, turnIndex: 1 },
      ],
      summaries: [],
      createdAt: 1,
    };
    const harness = createHarness({ session: baseSession });
    const setIsSending = vi.fn();
    const runtime = harness.kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime);
    vi.spyOn(runtime, "openHandle").mockImplementationOnce(() => {
      throw new Error("OPEN_HANDLE_FAILED");
    });

    const rerollHook = renderHook(() =>
      useRerollMessage({
        kernel: harness.kernel,
        settings: harness.settings,
        globalLorebook: [],
        customWorldbooks: {},
        characters: [harness.character],
        activeCharacter: harness.character,
        activeSession: harness.sessionsRef.current[0],
        isSendingRef: harness.isSendingRef,
        activeRequestIdRef: harness.activeRequestIdRef,
        activeSessionIdRef: harness.activeSessionIdRef,
        sessionsRef: harness.sessionsRef,
        abortControllerRef: harness.abortControllerRef,
        pendingUpdateTimeoutRef: harness.pendingUpdateTimeoutRef,
        setSessionViews: harness.setSessionViews,
        setIsSending,
        setReplySuggestions: () => undefined,
        triggerScroll: () => undefined,
        databaseService: harness.databaseService,
        promptService: harness.promptService,
        telemetryService: harness.telemetryService,
        chatStreamService: harness.chatStreamService,
        showCustomAlert: harness.showCustomAlert,
        showCustomConfirm: harness.showCustomConfirm,
      }),
    );

    await act(async () => {
      await expect(
        rerollHook.result.current.handleRerollFromMessage(baseSession.messages[1]),
      ).rejects.toThrow("OPEN_HANDLE_FAILED");
    });

    expect(harness.isSendingRef.current).toBe(false);
    expect(setIsSending).toHaveBeenLastCalledWith(false);
    rerollHook.unmount();
  });
});
