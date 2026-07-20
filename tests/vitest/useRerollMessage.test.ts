/**
 * useRerollMessage 重发事务并发回归测试。
 *
 * 覆盖场景：长会话重发进入旧分支持久化阶段时，流式占位消息尚未创建，
 * 用户再次触发重发。第二次调用必须被同步事务锁拒绝，不能生成第二轮回复。
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { useRerollMessage } from "../../src/hooks/useChat/useRerollMessage";
import type { ChatSession, CharacterCard, UserSettings } from "../../src/types";

function createLongSession(): ChatSession {
  const messages = Array.from({ length: 10 }, (_, turn) => [
    {
      id: `user-${turn}`,
      sender: "user" as const,
      content: `用户消息 ${turn}`,
      timestamp: turn * 2,
    },
    {
      id: `assistant-${turn}`,
      sender: "assistant" as const,
      content: `助手回复 ${turn}`,
      timestamp: turn * 2 + 1,
    },
  ]).flat();

  return {
    id: "session-long-reroll",
    characterId: "character-1",
    title: "长会话重发测试",
    messages,
    summaries: [],
    createdAt: 1,
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
      setSessions: vi.fn(),
      setIsSending: vi.fn(),
      setReplySuggestions: vi.fn(),
      publishRecalledMemories: vi.fn(),
      triggerScroll: vi.fn(),
      databaseService: {},
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
    expect(recall).toHaveBeenCalledTimes(1);

    rejectRecall?.(new Error("测试结束：中断提示词准备阶段"));
    await act(async () => {
      await Promise.all([firstReroll, secondReroll]);
    });

    expect(recall).toHaveBeenCalledTimes(1);
    expect(isSendingRef.current).toBe(false);
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });
});
