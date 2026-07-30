import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCatbot } from "../../src/hooks/useCatbot";
import {
  clearTimers,
  globalState,
  updateGlobalState,
} from "../../src/utils/catbotGlobalState";
import { setResponsesCache } from "../../src/utils/catbotResponses";

const mocks = vi.hoisted(() => ({
  sendCatbotRequest: vi.fn(),
  unsubscribe: vi.fn(),
  subscribedListener: null as null | ((event: "api_error") => void),
}));

vi.mock("../../src/UnifiedAppContext", () => ({
  useUnifiedApp: (
    selector: (state: {
      settings: {
        userName: string;
        api: { baseUrl: string; modelName: string };
      };
      activeSession: { messages: Array<{ id: string }> };
    }) => unknown,
  ) =>
    selector({
      settings: {
        userName: "测试用户",
        api: { baseUrl: "https://example.com", modelName: "test-model" },
      },
      activeSession: { messages: [{ id: "message-1" }] },
    }),
}));

vi.mock("../../src/utils/apiClient", () => ({
  apiClient: {
    isClientMode: () => true,
    sendCatbotRequest: mocks.sendCatbotRequest,
  },
}));

vi.mock("../../src/utils/telemetry", () => ({
  getDeviceId: () => "device-test",
}));

vi.mock("../../src/utils/catbotEventBus", () => ({
  catbotEventBus: {
    subscribe: vi.fn((listener: (event: "api_error") => void) => {
      mocks.subscribedListener = listener;
      return mocks.unsubscribe;
    }),
  },
}));

const responses = {
  idle_click: ["固定点击反馈"],
  api_error: ["固定错误反馈"],
  cloud_fallback: {
    welcome: "固定欢迎语",
    offline: "固定离线反馈",
  },
};

describe("useCatbot 状态机", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    sessionStorage.setItem("catbot_shown_welcome", "true");
    setResponsesCache(responses);
    updateGlobalState({
      expression: "idle",
      messages: [],
      bubbleText: "",
      showBubble: false,
      isLoading: false,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
  });

  afterEach(() => {
    clearTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("本地事件显示临时气泡并按时恢复", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { result } = renderHook(() => useCatbot());

    act(() => {
      result.current.triggerEvent("idle_click");
    });

    expect(result.current.bubbleText).toBe("固定点击反馈");
    expect(result.current.showBubble).toBe(true);
    expect(result.current.expression).toBe("relax");

    act(() => {
      vi.advanceTimersByTime(4500);
    });

    expect(result.current.showBubble).toBe(false);
    expect(result.current.expression).toBe("idle");
  });

  it("系统事件总线经过延迟后进入同一本地反馈流程", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { result } = renderHook(() => useCatbot());

    act(() => {
      mocks.subscribedListener?.("api_error");
      vi.advanceTimersByTime(500);
    });

    expect(result.current.bubbleText).toBe("固定错误反馈");
    expect(result.current.showBubble).toBe(true);
  });

  it("云端成功回复写入对话，并将额度耗尽回复锁定为睡眠表情", async () => {
    mocks.sendCatbotRequest.mockResolvedValue({
      reply: "今天次数已经用光光了",
      expression: "relax",
    });
    const { result } = renderHook(() => useCatbot());

    await act(async () => {
      await result.current.sendMessage("测试问题");
    });

    expect(mocks.sendCatbotRequest).toHaveBeenCalledWith(
      "测试问题",
      expect.arrayContaining([expect.objectContaining({ role: "user", content: "测试问题" })]),
      expect.objectContaining({
        deviceId: "device-test",
        userName: "测试用户",
        activeSessionMessages: 1,
      }),
    );
    expect(result.current.messages.at(-1)?.content).toBe("今天次数已经用光光了");
    expect(result.current.expression).toBe("sleep");
    expect(result.current.isLoading).toBe(false);
  });

  it("云端失败时使用本地离线反馈并恢复可操作状态", async () => {
    mocks.sendCatbotRequest.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useCatbot());

    await act(async () => {
      await result.current.sendMessage("离线问题");
    });

    expect(result.current.messages.at(-1)?.content).toBe("固定离线反馈");
    expect(result.current.expression).toBe("sleepy");
    expect(result.current.isLoading).toBe(false);
  });

  it("清空历史和重置表情保持统一全局状态", () => {
    updateGlobalState({
      expression: "sleep",
      messages: [
        { id: "old", role: "user", content: "旧消息", timestamp: 1 },
      ],
      showBubble: true,
    });
    const { result } = renderHook(() => useCatbot());

    act(() => {
      result.current.clearChatHistory();
      result.current.resetExpression();
    });

    expect(globalState.messages).toHaveLength(1);
    expect(globalState.messages[0].content).toBe("固定欢迎语");
    expect(result.current.expression).toBe("idle");
    expect(result.current.showBubble).toBe(false);
  });
});
