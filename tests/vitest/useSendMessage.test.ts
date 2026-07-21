/**
 * 普通发送链路的事务与弱网回归测试。
 *
 * 流式 POST 不做静默自动重试：首包失败时保留用户消息，用户可通过“重发”显式恢复；
 * 已收到部分内容时则保存部分回复并标记连接中断。主动停止不应被误判为弱网异常。
 */
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSendMessage } from "../../src/hooks/useChat/useSendMessage";
import { CONNECTION_INTERRUPTED_SUFFIX } from "../../src/hooks/useChat/pipelineHelpers";
import type { ChatSession, CharacterCard, Message, UserSettings } from "../../src/types";

function createHarness(streamLlmResponse: (...args: any[]) => AsyncGenerator<any>) {
  const welcome: Message = {
    id: "welcome",
    sender: "assistant",
    content: "欢迎消息",
    timestamp: 0,
  };
  const session: ChatSession = {
    id: "send-session",
    characterId: "character-1",
    title: "弱网发送测试",
    messages: [welcome],
    summaries: [],
    createdAt: 1,
  };
  let sessions = [session];
  const sessionsRef = { current: sessions };
  const setSessions = vi.fn((updater: React.SetStateAction<ChatSession[]>) => {
    sessions = typeof updater === "function" ? updater(sessions) : updater;
    sessionsRef.current = sessions;
  });
  let userMessageIndex = 0;
  const queueUserMessage = vi.fn(async (source: ChatSession, text: string) => ({
    ...source,
    messages: [
      ...source.messages.filter((message) => message.content !== "💭..."),
      {
        id: `user-${++userMessageIndex}`,
        sender: "user" as const,
        content: text.trim(),
        timestamp: userMessageIndex,
      },
    ],
  }));
  const scheduleExtraction = vi.fn();
  const abortControllerRef = { current: null as AbortController | null };
  const bisonChainTimerRef = { current: null as ReturnType<typeof setTimeout> | null };
  const isSendingRef = { current: false };
  const showCustomAlert = vi.fn(async () => undefined);
  const databaseService = {
    saveSession: vi.fn(async () => undefined),
    appendSessionMessage: vi.fn(async () => undefined),
  };

  const params = {
    kernel: {
      getService: vi.fn(() => ({ getExtractor: () => ({ scheduleExtraction }) })),
      getPipeline: vi.fn(() => ({
        list: () => [{}, {}, {}, {}],
        execute: vi.fn(async () => undefined),
      })),
    },
    settings: {
      api: {
        apiKey: "test-key",
        modelName: "test-model",
        baseUrl: "https://example.com",
      },
      preset: {},
      memory: { recentTurns: 100, enableRecall: false },
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
    isSending: false,
    isSendingRef,
    activeRequestIdRef: { current: 0 },
    activeSessionIdRef: { current: session.id },
    sessionsRef,
    abortControllerRef,
    pendingUpdateTimeoutRef: { current: null },
    bisonRemainingCountRef: { current: 0 },
    bisonChainTimerRef,
    setSessions,
    setIsSending: vi.fn(),
    setIsBisonLocking: vi.fn(),
    setReplySuggestions: vi.fn(),
    publishRecalledMemories: vi.fn(),
    triggerScroll: vi.fn(),
    databaseService,
    promptService: { assemblePrompt: vi.fn(() => ({ messages: [] })) },
    telemetryService: {
      incrementUsageCount: vi.fn(),
      reportUsage: vi.fn(),
      reportLlmPerformance: vi.fn(),
    },
    chatStreamService: { streamLlmResponse: vi.fn(streamLlmResponse) },
    multiMessageService: { queueUserMessage },
    memoryService: undefined,
    showCustomAlert,
    draftsRef: { current: {} },
  } as unknown as Parameters<typeof useSendMessage>[0];

  return {
    params,
    getSessions: () => sessions,
    queueUserMessage,
    showCustomAlert,
    databaseService,
    abortControllerRef,
    bisonChainTimerRef,
    isSendingRef,
  };
}

describe("useSendMessage 弱网与中止事务", () => {
  const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

  afterEach(() => {
    consoleSpies.splice(0).forEach((spy) => spy.mockRestore());
    vi.restoreAllMocks();
  });

  function silenceConsole() {
    consoleSpies.push(
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    );
  }

  it("首包失败时移除占位符但只保留一条用户消息，供显式重发", async () => {
    silenceConsole();
    const harness = createHarness(async function* () {
      throw new Error("Network connection lost");
    });
    const { result } = renderHook(() => useSendMessage(harness.params));

    await act(async () => {
      await result.current.handleSendMessage("弱网消息");
    });

    const messages = harness.getSessions()[0].messages;
    expect(messages.map((message) => message.sender)).toEqual(["assistant", "user"]);
    expect(messages.filter((message) => message.content === "弱网消息")).toHaveLength(1);
    expect(messages.some((message) => message.content === "💭...")).toBe(false);
    expect(harness.queueUserMessage).toHaveBeenCalledTimes(1);
    expect(harness.showCustomAlert).toHaveBeenCalledWith(expect.stringContaining("连接异常"));
    expect(harness.isSendingRef.current).toBe(false);
    expect(harness.abortControllerRef.current).toBeNull();
  });

  it("流式收到部分内容后断线，保存内容并附加弱网标记", async () => {
    silenceConsole();
    const harness = createHarness(async function* () {
      yield { choices: [{ delta: { content: "半段回复" } }] };
      throw new Error("socket disconnected");
    });
    const { result } = renderHook(() => useSendMessage(harness.params));

    await act(async () => {
      await result.current.handleSendMessage("继续故事");
    });

    const messages = harness.getSessions()[0].messages;
    expect(messages.at(-1)?.content).toBe(`半段回复${CONNECTION_INTERRUPTED_SUFFIX}`);
    expect(messages.filter((message) => message.content === "继续故事")).toHaveLength(1);
    expect(harness.databaseService.appendSessionMessage).toHaveBeenCalledTimes(1);
    expect(harness.showCustomAlert).toHaveBeenCalledWith(expect.stringContaining("连接异常"));
  });

  it("主动停止时保留已生成内容，不附加弱网标记并清理连续生成计时器", async () => {
    silenceConsole();
    const harness = createHarness(async function* ({ signal }: { signal: AbortSignal }) {
      yield { choices: [{ delta: { content: "停止前内容" } }] };
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    });
    harness.bisonChainTimerRef.current = setTimeout(() => undefined, 60_000);
    const { result } = renderHook(() => useSendMessage(harness.params));
    let sendPromise!: Promise<void>;

    act(() => {
      sendPromise = result.current.handleSendMessage("需要停止");
    });
    await waitFor(() => expect(harness.abortControllerRef.current).not.toBeNull());
    act(() => result.current.handleStopGeneration());
    await act(async () => {
      await sendPromise;
    });

    const content = harness.getSessions()[0].messages.at(-1)?.content;
    expect(content).toBe("停止前内容");
    expect(content).not.toContain(CONNECTION_INTERRUPTED_SUFFIX);
    expect(harness.showCustomAlert).not.toHaveBeenCalled();
    expect(harness.abortControllerRef.current).toBeNull();
    expect(harness.bisonChainTimerRef.current).toBeNull();
    expect(harness.isSendingRef.current).toBe(false);
  });
});
