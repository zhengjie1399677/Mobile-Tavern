/**
 * 发送 → 停止 → 重发 的请求载荷一致性回归。
 *
 * 背景（用户报告）：发送后立即停止，再点"重发"时请求内容与首次发送不一致；部分中转站
 * 要求 messages 最后一条必须是 user，这种残留会让请求直接被拒。
 *
 * 本文件从"产物"验证三件事：
 *   ① 未产出任何内容的主动停止不会留下助手消息（内存视图与"数据库"都没有），
 *      随后重发的请求体与首次发送逐字段一致，且最后一条是 user；
 *   ② 部分产出后停止会保留该条助手回复（有意保留的语义），重发它时该条被排除，
 *      请求体同样以 user 结尾；
 *   ③ 历史末尾的"空产出"助手消息在权威历史读取阶段被剔除，不参与组装。
 *
 * 为了不让断言依赖被测代码自身的投影，这里使用真实的 `buildPromptRequestMessages` +
 * `shapePromptRequest`（与 PromptService 角色扮演路径同一套函数）从 `chat.messages`
 * 构建消息包，并固定 `userInput` 只用于世界书触发、不进入消息序列。
 */
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSendMessage } from "../../src/hooks/useChat/useSendMessage";
import { useRerollMessage } from "../../src/hooks/useChat/useRerollMessage";
import { buildAuthoritativePromptSession } from "../../src/application/useCases/promptHistoryUseCases";
import {
  buildPromptRequestMessages,
  shapePromptRequest,
} from "../../src/application/services/prompt/PromptRequestShaper";
import type { PromptAssemblyResult } from "../../src/application/services/prompt/PromptAssemblyResult";
import type {
  AgentHandle,
  AgentProviderDefinition,
  AgentTurnExecutionContext,
} from "../../src/domain/agents/contracts";
import type { ChatSession, CharacterCard, CustomWorldbook, LorebookEntry, Message, UserSettings } from "../../src/types";
import type { ResolvedApiCredentials } from "../../src/utils/resolveApiCredentials";

const { resolveApiCredentialsMock } = vi.hoisted(() => ({
  resolveApiCredentialsMock: vi.fn<() => ResolvedApiCredentials>(),
}));
vi.mock("../../src/utils/resolveApiCredentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/resolveApiCredentials")>();
  return {
    resolveApiCredentials: resolveApiCredentialsMock,
    TrialExhaustedError: actual.TrialExhaustedError,
    TrialKeyFetchError: actual.TrialKeyFetchError,
    ModelNotConfiguredError: actual.ModelNotConfiguredError,
  };
});

/** 与 useSendMessage / useRerollMessage 的读取边界一致的历史窗口条数。 */
const RECENT_TURNS = 4;
const NEW_USER_TEXT = "重发必须与首次发送一致";

function lorebookEntry(content: string): LorebookEntry {
  return { id: content, keys: ["触发词"], content, constant: true, enabled: true };
}

interface PromptQuery {
  sessionId: string;
  limit: number | undefined;
  preserveFirstAssistant: boolean;
  beforeMessageId: string | undefined;
}

interface StreamCall {
  messages: Array<{ role: string; content: string }>;
  body: Record<string, unknown>;
}

/**
 * 权威消息表的最小忠实实现。
 *
 * - `turnIndex` 由数据库分配（与 dbSchema/commitSessionTurn 一致：会话内单调递增）；
 * - `beforeMessageId` 语义为"排除该消息及其之后"（DatabaseService 用
 *   `maxTurnIndexExclusive = boundary.turnIndex`，比较为 `turnIndex < boundary`）；
 * - 边界消息不存在时抛错，与 DatabaseService.resolveMessageBoundary 一致。
 */
function createAuthoritativeStore(baseMessages: readonly Message[]) {
  const messages: Message[] = structuredClone([...baseMessages]);
  const promptQueries: PromptQuery[] = [];
  const assistantWrites: Message[] = [];
  let nextTurnIndex = messages.reduce(
    (max, message) => Math.max(max, (message.turnIndex ?? -1) + 1),
    0,
  );

  const assignTurnIndex = (message: Message): Message => {
    const stored = { ...message, turnIndex: nextTurnIndex };
    nextTurnIndex += 1;
    if (stored.sender === "assistant") assistantWrites.push(stored);
    return stored;
  };

  return {
    promptQueries,
    assistantWrites,
    getMessages: () => messages,
    append(message: Message): Message {
      const stored = assignTurnIndex(message);
      messages.push(stored);
      return stored;
    },
    upsert(appended: readonly Message[]) {
      for (const message of appended) {
        if (messages.some((item) => item.id === message.id)) continue;
        messages.push(assignTurnIndex(message));
      }
    },
    remove(ids: readonly string[]) {
      for (const id of ids) {
        const index = messages.findIndex((message) => message.id === id);
        if (index >= 0) messages.splice(index, 1);
      }
    },
    async getSessionPromptMessages(
      sessionId: string,
      options: { limit?: number; preserveFirstAssistant: boolean; beforeMessageId?: string },
    ): Promise<Message[]> {
      promptQueries.push({
        sessionId,
        limit: options.limit,
        preserveFirstAssistant: options.preserveFirstAssistant,
        beforeMessageId: options.beforeMessageId,
      });
      let eligible = messages;
      if (options.beforeMessageId !== undefined) {
        const boundary = messages.find((message) => message.id === options.beforeMessageId);
        if (!boundary) throw new Error(`[测试] 边界消息不存在: ${options.beforeMessageId}`);
        eligible = messages.filter((message) => (message.turnIndex ?? 0) < (boundary.turnIndex ?? 0));
      }
      if (options.limit === undefined) return structuredClone(eligible);
      const recent = eligible.slice(-options.limit);
      const firstAssistant = eligible.find((message) => message.sender === "assistant");
      return structuredClone(
        options.preserveFirstAssistant
          && firstAssistant
          && !recent.some((message) => message.id === firstAssistant.id)
          ? [firstAssistant, ...recent]
          : recent,
      );
    },
  };
}

/** 会话夹具：先有若干轮完整对话，接着是本次新发送的用户消息。 */
function createBaseMessages(): Message[] {
  return [
    { id: "welcome", sender: "assistant", content: "欢迎消息", timestamp: 0, turnIndex: 0 },
    { id: "u1", sender: "user", content: "用户消息 1", timestamp: 1, turnIndex: 1 },
    { id: "a1", sender: "assistant", content: "助手回复 1", timestamp: 2, turnIndex: 2 },
    { id: "u2", sender: "user", content: "用户消息 2", timestamp: 3, turnIndex: 3 },
    { id: "a2", sender: "assistant", content: "助手回复 2", timestamp: 4, turnIndex: 4 },
    { id: "u3", sender: "user", content: "用户消息 3", timestamp: 5, turnIndex: 5 },
    { id: "a3", sender: "assistant", content: "助手回复 3", timestamp: 6, turnIndex: 6 },
  ];
}

function createHarness(
  streamFactories: Array<(params: { signal?: AbortSignal }) => AsyncGenerator<unknown>>,
  worldbooks: {
    globalLorebook?: LorebookEntry[];
    characters?: CharacterCard[];
    customWorldbooks?: Record<string, CustomWorldbook>;
  } = {},
) {
  const store = createAuthoritativeStore(createBaseMessages());
  const baseSession: ChatSession = {
    id: "session-parity",
    characterId: "character-1",
    title: "载荷一致性回归",
    messages: store.getMessages(),
    summaries: [],
    createdAt: 1,
  };

  let sessions: ChatSession[] = [baseSession];
  const sessionsRef = { current: sessions };
  const setSessionViews = vi.fn((updater: React.SetStateAction<ChatSession[]>) => {
    sessions = typeof updater === "function" ? updater(sessions) : updater;
    sessionsRef.current = sessions;
  });
  const viewSession = () => sessions[0];
  const viewMessages = () => viewSession().messages;

  const streamCalls: StreamCall[] = [];
  let streamStarted = false;
  let callIndex = 0;
  const streamLlmResponse = vi.fn((params: { reqBody: Record<string, unknown>; signal?: AbortSignal }) => {
    const body = params.reqBody;
    streamCalls.push({
      messages: (body.messages ?? []) as StreamCall["messages"],
      body,
    });
    streamStarted = true;
    // 每轮消费一个工厂：第一次发送用中断流，重发用正常完成的流
    const factory = streamFactories[Math.min(callIndex, streamFactories.length - 1)];
    callIndex += 1;
    return factory(params);
  });

  const settings = {
    api: { apiKey: "test-key", modelName: "test-model", baseUrl: "https://example.com" },
    preset: {},
    promptConfig: {},
    memory: { recentTurns: RECENT_TURNS, enableAutoSummary: false },
    enableTableMemory: false,
    enableScriptExecution: false,
    enableBisonMode: false,
    enableReplySuggestions: false,
  } as UserSettings;

  const provider: AgentProviderDefinition = {
    id: "provider.openai-compatible",
    version: "1.0.0",
    capabilities: {
      inputModalities: ["text"],
      supportedMimeTypes: ["image/png"],
      supportsStreaming: true,
      supportsTools: false,
    },
    buildRequestBody: (request) => ({ ...request }),
  };

  const multiMessageService = {
    queueUserMessage: vi.fn(async (source: ChatSession, text: string) => {
      const userMessage: Message = {
        id: `user-${store.getMessages().length}`,
        sender: "user",
        content: text.trim(),
        timestamp: Date.now(),
      };
      const stored = store.append(userMessage);
      return { ...source, messages: [...store.getMessages().slice(0, -1), stored] };
    }),
  };

  const replaceSessionBranch = vi.fn(async (
    session: ChatSession,
    removedMessageIds: string[],
    newMessages: Message[],
  ) => {
    store.remove(removedMessageIds);
    store.upsert(newMessages);
    setSessionViews((previous) => previous.map((item) =>
      item.id === session.id ? { ...session, messages: [...newMessages] } : item,
    ));
  });

  const databaseService = {
    getSessionPromptMessages: store.getSessionPromptMessages,
    getSessionStateBeforeMessage: vi.fn(async () => ({})),
    commitSessionTurn: vi.fn(async (
      _sessionId: string,
      _metadata: unknown,
      commits: readonly Message[],
    ) => {
      store.upsert(commits.filter((message) => message.sender === "assistant"));
    }),
    appendSessionMessage: vi.fn(async (_sessionId: string, message: Message) => {
      if (message.sender === "assistant") store.upsert([message]);
    }),
    updateSessionMessage: vi.fn(async () => undefined),
    updateSessionMetadata: vi.fn(async () => undefined),
    replaceSessionBranch,
  };

  // 与 PromptService 角色扮演路径同一套构建函数：history ← chat.messages，userInput 不进入消息序列。
  const promptService = {
    assemblePrompt: vi.fn((params: {
      chat: ChatSession;
      userInput: string;
      settings: UserSettings;
      globalLorebook?: LorebookEntry[];
    }): PromptAssemblyResult => {
      const history = params.chat.messages.flatMap((message) =>
        message.sender === "user" || message.sender === "assistant"
          ? [{ role: message.sender, content: message.content }]
          : [],
      );
      // 系统提示词里带上本轮生效的世界书正文：世界书差异会直接反映到请求体上
      const lorebookText = (params.globalLorebook ?? []).map((entry) => entry.content).join("\n---\n");
      const systemInstruction = lorebookText ? `SYSTEM\n${lorebookText}` : "SYSTEM";
      const shaped = shapePromptRequest(
        buildPromptRequestMessages(systemInstruction, history, false),
        params.settings.promptConfig?.requestShaping,
      );
      return {
        version: 1,
        systemInstruction,
        dynamicInstruction: "",
        history,
        userInput: params.userInput,
        messages: shaped.messages,
        diagnostics: [],
        traces: [],
        stopSequences: shaped.stopSequences,
        requestShaping: shaped.report,
      };
    }),
    estimateTokens: vi.fn((content: string) => content.length),
  };

  const agentRuntime = {
    getProvider: () => provider,
    getCompositionSnapshot: () => null,
    openHandle: (options: {
      sessionId: string;
      driverId: string;
      providerId: string;
      executeLegacy: (context: AgentTurnExecutionContext) => Promise<void>;
    }): AgentHandle => {
      let controller: AbortController | null = null;
      return {
        async send(input) {
          controller = new AbortController();
          const context: AgentTurnExecutionContext = {
            sessionId: options.sessionId,
            turnId: "turn-parity",
            driverId: options.driverId,
            providerId: options.providerId,
            input,
            signal: controller.signal,
            provider,
            executeLegacy: async () => undefined,
            executeTool: async () => undefined,
            processMedia: async () => ({
              sourceAssetId: "att_test",
              projectionParts: [],
              derivedAssetIds: [],
              strategy: "test",
            }),
            recordDecision: async () => undefined,
          };
          try {
            await options.executeLegacy(context);
            return { turnId: "turn-parity", status: "completed" as const };
          } finally {
            controller = null;
          }
        },
        async stop() {
          controller?.abort(new DOMException("user", "AbortError"));
        },
        async dispose() {
          controller?.abort(new DOMException("disposed", "AbortError"));
        },
        getSnapshot: () => ({
          sessionId: options.sessionId,
          driverId: options.driverId,
          providerId: options.providerId,
          status: "idle" as const,
          activeTurnId: null,
        }),
        subscribe: () => () => undefined,
      };
    },
  };

  const kernel = {
    getService: vi.fn((name: string) => {
      if (name === "agentRuntime") return agentRuntime;
      if (name === "attachments") return { getBlob: vi.fn(async () => null) };
      return {
        getRecall: () => ({ recall: vi.fn(async () => []) }),
        getExtractor: () => ({ scheduleExtraction: vi.fn() }),
        getSummary: () => ({ checkAndSummarize: vi.fn(async (session: ChatSession) => session) }),
      };
    }),
    getPipeline: vi.fn(() => ({
      list: () => [{}],
      matches: () => true,
      execute: vi.fn(async () => undefined),
    })),
  };

  const isSendingRef = { current: false };
  const abortControllerRef = { current: null as AbortController | null };
  const activeRequestIdRef = { current: 0 };
  const activeSessionIdRef = { current: baseSession.id };
  const showCustomAlert = vi.fn(async () => undefined);

  const sharedParams = {
    kernel,
    settings,
    globalLorebook: worldbooks.globalLorebook ?? [],
    customWorldbooks: worldbooks.customWorldbooks ?? {},
    characters: worldbooks.characters ?? [],
    activeCharacter: { id: "character-1", name: "测试角色" } as CharacterCard,
    activeSession: baseSession,
    activeSessionIdRef,
    sessionsRef,
    abortControllerRef,
    setSessionViews,
    setIsSending: vi.fn(),
    setReplySuggestions: vi.fn(),
    publishMemoryAudit: vi.fn(),
    triggerScroll: vi.fn(),
    databaseService,
    promptService,
    telemetryService: {
      incrementUsageCount: vi.fn(),
      reportUsage: vi.fn(),
      reportLlmPerformance: vi.fn(),
    },
    chatStreamService: { streamLlmResponse },
    showCustomAlert,
  };

  const sendParams = {
    ...sharedParams,
    isSending: false,
    isSendingRef,
    activeRequestIdRef,
    pendingUpdateTimeoutRef: { current: null },
    bisonRemainingCountRef: { current: 0 },
    bisonChainTimerRef: { current: null },
    multiMessageService,
    memoryService: undefined,
    publishRecalledMemories: vi.fn(),
    setIsBisonLocking: vi.fn(),
    draftsRef: { current: {} },
  } as unknown as Parameters<typeof useSendMessage>[0];

  const rerollParams = {
    ...sharedParams,
    isSendingRef,
    activeRequestIdRef,
    pendingUpdateTimeoutRef: { current: null },
    publishRecalledMemories: vi.fn(),
    showCustomConfirm: vi.fn(async () => true),
  } as unknown as Parameters<typeof useRerollMessage>[0];

  return {
    sendParams,
    rerollParams,
    viewMessages,
    viewSession,
    store,
    streamCalls,
    replaceSessionBranch,
    isStreamingStarted: () => streamStarted,
  };
}

/** 中止后一直挂起的等待；被中止时按真实链路语义抛出 AbortError。 */
function waitUntilAborted(signal: AbortSignal | undefined) {
  return new Promise<void>((_resolve, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
}

/** 一个"永不产出内容，直到被中止"的流：模拟"还没出字就点停止"。 */
function createAbortWaitingStream(onStart: () => void) {
  return async function* (params: { signal?: AbortSignal }) {
    onStart();
    await waitUntilAborted(params.signal);
    // 只有被中止时上面的等待才会结算，这里不会真正产出数据包；
    // 保留 yield 只是为了满足"流式生成器"的形态约束。
    yield { choices: [] };
  };
}

/** 先产出一段文本，然后挂起直到被中止：模拟"出了几个字就点停止"。 */
function createPartialThenAbortStream(content: string) {
  return async function* (params: { signal?: AbortSignal }) {
    yield { choices: [{ delta: { content } }] };
    await waitUntilAborted(params.signal);
    yield { choices: [] };
  };
}

function createImmediateStream(chunks: readonly string[]) {
  return async function* () {
    for (const content of chunks) {
      yield { choices: [{ delta: { content } }] };
    }
  };
}

describe("发送→停止→重发 的请求载荷一致性", () => {
  const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

  beforeEach(() => {
    resolveApiCredentialsMock.mockImplementation(() => ({
      apiKey: "test-key",
      baseUrl: "https://example.com",
      model: "test-model",
      chatPath: "/v1/chat/completions",
      isTrial: false,
    }));
    consoleSpies.push(
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    consoleSpies.splice(0).forEach((spy) => spy.mockRestore());
    vi.restoreAllMocks();
  });

  it("未出字即停止：不留助手消息，重发载荷与首次发送完全一致且以 user 结尾", async () => {
    const harness = createHarness([
      createAbortWaitingStream(() => undefined),
      createImmediateStream(["重发生成的回复"]),
    ]);
    const send = renderHook(() => useSendMessage(harness.sendParams));

    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = send.result.current.handleSendMessage(NEW_USER_TEXT);
    });
    await waitFor(() => expect(harness.isStreamingStarted()).toBe(true));
    // 占位符已进入视图，但一个 token 都还没产出
    expect(harness.viewMessages().some((message) => message.content === "💭...")).toBe(true);
    expect(harness.streamCalls[0].messages.length).toBeGreaterThan(0);

    act(() => send.result.current.handleStopGeneration());
    await act(async () => {
      await sendPromise;
    });

    // ① 空产出不得留下助手消息：视图与权威存储都没有占位/空助手记录
    expect(harness.viewMessages().some((message) => message.content === "💭...")).toBe(false);
    expect(harness.viewMessages().some((message) => message.sender === "assistant" && !message.content.trim())).toBe(false);
    expect(harness.store.assistantWrites).toHaveLength(0);
    expect(harness.store.getMessages().some((message) => message.sender === "assistant" && !message.content.trim())).toBe(false);
    expect(harness.viewMessages().at(-1)?.sender).toBe("user");

    // ② 首次发送的载荷：最后一条必须是 user
    const sendMessages = harness.streamCalls[0].messages;
    expect(sendMessages.at(-1)).toEqual({ role: "user", content: NEW_USER_TEXT });

    // ③ 重发
    const reroll = renderHook(() => useRerollMessage(harness.rerollParams));
    await act(async () => {
      await reroll.result.current.handleRerollLast();
    });

    expect(harness.streamCalls).toHaveLength(2);
    const rerollCall = harness.streamCalls[1];
    expect(rerollCall.body).toEqual(harness.streamCalls[0].body);
    expect(rerollCall.messages.at(-1)).toEqual({ role: "user", content: NEW_USER_TEXT });

    // ④ 权威历史读取的边界与窗口也必须一致（首次发送不传边界，重发用户消息同样不传）
    const [sendQuery, rerollQuery] = harness.store.promptQueries;
    expect(rerollQuery).toEqual({
      sessionId: sendQuery.sessionId,
      limit: sendQuery.limit,
      preserveFirstAssistant: sendQuery.preserveFirstAssistant,
      beforeMessageId: undefined,
    });
    expect(sendQuery.beforeMessageId).toBeUndefined();
    // 历史窗口确实发生了截断（否则本用例没有区分力）
    expect(sendQuery.limit).toBe(RECENT_TURNS);
    expect(sendMessages.length).toBeLessThan(harness.store.getMessages().length + 1);

    // ⑤ 重发成功落库：用户消息仍在，且旧的"被移除分支"为空（未产出内容没有可移除的分支）
    expect(harness.store.getMessages().some((message) => message.content === NEW_USER_TEXT)).toBe(true);
    expect(harness.replaceSessionBranch).toHaveBeenCalledTimes(1);
    expect(harness.replaceSessionBranch.mock.calls[0][1]).toEqual([]);
  });

  it("部分产出后停止：保留该条回复，重发它时被排除且载荷以 user 结尾", async () => {
    const harness = createHarness([
      createPartialThenAbortStream("半段回复"),
      createImmediateStream(["重发生成的回复"]),
    ]);
    const send = renderHook(() => useSendMessage(harness.sendParams));

    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = send.result.current.handleSendMessage(NEW_USER_TEXT);
    });
    await waitFor(() =>
      expect(harness.viewMessages().some((message) => message.content.includes("半段回复"))).toBe(true),
    );
    act(() => send.result.current.handleStopGeneration());
    await act(async () => {
      await sendPromise;
    });

    // 部分产出被有意保留（不是残留）：视图与权威存储都留有这条助手回复
    const keptPartial = harness.viewMessages().at(-1);
    expect(keptPartial?.sender).toBe("assistant");
    expect(keptPartial?.content).toContain("半段回复");
    expect(harness.store.getMessages().at(-1)?.content).toContain("半段回复");

    const reroll = renderHook(() => useRerollMessage(harness.rerollParams));
    await act(async () => {
      await reroll.result.current.handleRerollLast();
    });

    const rerollCall = harness.streamCalls[1];
    // 重发目标是这条助手回复：它必须被排除，且消息包以 user 结尾
    expect(rerollCall.messages.some((message) => message.content.includes("半段回复"))).toBe(false);
    expect(rerollCall.messages.at(-1)).toEqual({ role: "user", content: NEW_USER_TEXT });
    expect(rerollCall.messages).toEqual(harness.streamCalls[0].messages);
    // 目标是助手消息 → 边界就是它本身（排除它及其之后），语义显式固定下来
    expect(harness.store.promptQueries[1].beforeMessageId).toBe(keptPartial?.id);

    // 旧的助手分支被替换（removedMessageIds 精确指向那条部分回复）
    const replaceCall = harness.replaceSessionBranch.mock.calls[0];
    expect(replaceCall[1]).toEqual([keptPartial?.id]);
  });

  it("完整产出后停止：重发载荷同样以 user 结尾且不复用旧回复", async () => {
    const harness = createHarness([
      createPartialThenAbortStream("完整回复"),
      createImmediateStream(["重发生成的回复"]),
    ]);
    const send = renderHook(() => useSendMessage(harness.sendParams));

    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = send.result.current.handleSendMessage(NEW_USER_TEXT);
    });
    await waitFor(() =>
      expect(harness.viewMessages().some((message) => message.content.includes("完整回复"))).toBe(true),
    );
    act(() => send.result.current.handleStopGeneration());
    await act(async () => {
      await sendPromise;
    });

    const partialId = harness.viewMessages().at(-1)?.id;
    const reroll = renderHook(() => useRerollMessage(harness.rerollParams));
    await act(async () => {
      await reroll.result.current.handleRerollLast();
    });

    const rerollCall = harness.streamCalls[1];
    expect(rerollCall.messages.some((message) => message.content === "完整回复")).toBe(false);
    expect(rerollCall.messages.at(-1)).toEqual({ role: "user", content: NEW_USER_TEXT });
    expect(harness.replaceSessionBranch.mock.calls[0][1]).toEqual([partialId]);
  });

  it("世界书组合逐字一致：重发不得再给条目加来源前缀", async () => {
    const harness = createHarness(
      [createAbortWaitingStream(() => undefined), createImmediateStream(["重发生成的回复"])],
      {
        globalLorebook: [lorebookEntry("全局世界书正文")],
        characters: [
          { id: "character-1", name: "测试角色" },
          {
            id: "character-2",
            name: "另一角色",
            isWorldbookGlobal: true,
            lorebookEntries: [lorebookEntry("角色世界书正文")],
          },
        ] as unknown as CharacterCard[],
        customWorldbooks: {
          wb1: {
            id: "wb1",
            name: "自定义世界书",
            enabled: true,
            entries: [lorebookEntry("自定义世界书正文")],
          } as CustomWorldbook,
        },
      },
    );
    const send = renderHook(() => useSendMessage(harness.sendParams));

    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = send.result.current.handleSendMessage(NEW_USER_TEXT);
    });
    await waitFor(() => expect(harness.isStreamingStarted()).toBe(true));
    act(() => send.result.current.handleStopGeneration());
    await act(async () => {
      await sendPromise;
    });

    const reroll = renderHook(() => useRerollMessage(harness.rerollParams));
    await act(async () => {
      await reroll.result.current.handleRerollLast();
    });

    const sendCall = harness.streamCalls[0];
    const rerollCall = harness.streamCalls[1];
    const sendSystem = sendCall.messages[0].content;
    // 三份世界书的正文都必须进入系统提示词，且不得被重发链路改写
    for (const content of ["全局世界书正文", "角色世界书正文", "自定义世界书正文"]) {
      expect(sendSystem).toContain(content);
      expect(rerollCall.messages[0].content).toContain(content);
    }
    expect(rerollCall.messages.some((message) => message.content.includes("来自世界书"))).toBe(false);
    expect(rerollCall.body).toEqual(sendCall.body);
  });
});

describe("权威历史读取：空产出助手消息不参与组装", () => {
  function createFakeDatabase(messages: readonly Message[]) {
    return {
      getSessionPromptMessages: vi.fn(async () => structuredClone([...messages])),
    } as unknown as Parameters<typeof buildAuthoritativePromptSession>[0];
  }

  const settings = {
    memory: { recentTurns: 10 },
  } as unknown as UserSettings;

  const session = {
    id: "session-blank-tail",
    characterId: "character-1",
    title: "空产出残留",
    messages: [],
    summaries: [],
    createdAt: 1,
  } as ChatSession;

  it("末尾的空助手消息被剔除，最后一条回到 user", async () => {
    const database = createFakeDatabase([
      { id: "welcome", sender: "assistant", content: "欢迎消息", timestamp: 0 },
      { id: "u1", sender: "user", content: "用户消息", timestamp: 1 },
      { id: "blank", sender: "assistant", content: "", timestamp: 2 },
    ]);

    const promptSession = await buildAuthoritativePromptSession(database, session, settings);

    expect(promptSession.messages.map((message) => message.id)).toEqual(["welcome", "u1"]);
    expect(promptSession.messages.at(-1)?.sender).toBe("user");
  });

  it("只裁剪末尾：历史中段的空助手消息与带思维链的空正文消息都保留", async () => {
    const database = createFakeDatabase([
      { id: "welcome", sender: "assistant", content: "欢迎消息", timestamp: 0 },
      { id: "blank-middle", sender: "assistant", content: "", timestamp: 1 },
      { id: "u1", sender: "user", content: "用户消息", timestamp: 2 },
      { id: "reasoning-only", sender: "assistant", content: "", reasoningContent: "全部产出在思维链", timestamp: 3 },
    ]);

    const promptSession = await buildAuthoritativePromptSession(database, session, settings);

    expect(promptSession.messages.map((message) => message.id)).toEqual([
      "welcome",
      "blank-middle",
      "u1",
      "reasoning-only",
    ]);
  });

  it("带附件的空正文助手消息不算空产出", async () => {
    const database = createFakeDatabase([
      { id: "u1", sender: "user", content: "用户消息", timestamp: 0 },
      {
        id: "attachment-only",
        sender: "assistant",
        content: "",
        timestamp: 1,
        contentVersion: 2,
        parts: [{ type: "image", assetId: "att_1" }],
      },
    ]);

    const promptSession = await buildAuthoritativePromptSession(database, session, settings);

    expect(promptSession.messages.map((message) => message.id)).toEqual(["u1", "attachment-only"]);
  });
});
