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
import type { MessageContentPart } from "../../src/domain/messages/messageContent";
import type {
  AgentHandle,
  AgentInputModality,
  AgentProviderDefinition,
  AgentTurnExecutionContext,
} from "../../src/domain/agents/contracts";

function emptyPromptShapingReport() {
  return {
    enabled: false,
    originalMessageCount: 1,
    finalMessageCount: 1,
    mergedMessageCount: 0,
    squashedSystemMessageCount: 0,
    assistantPrefillAdded: false,
    stopSequences: [],
  };
}

function createHarness(
  streamLlmResponse: (...args: any[]) => AsyncGenerator<any>,
  providerModalities: readonly AgentInputModality[] = ["text", "image"],
  attachmentBlob: Blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
) {
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
  const queueUserMessage = vi.fn(async (
    source: ChatSession,
    text: string,
    additionalParts: readonly MessageContentPart[] = [],
  ) => ({
    ...source,
    messages: [
      ...source.messages.filter((message) => message.content !== "💭..."),
      {
        id: `user-${++userMessageIndex}`,
        sender: "user" as const,
        content: text.trim(),
        timestamp: userMessageIndex,
        ...(additionalParts.length > 0 ? {
          contentVersion: 2 as const,
          parts: [
            ...(text.trim() ? [{ type: "text" as const, text: text.trim() }] : []),
            ...additionalParts,
          ],
        } : {}),
      },
    ],
  }));
  const scheduleExtraction = vi.fn();
  const checkAndSummarize = vi.fn(async (current: ChatSession) => current);
  const abortControllerRef = { current: null as AbortController | null };
  const bisonChainTimerRef = { current: null as ReturnType<typeof setTimeout> | null };
  const isSendingRef = { current: false };
  const showCustomAlert = vi.fn(async () => undefined);
  const databaseService = {
    getSessionPromptMessages: vi.fn(async (
      requestedSessionId: string,
      options: { limit?: number; preserveFirstAssistant: boolean },
    ) => {
      const messages = sessionsRef.current.find((item) => item.id === requestedSessionId)?.messages ?? [];
      if (options.limit === undefined) return messages;
      const recent = messages.slice(-options.limit);
      const firstAssistant = messages.find((message) => message.sender === "assistant");
      return options.preserveFirstAssistant
        && firstAssistant
        && !recent.some((message) => message.id === firstAssistant.id)
        ? [firstAssistant, ...recent]
        : recent;
    }),
    commitSessionTurn: vi.fn(async () => undefined),
    appendSessionMessage: vi.fn(async () => undefined),
    updateSessionMetadata: vi.fn(async () => undefined),
  };
  const provider: AgentProviderDefinition = {
    id: "provider.openai-compatible",
    version: "1.0.0",
    capabilities: {
      inputModalities: providerModalities,
      supportedMimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp", "audio/wav", "audio/mpeg"],
      supportsStreaming: true,
      supportsTools: true,
    },
    buildRequestBody: (request) => ({ ...request }),
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
      let activeTurnId: string | null = null;
      return {
        async send(input) {
          controller = new AbortController();
          activeTurnId = "turn-test";
          const context: AgentTurnExecutionContext = {
            sessionId: options.sessionId,
            turnId: activeTurnId,
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
          await options.executeLegacy(context);
          activeTurnId = null;
          controller = null;
          return { turnId: "turn-test", status: "completed" };
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
          status: activeTurnId ? "running" : "idle",
          activeTurnId,
        }),
        subscribe: () => () => undefined,
      };
    },
  };

  const params = {
    kernel: {
      getService: vi.fn((name: string) => {
        if (name === "agentRuntime") return agentRuntime;
        return name === "attachments" ? {
            getBlob: vi.fn(async () => attachmentBlob),
          }
        : {
            getExtractor: () => ({ scheduleExtraction }),
            getSummary: () => ({ checkAndSummarize }),
          };
      }),
      getPipeline: vi.fn(() => ({
        list: () => [{}, {}, {}],
        matches: () => true,
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
    setSessionViews: setSessions,
    setIsSending: vi.fn(),
    setIsBisonLocking: vi.fn(),
    setReplySuggestions: vi.fn(),
    publishRecalledMemories: vi.fn(),
    triggerScroll: vi.fn(),
    databaseService,
    promptService: {
      assemblePrompt: vi.fn(() => ({ messages: [], traces: [] })),
      estimateTokens: vi.fn((content: string) => content.length),
    },
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
    checkAndSummarize,
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

  it("事务锁已释放但 React 展示状态仍滞后时继续调用 LLM", async () => {
    silenceConsole();
    const harness = createHarness(async function* () {
      yield { choices: [{ delta: { content: "正常回复" } }] };
    });
    harness.params.isSending = true;
    harness.isSendingRef.current = false;
    const { result } = renderHook(() => useSendMessage(harness.params));

    await act(async () => {
      await result.current.handleSendMessage("紧接上一轮发送");
    });

    expect(harness.params.chatStreamService.streamLlmResponse).toHaveBeenCalledTimes(1);
    expect(harness.queueUserMessage).toHaveBeenCalledTimes(1);
    expect(harness.getSessions()[0].messages.at(-1)?.content).toBe("正常回复");
    expect(harness.isSendingRef.current).toBe(false);
    expect(harness.databaseService.commitSessionTurn.mock.invocationCallOrder[0])
      .toBeLessThan(harness.checkAndSummarize.mock.invocationCallOrder[0]);
  });

  it("正常发送会为请求包装后的历史助手消息回放 reasoning_content", async () => {
    silenceConsole();
    const harness = createHarness(async function* () {
      yield { choices: [{ delta: { content: "下一轮回复" } }] };
    });
    harness.getSessions()[0].messages[0].reasoningContent = "上一轮思考";
    harness.params.settings.api = {
      ...harness.params.settings.api,
      type: "openai-compat",
      modelName: "deepseek-chat",
      baseUrl: "https://api.deepseek.com/v1",
    };
    harness.params.promptService.assemblePrompt = vi.fn(() => ({
      version: 1 as const,
      systemInstruction: "",
      dynamicInstruction: "",
      history: [],
      messages: [
        { role: "assistant" as const, content: "<center>\n欢迎消息\n</center>" },
        { role: "user" as const, content: "继续" },
      ],
      diagnostics: [],
      traces: [],
      requestShaping: emptyPromptShapingReport(),
    }));
    const { result } = renderHook(() => useSendMessage(harness.params));

    await act(async () => {
      await result.current.handleSendMessage("继续");
    });

    const streamCall = vi.mocked(harness.params.chatStreamService.streamLlmResponse).mock.calls[0][0];
    const body = streamCall.reqBody as {
      messages: Array<{ role: string; content: unknown; reasoning_content?: string }>;
    };
    expect(body.messages[0]).toMatchObject({
      role: "assistant",
      reasoning_content: "上一轮思考",
    });
  });

  it("首包失败时移除占位符但只保留一条用户消息，供显式重发", async () => {
    silenceConsole();
    const harness = createHarness(async function* () {
      yield* [];
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
    expect(harness.databaseService.commitSessionTurn).toHaveBeenCalledTimes(1);
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

  it("显式启用视觉能力后把 V2 图片消息投影到 Provider 请求", async () => {
    silenceConsole();
    const harness = createHarness(async function* () {
      yield { choices: [{ delta: { content: "看到了" } }] };
    });
    harness.params.settings.api = {
      ...harness.params.settings.api,
      type: "openai-compat",
      supportsVision: true,
    };
    harness.params.promptService.assemblePrompt = vi.fn(() => ({
      version: 1 as const,
      systemInstruction: "",
      dynamicInstruction: "",
      history: [],
      messages: [{ role: "user" as const, content: "请看图" }],
      diagnostics: [],
      traces: [],
      requestShaping: emptyPromptShapingReport(),
    }));
    const { result } = renderHook(() => useSendMessage(harness.params));

    await act(async () => {
      await result.current.handleSendMessage("请看图", { attachmentIds: ["att_image1"] });
    });

    const streamCall = vi.mocked(harness.params.chatStreamService.streamLlmResponse).mock.calls[0][0];
    const body = streamCall.reqBody as { messages: Array<{ role: string; content: unknown }> };
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "请看图" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AQID", detail: "auto" } },
    ]);
  });

  it("视频关键帧所需图片能力缺失时在消息落库前拒绝", async () => {
    silenceConsole();
    const harness = createHarness(async function* () {
      yield { choices: [{ delta: { content: "不应调用" } }] };
    }, ["text"]);
    harness.params.settings.api = {
      ...harness.params.settings.api,
      type: "anthropic",
      supportsVision: true,
    };
    const { result } = renderHook(() => useSendMessage(harness.params));

    await act(async () => {
      await result.current.handleSendMessage("请看视频", {
        attachmentParts: [{ type: "video", assetId: "att_video1" }],
      });
    });

    expect(harness.showCustomAlert).toHaveBeenCalledWith(expect.stringContaining("video"));
    expect(harness.queueUserMessage).not.toHaveBeenCalled();
    expect(harness.params.chatStreamService.streamLlmResponse).not.toHaveBeenCalled();
  });

  it("模型语音输入直接投影为 input_audio，不触发普通音频的 ASR 降级", async () => {
    silenceConsole();
    const harness = createHarness(
      async function* () {
        yield { choices: [{ delta: { content: "听到了" } }] };
      },
      ["text", "audio"],
      new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }),
    );
    harness.params.settings.api = {
      ...harness.params.settings.api,
      type: "openai-compat",
      supportsAudioInput: true,
    };
    harness.params.promptService.assemblePrompt = vi.fn(() => ({
      version: 1 as const,
      systemInstruction: "",
      dynamicInstruction: "",
      history: [],
      messages: [{ role: "user" as const, content: "" }],
      diagnostics: [],
      traces: [],
      requestShaping: emptyPromptShapingReport(),
    }));
    const { result } = renderHook(() => useSendMessage(harness.params));

    await act(async () => {
      await result.current.handleSendMessage("", {
        attachmentParts: [{ type: "audio", assetId: "att_voice1", purpose: "model-input" }],
      });
    });

    expect(harness.showCustomAlert).not.toHaveBeenCalled();
    const streamCall = vi.mocked(harness.params.chatStreamService.streamLlmResponse).mock.calls[0][0];
    const body = streamCall.reqBody as { messages: Array<{ role: string; content: unknown }> };
    expect(body.messages[0].content).toEqual([{
      type: "input_audio",
      input_audio: { data: "AQID", format: "wav" },
    }]);
  });
});
