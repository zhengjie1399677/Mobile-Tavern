/**
 * useRerollMessage 重发事务并发回归测试。
 *
 * 覆盖场景：长会话重发进入旧分支持久化阶段时，流式占位消息尚未创建，
 * 用户再次触发重发。第二次调用必须被同步事务锁拒绝，不能生成第二轮回复。
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { useRerollMessage } from "../../src/hooks/useChat/useRerollMessage";
import { CONNECTION_INTERRUPTED_SUFFIX } from "../../src/hooks/useChat/pipelineHelpers";
import {
  TrialExhaustedError,
  TrialKeyFetchError,
  ModelNotConfiguredError,
  type ResolvedApiCredentials,
} from "../../src/utils/resolveApiCredentials";
import type { ChatSession, CharacterCard, Message, UserSettings } from "../../src/types";

// 模块级 mock 控制器：使用 vi.hoisted 确保在 vi.mock 工厂执行时已初始化
const { resolveApiCredentialsMock } = vi.hoisted(() => ({
  resolveApiCredentialsMock: vi.fn<(s: UserSettings, o?: { requireModel?: boolean }) => ResolvedApiCredentials>(),
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

// 文件级默认 mock：返回有效凭证。个别 describe/it 可覆盖此实现以触发错误路径。
beforeEach(() => {
  resolveApiCredentialsMock.mockImplementation(() => ({
    apiKey: "test-key",
    baseUrl: "https://example.com",
    model: "test-model",
    chatPath: "/v1/chat/completions",
    isTrial: false,
  }));
});

afterEach(() => {
  resolveApiCredentialsMock.mockReset();
});

function createLongSession(): ChatSession {
  const messages = [
    {
      id: "welcome",
      sender: "assistant" as const,
      content: "欢迎消息",
      timestamp: 0,
    },
    ...Array.from({ length: 10 }, (_, turn) => [
      {
        id: `user-${turn}`,
        sender: "user" as const,
        content: `用户消息 ${turn}`,
        timestamp: turn * 2 + 1,
      },
      {
        id: `assistant-${turn}`,
        sender: "assistant" as const,
        content: `助手回复 ${turn}`,
        timestamp: turn * 2 + 2,
      },
    ]).flat(),
  ];

  return {
    id: "session-long-reroll",
    characterId: "character-1",
    title: "长会话重发测试",
    messages,
    summaries: [],
    createdAt: 1,
  };
}

function createRerollDatabaseStub(
  getSession: () => ChatSession,
  replaceSessionBranch: (...args: [ChatSession, string[], Message[]]) => Promise<void>,
) {
  return {
    getSessionStateBeforeMessage: vi.fn(async () => ({})),
    getSessionPromptMessages: vi.fn(async (
      _sessionId: string,
      options: { limit?: number; preserveFirstAssistant: boolean; beforeMessageId?: string },
    ) => {
      const messages = getSession().messages;
      const boundaryIndex = options.beforeMessageId
        ? messages.findIndex((message) => message.id === options.beforeMessageId)
        : -1;
      const eligible = boundaryIndex >= 0 ? messages.slice(0, boundaryIndex) : messages;
      if (options.limit === undefined) return eligible;
      const recent = eligible.slice(-options.limit);
      const firstAssistant = eligible.find((message) => message.sender === "assistant");
      return options.preserveFirstAssistant
        && firstAssistant
        && !recent.some((message) => message.id === firstAssistant.id)
        ? [firstAssistant, ...recent]
        : recent;
    }),
    replaceSessionBranch,
  };
}

function createWeakNetworkHarness(
  session: ChatSession,
  streamLlmResponse: (...args: any[]) => AsyncGenerator<any>,
) {
  let sessions = [session];
  const sessionsRef = { current: sessions };
  const setSessionViews = vi.fn((updater: React.SetStateAction<ChatSession[]>) => {
    sessions = typeof updater === "function" ? updater(sessions) : updater;
    sessionsRef.current = sessions;
  });
  const replaceSessionBranch = vi.fn(async (
    _session: ChatSession,
    _removedMessageIds: string[],
    _newMessages: Message[],
  ) => undefined);
  const showCustomAlert = vi.fn(async () => undefined);
  const memoryService = {
    getRecall: () => ({ recall: vi.fn(async () => []) }),
    getExtractor: () => ({ scheduleExtraction: vi.fn() }),
  };
  const isSendingRef = { current: false };

  const params = {
    kernel: {
      getService: vi.fn(() => memoryService),
      getPipeline: vi.fn(() => ({
        list: () => [{}, {}, {}],
        matches: () => true,
        execute: vi.fn(async () => undefined),
      })),
    },
    settings: {
      api: { apiKey: "test-key", modelName: "test-model", baseUrl: "https://example.com" },
      preset: {},
      memory: { recentTurns: 100 },
      enableTableMemory: false,
      enableScriptExecution: false,
      enableBisonMode: false,
      enableReplySuggestions: false,
    } as UserSettings,
    globalLorebook: [],
    customWorldbooks: {},
    characters: [],
    activeCharacter: { id: "character-1", name: "测试角色" } as CharacterCard,
    activeSession: session,
    isSendingRef,
    activeRequestIdRef: { current: 0 },
    activeSessionIdRef: { current: session.id },
    sessionsRef,
    abortControllerRef: { current: null },
    pendingUpdateTimeoutRef: { current: null },
    setSessionViews,
    setIsSending: vi.fn(),
    setReplySuggestions: vi.fn(),
    publishRecalledMemories: vi.fn(),
    triggerScroll: vi.fn(),
    databaseService: createRerollDatabaseStub(
      () => sessionsRef.current.find((item) => item.id === session.id) ?? session,
      replaceSessionBranch,
    ),
    promptService: {
      assemblePrompt: vi.fn(() => ({ messages: [], traces: [] })),
      estimateTokens: vi.fn((content: string) => content.length),
    },
    telemetryService: { reportUsage: vi.fn(), reportLlmPerformance: vi.fn() },
    chatStreamService: { streamLlmResponse: vi.fn(streamLlmResponse) },
    showCustomAlert,
    showCustomConfirm: vi.fn(async () => true),
  } as unknown as Parameters<typeof useRerollMessage>[0];

  return {
    params,
    getSessions: () => sessions,
    replaceSessionBranch,
    showCustomAlert,
    isSendingRef,
  };
}

describe("useRerollMessage 重发事务锁", () => {
  it("流式占位消息创建前快速重复重发只允许一个事务进入提示词准备", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const session = createLongSession();
    let rejectRecall: ((reason?: unknown) => void) | null = null;
    const recallGate = new Promise<void>((_resolve, reject) => {
      rejectRecall = reject;
    });
    const recall = vi.fn(() => recallGate);
    const isSendingRef = { current: false };

    const params = {
      kernel: {
        getService: vi.fn(() => ({ getRecall: () => ({ recall }) })),
      },
      settings: {
        api: { apiKey: "test-key", modelName: "test-model", baseUrl: "https://example.com" },
        preset: {},
      } as UserSettings,
      globalLorebook: [],
      customWorldbooks: {},
      characters: [],
      activeCharacter: { id: "character-1", name: "测试角色" } as CharacterCard,
      activeSession: session,
      isSendingRef,
      activeRequestIdRef: { current: 0 },
      activeSessionIdRef: { current: session.id },
      sessionsRef: { current: [session] },
      abortControllerRef: { current: null },
      pendingUpdateTimeoutRef: { current: null },
      setSessionViews: vi.fn(),
      setIsSending: vi.fn(),
      setReplySuggestions: vi.fn(),
      publishRecalledMemories: vi.fn(),
      triggerScroll: vi.fn(),
      databaseService: createRerollDatabaseStub(() => session, vi.fn(async () => undefined)),
      promptService: {},
      telemetryService: { reportUsage: vi.fn() },
      chatStreamService: {},
      showCustomAlert: vi.fn(async () => undefined),
      showCustomConfirm: vi.fn(async () => true),
    } as unknown as Parameters<typeof useRerollMessage>[0];

    const { result } = renderHook(() => useRerollMessage(params));
    let firstReroll!: Promise<void>;
    let secondReroll!: Promise<void>;

    act(() => {
      firstReroll = result.current.handleRerollLast();
      secondReroll = result.current.handleRerollLast();
    });

    expect(isSendingRef.current).toBe(true);
    await waitFor(() => expect(recall).toHaveBeenCalledTimes(1));

    if (rejectRecall) (rejectRecall as (reason?: unknown) => void)(new Error("测试结束：中断提示词准备阶段"));
    await act(async () => {
      await Promise.all([firstReroll, secondReroll]);
    });

    expect(recall).toHaveBeenCalledTimes(1);
    expect(isSendingRef.current).toBe(false);
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });

  it("十轮对话进入折叠边界后，成功重发只保留一条新回复", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleClear = vi.spyOn(console, "clear").mockImplementation(() => undefined);
    const consoleDebug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const session = createLongSession();
    let sessions = [session];
    const sessionsRef = { current: sessions };
    const setSessionViews = vi.fn((updater: React.SetStateAction<ChatSession[]>) => {
      sessions = typeof updater === "function" ? updater(sessions) : updater;
      sessionsRef.current = sessions;
    });
    const replaceSessionBranch = vi.fn(async (
      _session: ChatSession,
      _removedMessageIds: string[],
      _newMessages: Message[]
    ) => undefined);
    const memoryService = {
      getRecall: () => ({ recall: vi.fn(async () => []) }),
      getExtractor: () => ({ scheduleExtraction: vi.fn() }),
    };

    const params = {
      kernel: {
        getService: vi.fn(() => memoryService),
        getPipeline: vi.fn(() => ({
          list: () => [{}, {}, {}],
          matches: () => true,
          execute: vi.fn(async () => undefined),
        })),
      },
      settings: {
        api: { apiKey: "test-key", modelName: "test-model", baseUrl: "https://example.com" },
        preset: {},
        memory: { recentTurns: 100 },
        enableTableMemory: false,
        enableScriptExecution: false,
        enableBisonMode: false,
      } as UserSettings,
      globalLorebook: [],
      customWorldbooks: {},
      characters: [],
      activeCharacter: { id: "character-1", name: "测试角色" } as CharacterCard,
      activeSession: session,
      isSendingRef: { current: false },
      activeRequestIdRef: { current: 0 },
      activeSessionIdRef: { current: session.id },
      sessionsRef,
      abortControllerRef: { current: null },
      pendingUpdateTimeoutRef: { current: null },
      setSessionViews,
      setIsSending: vi.fn(),
      setReplySuggestions: vi.fn(),
      publishRecalledMemories: vi.fn(),
      triggerScroll: vi.fn(),
      databaseService: createRerollDatabaseStub(
        () => sessionsRef.current.find((item) => item.id === session.id) ?? session,
        replaceSessionBranch,
      ),
      promptService: {
        assemblePrompt: vi.fn(() => ({ messages: [], traces: [] })),
        estimateTokens: vi.fn((content: string) => content.length),
      },
      telemetryService: { reportUsage: vi.fn(), reportLlmPerformance: vi.fn() },
      chatStreamService: {
        streamLlmResponse: vi.fn(async function* () {
          yield { choices: [{ delta: { content: "新的唯一回复" } }] };
        }),
      },
      showCustomAlert: vi.fn(async () => undefined),
      showCustomConfirm: vi.fn(async () => true),
    } as unknown as Parameters<typeof useRerollMessage>[0];

    const { result } = renderHook(() => useRerollMessage(params));
    await act(async () => {
      await result.current.handleRerollLast();
    });

    const finalMessages = sessions[0].messages;
    expect(finalMessages).toHaveLength(21);
    expect(finalMessages.some((message) => message.id === "assistant-9")).toBe(false);
    expect(finalMessages.filter((message) => message.content === "新的唯一回复")).toHaveLength(1);
    expect(finalMessages.at(-1)?.content).toBe("新的唯一回复");
    expect(replaceSessionBranch).toHaveBeenCalledTimes(1);
    expect(replaceSessionBranch.mock.calls[0][1]).toEqual(["assistant-9"]);
    expect(replaceSessionBranch.mock.calls[0][2]).toHaveLength(1);
    expect(replaceSessionBranch.mock.calls[0][2][0].extra?.mobileTavernSessionState)
      .toMatchObject({ version: 1 });

    consoleLog.mockRestore();
    consoleClear.mockRestore();
    consoleDebug.mockRestore();
  });

  it("首包失败后从最后一条用户消息显式重发，不重复追加用户消息", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleClear = vi.spyOn(console, "clear").mockImplementation(() => undefined);
    const consoleDebug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const session: ChatSession = {
      id: "session-resend-after-failure",
      characterId: "character-1",
      title: "弱网重发",
      messages: [
        { id: "welcome", sender: "assistant", content: "欢迎消息", timestamp: 0 },
        { id: "user-pending", sender: "user", content: "请继续", timestamp: 1 },
      ],
      summaries: [],
      createdAt: 1,
    };
    const harness = createWeakNetworkHarness(session, async function* () {
      yield { choices: [{ delta: { content: "恢复后的回复" } }] };
    });
    const { result } = renderHook(() => useRerollMessage(harness.params));

    await act(async () => {
      await result.current.handleRerollLast();
    });

    const messages = harness.getSessions()[0].messages;
    expect(messages.filter((message) => message.id === "user-pending")).toHaveLength(1);
    expect(messages.map((message) => message.content)).toEqual(["欢迎消息", "请继续", "恢复后的回复"]);
    expect(harness.replaceSessionBranch).toHaveBeenCalledTimes(1);
    expect(harness.replaceSessionBranch.mock.calls[0][1]).toEqual([]);
    expect(harness.replaceSessionBranch.mock.calls[0][2]).toHaveLength(1);
    expect(harness.isSendingRef.current).toBe(false);

    consoleLog.mockRestore();
    consoleClear.mockRestore();
    consoleDebug.mockRestore();
  });

  it("重发收到部分内容后断线，原子提交带弱网标记的新分支", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleClear = vi.spyOn(console, "clear").mockImplementation(() => undefined);
    const consoleDebug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const session: ChatSession = {
      id: "session-partial-reroll",
      characterId: "character-1",
      title: "重发断线",
      messages: [
        { id: "welcome", sender: "assistant", content: "欢迎消息", timestamp: 0 },
        { id: "user-1", sender: "user", content: "继续", timestamp: 1 },
        { id: "assistant-old", sender: "assistant", content: "旧回复", timestamp: 2 },
      ],
      summaries: [],
      createdAt: 1,
    };
    const harness = createWeakNetworkHarness(session, async function* () {
      yield { choices: [{ delta: { content: "新的半段" } }] };
      throw new Error("connection reset");
    });
    const { result } = renderHook(() => useRerollMessage(harness.params));

    await act(async () => {
      await result.current.handleRerollLast();
    });

    const messages = harness.getSessions()[0].messages;
    expect(messages.map((message) => message.content)).toEqual([
      "欢迎消息",
      "继续",
      `新的半段${CONNECTION_INTERRUPTED_SUFFIX}`,
    ]);
    expect(harness.replaceSessionBranch).toHaveBeenCalledTimes(1);
    expect(harness.replaceSessionBranch.mock.calls[0][1]).toEqual(["assistant-old"]);
    expect(harness.replaceSessionBranch.mock.calls[0][2]).toHaveLength(1);
    expect(harness.showCustomAlert).not.toHaveBeenCalled();

    consoleLog.mockRestore();
    consoleClear.mockRestore();
    consoleDebug.mockRestore();
    consoleError.mockRestore();
  });

  
  it("流式期间 session 被修改时，最终 session 保留修改（P0 A 回归）", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleClear = vi.spyOn(console, "clear").mockImplementation(() => undefined);
    const consoleDebug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const session: ChatSession = {
      id: "session-p0-a",
      characterId: "character-1",
      title: "P0 A 回归",
      messages: [
        { id: "welcome", sender: "assistant", content: "欢迎消息", timestamp: 0 },
        { id: "user-1", sender: "user", content: "原始用户消息", timestamp: 1 },
        { id: "assistant-old", sender: "assistant", content: "旧回复", timestamp: 2 },
      ],
      summaries: [],
      createdAt: 1,
    };

    // 捕获 setSessionViews，在 streamLlmResponse 中调用以模拟"流式期间 session 被修改"
    // （如用户通过 MemoryTableDrawer 编辑了某条消息）
    let externalSetSessions: ((updater: React.SetStateAction<ChatSession[]>) => void) | null = null;
    const harness = createWeakNetworkHarness(session, async function* () {
      // 模拟流式期间用户编辑了 user-1 消息内容
      if (externalSetSessions) {
        externalSetSessions((prev) => prev.map((s) =>
          s.id === session.id
            ? {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === "user-1" ? { ...m, content: "编辑后的用户消息" } : m
                ),
              }
            : s
        ));
      }
      yield { choices: [{ delta: { content: "新的回复" } }] };
    });
    externalSetSessions = harness.params.setSessionViews as unknown as (updater: React.SetStateAction<ChatSession[]>) => void;

    const { result } = renderHook(() => useRerollMessage(harness.params));

    await act(async () => {
      await result.current.handleRerollLast();
    });

    const messages = harness.getSessions()[0].messages;
    // P0 A 修复前：trueFinalSession.messages = [...updatedSession.messages, finalAiMsg]
    //   → user-1 内容是"原始用户消息"（旧切片覆盖了流式期间的编辑）
    // P0 A 修复后：trueFinalSession = replacePlaceholderMessage(latestSession, finalAiMsg)
    //   → user-1 内容是"编辑后的用户消息"（保留流式期间的修改）
    expect(messages.find((m) => m.id === "user-1")?.content).toBe("编辑后的用户消息");
    expect(messages.at(-1)?.content).toBe("新的回复");
    expect(harness.replaceSessionBranch).toHaveBeenCalledTimes(1);

    consoleLog.mockRestore();
    consoleClear.mockRestore();
    consoleDebug.mockRestore();
    consoleWarn.mockRestore();
  });
});

// ============================================================================
// 扩展覆盖：错误路径、状态同步、资源清理、遥测上报
// ============================================================================

/**
 * 可控的 harness 工厂：支持注入 stream 行为、确认弹窗响应，
 * 并暴露所有 ref/setter 以便断言状态机收尾。
 * resolveApiCredentials 由模块级 mock 统一控制，见文件顶部。
 */
function createControllableHarness(options: {
  session: ChatSession;
  streamFactory?: (...args: unknown[]) => AsyncGenerator<unknown>;
  showCustomConfirm?: () => Promise<boolean>;
}) {
  const { session, streamFactory, showCustomConfirm } = options;
  let sessions = [session];
  const sessionsRef = { current: sessions };
  const setSessionViews = vi.fn((updater: React.SetStateAction<ChatSession[]>) => {
    sessions = typeof updater === "function" ? updater(sessions) : updater;
    sessionsRef.current = sessions;
  });
  const replaceSessionBranch = vi.fn<(session: ChatSession, removedIds: string[], newMessages: Message[]) => Promise<void>>(async () => undefined);
  const isSendingRef = { current: false };
  const abortControllerRef = { current: null as AbortController | null };
  const pendingUpdateTimeoutRef = { current: null as ReturnType<typeof setTimeout> | null };

  const params = {
    kernel: {
      getService: vi.fn(() => ({
        getRecall: () => ({ recall: vi.fn(async () => []) }),
        getExtractor: () => ({ scheduleExtraction: vi.fn() }),
      })),
      getPipeline: vi.fn(() => ({
        list: () => [],
        matches: () => false,
        execute: vi.fn(async () => undefined),
      })),
    },
    settings: {
      api: { apiKey: "test-key", modelName: "test-model", baseUrl: "https://example.com" },
      preset: {},
      memory: { recentTurns: 100, enableRecall: false },
      enableTableMemory: false,
      enableScriptExecution: false,
      enableBisonMode: false,
      enableReplySuggestions: false,
      userName: "测试用户",
    } as UserSettings,
    globalLorebook: [],
    customWorldbooks: {},
    characters: [],
    activeCharacter: { id: "character-1", name: "测试角色" } as CharacterCard,
    activeSession: session,
    isSendingRef,
    activeRequestIdRef: { current: 0 },
    activeSessionIdRef: { current: session.id },
    sessionsRef,
    abortControllerRef,
    pendingUpdateTimeoutRef,
    setSessionViews,
    setIsSending: vi.fn(),
    setReplySuggestions: vi.fn(),
    publishMemoryAudit: vi.fn(),
    publishRecalledMemories: vi.fn(),
    triggerScroll: vi.fn(),
    databaseService: createRerollDatabaseStub(
      () => sessionsRef.current.find((item) => item.id === session.id) ?? session,
      replaceSessionBranch,
    ),
    promptService: { assemblePrompt: vi.fn(() => ({ messages: [], systemInstruction: "", dynamicInstruction: "", history: [], traces: [] })), estimateTokens: vi.fn((s: string) => s.length) },
    telemetryService: {
      reportUsage: vi.fn(),
      reportLlmPerformance: vi.fn(),
    },
    chatStreamService: { streamLlmResponse: vi.fn(streamFactory ?? (async function* () {
      yield { choices: [{ delta: { content: "默认回复" } }] };
    })) },
    showCustomAlert: vi.fn(async () => undefined),
    showCustomConfirm: vi.fn(showCustomConfirm ?? (async () => true)),
  } as unknown as Parameters<typeof useRerollMessage>[0];

  return {
    params,
    getSessions: () => sessions,
    sessionsRef,
    isSendingRef,
    abortControllerRef,
    pendingUpdateTimeoutRef,
    replaceSessionBranch,
    setSessionViews,
  };
}

/**
 * 创建包含单条用户消息 + 单条 AI 回复的最小会话，便于重发目标定位。
 */
function createMinimalSession(): ChatSession {
  return {
    id: "session-minimal",
    characterId: "character-1",
    title: "最小重发会话",
    messages: [
      { id: "welcome", sender: "assistant", content: "欢迎消息", timestamp: 0 },
      { id: "user-1", sender: "user", content: "用户提问", timestamp: 1 },
      { id: "assistant-1", sender: "assistant", content: "旧回复", timestamp: 2 },
    ],
    summaries: [],
    createdAt: 1,
  };
}

describe("useRerollMessage 错误路径与边界条件", () => {
  let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;

  beforeEach(() => {
    consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
  });

  afterEach(() => {
    consoleSpies.forEach((s) => s.mockRestore());
    vi.restoreAllMocks();
  });

  it("用户取消分支覆盖确认时清理事务锁且不触发流式请求", async () => {
    const session = createMinimalSession();
    const harness = createControllableHarness({
      session,
      // 用户在确认弹窗中选择"取消"
      showCustomConfirm: async () => false,
    });
    const { result } = renderHook(() => useRerollMessage(harness.params));

    await act(async () => {
      // 直接重发历史中间的 user-1，会触发分支覆盖确认
      await result.current.handleRerollFromMessage(session.messages[1]);
    });

    // 取消后：事务锁释放、未触发 streamLlmResponse、未持久化分支
    expect(harness.isSendingRef.current).toBe(false);
    expect(harness.params.chatStreamService.streamLlmResponse).not.toHaveBeenCalled();
    expect(harness.replaceSessionBranch).not.toHaveBeenCalled();
    // sessions 未被修改（保留旧回复）
    expect(harness.getSessions()[0].messages).toHaveLength(3);
  });

  it("重发目标消息在会话中不存在时静默退出且释放锁", async () => {
    const session = createMinimalSession();
    const harness = createControllableHarness({ session });
    const { result } = renderHook(() => useRerollMessage(harness.params));

    await act(async () => {
      await result.current.handleRerollFromMessage({
        id: "non-existent",
        sender: "user",
        content: "不存在的消息",
        timestamp: 999,
      });
    });

    expect(harness.isSendingRef.current).toBe(false);
    expect(harness.params.chatStreamService.streamLlmResponse).not.toHaveBeenCalled();
  });

  it("重发目标为会话末尾 AI 回复且无前置用户消息时提示并释放锁", async () => {
    // 仅含欢迎词 + 一条 AI 回复，缺少可驱动重发的用户消息
    const session: ChatSession = {
      id: "session-no-user",
      characterId: "character-1",
      title: "无用户消息",
      messages: [
        { id: "welcome", sender: "assistant", content: "欢迎消息", timestamp: 0 },
        { id: "assistant-only", sender: "assistant", content: "无驱动回复", timestamp: 1 },
      ],
      summaries: [],
      createdAt: 1,
    };
    const harness = createControllableHarness({ session });
    const { result } = renderHook(() => useRerollMessage(harness.params));

    await act(async () => {
      await result.current.handleRerollFromMessage(session.messages[1]);
    });

    // 应弹出提示并清理
    expect(harness.params.showCustomAlert).toHaveBeenCalledWith(
      expect.stringContaining("需要前置有一条用户消息")
    );
    expect(harness.isSendingRef.current).toBe(false);
    expect(harness.params.chatStreamService.streamLlmResponse).not.toHaveBeenCalled();
  });

  it("流式正常完成但 AI 返回空内容时恢复原始会话并提示失败", async () => {
    const session = createMinimalSession();
    const harness = createControllableHarness({
      session,
      // 流式正常完成但未产出任何内容
      streamFactory: async function* () {
        yield { choices: [{ delta: { content: "" } }] };
      },
    });
    const { result } = renderHook(() => useRerollMessage(harness.params));

    await act(async () => {
      await result.current.handleRerollLast();
    });

    // 应恢复为原始会话（含旧回复），且弹出失败提示
    const finalMessages = harness.getSessions()[0].messages;
    expect(finalMessages.map((m) => m.content)).toEqual(["欢迎消息", "用户提问", "旧回复"]);
    expect(harness.params.showCustomAlert).toHaveBeenCalledWith(
      expect.stringContaining("AI 未返回任何内容")
    );
    // 未持久化新分支
    expect(harness.replaceSessionBranch).not.toHaveBeenCalled();
    expect(harness.isSendingRef.current).toBe(false);
  });

  it("流式收到 content_filter finish_reason 时抛错并走弱网失败分支", async () => {
    const session = createMinimalSession();
    const harness = createControllableHarness({
      session,
      // 先产出部分内容，再在下一个 chunk 触发 content_filter
      // 源码中 content_filter 检查在 delta 推送之前，因此需分开发送
      streamFactory: async function* () {
        yield { choices: [{ delta: { content: "部分内容" } }] };
        yield { choices: [{ delta: {}, finish_reason: "content_filter" }] };
      },
    });
    const { result } = renderHook(() => useRerollMessage(harness.params));

    await act(async () => {
      await result.current.handleRerollLast();
    });

    // content_filter 抛错后，已收到的部分内容会被附加弱网标记后保存
    const finalMessages = harness.getSessions()[0].messages;
    expect(finalMessages.at(-1)?.content).toContain("部分内容");
    expect(finalMessages.at(-1)?.content).toContain(CONNECTION_INTERRUPTED_SUFFIX);
    expect(harness.replaceSessionBranch).toHaveBeenCalledTimes(1);
  });

  it("流式期间 session 切换（isStillActive=false）时静默保存新分支", async () => {
    const session = createMinimalSession();
    const harness = createControllableHarness({
      session,
      streamFactory: async function* () {
        yield { choices: [{ delta: { content: "新回复" } }] };
      },
    });
    const { result } = renderHook(() => useRerollMessage(harness.params));

    // 在流式开始前，将 activeSessionIdRef 切换到别的会话
    // 通过劫持 setSessionViews 在流式期间触发切换
    const originalSetSessions = harness.params.setSessionViews;
    let switched = false;
    harness.params.setSessionViews = vi.fn((updater: React.SetStateAction<ChatSession[]>) => {
      (originalSetSessions as (u: React.SetStateAction<ChatSession[]>) => void)(updater);
      if (!switched) {
        switched = true;
        // 切换 activeSessionIdRef，模拟用户切换会话
        harness.params.activeSessionIdRef.current = "other-session";
      }
    }) as unknown as React.Dispatch<React.SetStateAction<ChatSession[]>>;

    await act(async () => {
      await result.current.handleRerollLast();
    });

    // 应走静默保存路径：调用了 persistRerollSession（replaceSessionBranch）
    expect(harness.replaceSessionBranch).toHaveBeenCalledTimes(1);
    // 不应弹出 alert（静默保存）
    expect(harness.params.showCustomAlert).not.toHaveBeenCalledWith(
      expect.stringContaining("重新生成失败")
    );
  });
});

describe("useRerollMessage 状态同步与资源清理", () => {
  let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;

  beforeEach(() => {
    consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    // 重置 window 全局辅助字段
    if (typeof window !== "undefined") {
      const win = window as unknown as Record<string, unknown>;
      win.TavernHelperStreamingMessageId = undefined;
      win.TavernHelperIsSending = undefined;
    }
  });

  afterEach(() => {
    consoleSpies.forEach((s) => s.mockRestore());
    vi.restoreAllMocks();
    if (typeof window !== "undefined") {
      const win = window as unknown as Record<string, unknown>;
      delete win.TavernHelperStreamingMessageId;
      delete win.TavernHelperIsSending;
    }
  });

  it("成功重发后清理 TavernHelperStreamingMessageId 与 IsSending 全局标志", async () => {
    const session = createMinimalSession();
    const harness = createControllableHarness({
      session,
      streamFactory: async function* () {
        yield { choices: [{ delta: { content: "新回复" } }] };
      },
    });
    const { result } = renderHook(() => useRerollMessage(harness.params));

    await act(async () => {
      await result.current.handleRerollLast();
    });

    // 流式完成后，全局标志应被清理
    const win = window as unknown as Record<string, unknown>;
    expect(win.TavernHelperStreamingMessageId).toBeNull();
    expect(win.TavernHelperIsSending).toBe(false);
    // abortControllerRef 也应被清理
    expect(harness.abortControllerRef.current).toBeNull();
    // pendingUpdateTimeoutRef 应被清理
    expect(harness.pendingUpdateTimeoutRef.current).toBeNull();
  });

  it("流式抛错后 finally 兜底清理全局标志与 abortControllerRef", async () => {
    const session = createMinimalSession();
    const harness = createControllableHarness({
      session,
      streamFactory: async function* () {
        yield { choices: [{ delta: { content: "部分" } }] };
        throw new Error("connection reset");
      },
    });
    const { result } = renderHook(() => useRerollMessage(harness.params));

    await act(async () => {
      await result.current.handleRerollLast();
    });

    // 异常路径下 finally 也应清理全局标志
    const win = window as unknown as Record<string, unknown>;
    expect(win.TavernHelperStreamingMessageId).toBeNull();
    expect(win.TavernHelperIsSending).toBe(false);
    expect(harness.abortControllerRef.current).toBeNull();
    expect(harness.pendingUpdateTimeoutRef.current).toBeNull();
    expect(harness.isSendingRef.current).toBe(false);
  });
});

describe("useRerollMessage 成功路径与遥测上报", () => {
  let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;

  beforeEach(() => {
    consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
  });

  afterEach(() => {
    consoleSpies.forEach((s) => s.mockRestore());
    vi.restoreAllMocks();
  });

  it("成功重发后调用 reportLlmPerformance 上报 TTFT 与 token 使用量", async () => {
    const session = createMinimalSession();
    const harness = createControllableHarness({
      session,
      streamFactory: async function* () {
        yield { choices: [{ delta: { content: "新的成功回复" } }] };
        yield { usage: { prompt_tokens: 100, completion_tokens: 50 } };
      },
    });
    const { result } = renderHook(() => useRerollMessage(harness.params));

    await act(async () => {
      await result.current.handleRerollLast();
    });

    // 遥测上报：reportUsage（regenerate_message）+ reportLlmPerformance
    expect(harness.params.telemetryService.reportUsage).toHaveBeenCalledWith(
      "regenerate_message",
      expect.objectContaining({ characterName: "测试角色" })
    );
    expect(harness.params.telemetryService.reportLlmPerformance).toHaveBeenCalledWith(
      session.id,
      "test-model",
      expect.any(Number), // ttftMs
      150,                // prompt + completion
      expect.any(Number), // total elapsed
      100,                // prompt tokens
      50,                 // completion tokens
      "测试角色",
      expect.any(String), // userName
      expect.any(String), // traceId
    );
  });

  it("重发末尾用户消息（无后续 AI 回复）时直接生成新回复", async () => {
    // 场景：用户消息后未生成 AI 回复（首包失败），重发应针对该用户消息生成新回复
    const session: ChatSession = {
      id: "session-pending-user",
      characterId: "character-1",
      title: "待回复用户消息",
      messages: [
        { id: "welcome", sender: "assistant", content: "欢迎消息", timestamp: 0 },
        { id: "user-pending", sender: "user", content: "待回复问题", timestamp: 1 },
      ],
      summaries: [],
      createdAt: 1,
    };
    const harness = createControllableHarness({
      session,
      streamFactory: async function* () {
        yield { choices: [{ delta: { content: "新生成的回复" } }] };
      },
    });
    const { result } = renderHook(() => useRerollMessage(harness.params));

    await act(async () => {
      await result.current.handleRerollLast();
    });

    // handleRerollLast 应识别"最后用户消息在最后 AI 回复之后"，针对 user-pending 重发
    const messages = harness.getSessions()[0].messages;
    expect(messages.map((m) => m.content)).toEqual(["欢迎消息", "待回复问题", "新生成的回复"]);
    // 分支持久化：removedMessageIds 应为空（无旧 AI 回复需要移除）
    expect(harness.replaceSessionBranch).toHaveBeenCalledTimes(1);
    expect(harness.replaceSessionBranch.mock.calls[0][1]).toEqual([]);
  });

  it("重发包含 reasoning_content 的流式回复时正确分离内容与思考", async () => {
    const session = createMinimalSession();
    const harness = createControllableHarness({
      session,
      streamFactory: async function* () {
        // 先产出 reasoning，再产出 content
        yield { choices: [{ delta: { reasoning_content: "思考过程" } }] };
        yield { choices: [{ delta: { content: "最终回复" } }] };
      },
    });
    const { result } = renderHook(() => useRerollMessage(harness.params));

    await act(async () => {
      await result.current.handleRerollLast();
    });

    const finalMsg = harness.getSessions()[0].messages.at(-1);
    expect(finalMsg?.content).toBe("最终回复");
    // reasoningContent 应被分离存储
    expect(finalMsg?.reasoningContent).toBe("思考过程");
  });

  it("直接调用 handleRerollFromMessage 重发指定消息（不依赖 handleRerollLast 决策）", async () => {
    const session = createLongSession();
    const harness = createControllableHarness({
      session,
      streamFactory: async function* () {
        yield { choices: [{ delta: { content: "针对指定消息的回复" } }] };
      },
    });
    const { result } = renderHook(() => useRerollMessage(harness.params));

    // 直接重发第 5 轮的 user 消息（位于会话中部，会触发分支覆盖确认）
    await act(async () => {
      await result.current.handleRerollFromMessage(session.messages[9]); // user-4
    });

    // 由于 user-4 之后还有消息，应弹出确认（这里确认通过），重发后只保留 user-4 之前 + 新回复
    const finalMessages = harness.getSessions()[0].messages;
    expect(finalMessages.at(-1)?.content).toBe("针对指定消息的回复");
    // user-4 之后的 assistant-4 / user-5 等应被移除
    expect(finalMessages.some((m) => m.id === "assistant-4")).toBe(false);
    expect(finalMessages.some((m) => m.id === "user-5")).toBe(false);
  });
});

describe("useRerollMessage 仅思维链（正文为空）回归", () => {
  function createReasoningOnlySession(): ChatSession {
    return {
      id: "session-reasoning-only",
      characterId: "character-1",
      title: "仅思维链重发",
      messages: [
        { id: "welcome", sender: "assistant", content: "欢迎消息", timestamp: 0 },
        { id: "user-1", sender: "user", content: "继续", timestamp: 1 },
        {
          id: "assistant-empty",
          sender: "assistant",
          content: "",
          reasoningContent: "全部内容都在思维链里",
          timestamp: 2,
        },
      ],
      summaries: [],
      createdAt: 1,
    };
  }

  it("正文为空但带思维链的助手消息可直接重发（菜单入口）", async () => {
    const session = createReasoningOnlySession();
    const harness = createControllableHarness({
      session,
      streamFactory: async function* () {
        yield { choices: [{ delta: { content: "重发后的正文" } }] };
      },
    });
    const { result } = renderHook(() => useRerollMessage(harness.params));

    const emptyMsg = session.messages[2];
    await act(async () => {
      await result.current.handleRerollFromMessage(emptyMsg);
    });

    const messages = harness.getSessions()[0].messages;
    expect(messages.map((m) => m.content)).toEqual(["欢迎消息", "继续", "重发后的正文"]);
    expect(messages.some((m) => m.id === "assistant-empty")).toBe(false);
    expect(harness.replaceSessionBranch).toHaveBeenCalledTimes(1);
    expect(harness.replaceSessionBranch.mock.calls[0][1]).toEqual(["assistant-empty"]);
    expect(harness.isSendingRef.current).toBe(false);
  });

  it("重发最后一条：最后一条为仅思维链消息时正常重发", async () => {
    const session = createReasoningOnlySession();
    const harness = createControllableHarness({
      session,
      streamFactory: async function* () {
        yield { choices: [{ delta: { content: "重发后的正文" } }] };
      },
    });
    const { result } = renderHook(() => useRerollMessage(harness.params));

    await act(async () => {
      await result.current.handleRerollLast();
    });

    const messages = harness.getSessions()[0].messages;
    expect(messages.at(-1)?.content).toBe("重发后的正文");
    expect(messages.some((m) => m.id === "assistant-empty")).toBe(false);
    expect(harness.replaceSessionBranch).toHaveBeenCalledTimes(1);
    expect(harness.replaceSessionBranch.mock.calls[0][1]).toEqual(["assistant-empty"]);
  });

  it("重发移除年表边界消息时同步修正 lastSummarizedMessageId 与年表卡片", async () => {
    const session: ChatSession = {
      id: "session-boundary-reroll",
      characterId: "character-1",
      title: "边界重发",
      messages: [
        { id: "welcome", sender: "assistant", content: "欢迎消息", timestamp: 0 },
        { id: "user-1", sender: "user", content: "继续", timestamp: 1 },
        { id: "assistant-archived", sender: "assistant", content: "已归档回复", timestamp: 2 },
      ],
      summaries: [
        {
          id: "summary-1",
          timeTag: "第一幕",
          location: "营地",
          content: "早期剧情",
          lastMessageId: "assistant-archived",
        },
      ],
      lastSummarizedMessageId: "assistant-archived",
      createdAt: 1,
    };
    const harness = createControllableHarness({
      session,
      streamFactory: async function* () {
        yield { choices: [{ delta: { content: "重发后的正文" } }] };
      },
    });
    const { result } = renderHook(() => useRerollMessage(harness.params));

    await act(async () => {
      await result.current.handleRerollLast();
    });

    const persisted = harness.replaceSessionBranch.mock.calls[0][0] as ChatSession;
    expect(persisted.lastSummarizedMessageId).toBeUndefined();
    expect(persisted.summaries).toEqual([]);
    expect(persisted.messages.map((m) => m.content)).toEqual([
      "欢迎消息",
      "继续",
      "重发后的正文",
    ]);
    const uiMessages = harness.getSessions()[0].messages;
    expect(uiMessages.map((m) => m.content)).toEqual([
      "欢迎消息",
      "继续",
      "重发后的正文",
    ]);
  });
});

describe("useRerollMessage 凭证解析错误处理", () => {
  let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;

  beforeEach(() => {
    consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    // 默认返回有效凭证，单个测试可覆盖
    resolveApiCredentialsMock.mockImplementation(() => ({
      apiKey: "test-key",
      baseUrl: "https://example.com",
      model: "test-model",
      chatPath: "/v1/chat/completions",
      isTrial: false,
    }));
  });

  afterEach(() => {
    consoleSpies.forEach((s) => s.mockRestore());
    resolveApiCredentialsMock.mockReset();
    vi.restoreAllMocks();
  });

  it("resolveApiCredentials 抛 TrialExhaustedError 时提示试用耗尽并释放锁", async () => {
    const session = createMinimalSession();
    resolveApiCredentialsMock.mockImplementation(() => {
      throw new TrialExhaustedError();
    });

    const harness = createControllableHarness({ session });
    const { result } = renderHook(() => useRerollMessage(harness.params));

    await act(async () => {
      await result.current.handleRerollLast();
    });

    expect(harness.params.showCustomAlert).toHaveBeenCalledWith(
      expect.stringContaining("10 次公共免 Key 体验次数已用完")
    );
    expect(harness.isSendingRef.current).toBe(false);
    expect(harness.params.chatStreamService.streamLlmResponse).not.toHaveBeenCalled();
  });

  it("resolveApiCredentials 抛 ModelNotConfiguredError 时提示配置模型并释放锁", async () => {
    const session = createMinimalSession();
    resolveApiCredentialsMock.mockImplementation(() => {
      throw new ModelNotConfiguredError();
    });

    const harness = createControllableHarness({ session });
    const { result } = renderHook(() => useRerollMessage(harness.params));

    await act(async () => {
      await result.current.handleRerollLast();
    });

    expect(harness.params.showCustomAlert).toHaveBeenCalledWith(
      expect.stringContaining("尚未配置具体的接口模型")
    );
    expect(harness.isSendingRef.current).toBe(false);
  });

  it("流式阶段抛 TrialKeyFetchError 时提示试用服务不可用并清理占位符", async () => {
    const session = createMinimalSession();
    const harness = createControllableHarness({
      session,
      streamFactory: async function* () {
        throw new TrialKeyFetchError();
      },
    });
    const { result } = renderHook(() => useRerollMessage(harness.params));

    await act(async () => {
      await result.current.handleRerollLast();
    });

    // 应提示试用服务不可用
    expect(harness.params.showCustomAlert).toHaveBeenCalledWith(
      expect.stringContaining("免费试用服务暂不可用")
    );
    // 旧分支尚未提交，失败时只需清理 UI 占位符，不应改写数据库分支。
    expect(harness.replaceSessionBranch).not.toHaveBeenCalled();
    expect(harness.isSendingRef.current).toBe(false);
  });
});
