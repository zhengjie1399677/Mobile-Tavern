/**
 * useSessionManager Hook 单元测试
 *
 * 覆盖新建会话、角色切换、创建/删除分支、回溯分支、空会话自动清理
 * 使用 renderHook + Mock 依赖验证关键业务路径
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSessionManager } from "../../src/hooks/useChat/useSessionManager";
import type { ChatSession, CharacterCard, UserSettings, Message, SummaryCard } from "../../src/types";
import type { IDatabaseService, ITelemetryService } from "../../src/kernel/types";

// 测试专用：IDatabaseService 的 Mock 变体，暴露 vi.fn() 的 .mock 属性用于断言调用参数
type MockDatabaseService = IDatabaseService & {
  createNewSession: Mock;
};

// ─── 测试夹具工厂 ──────────────────────────────────────────────────────────────
function createMockCharacter(overrides?: Partial<CharacterCard>): CharacterCard {
  return {
    id: "char-1",
    name: "测试角色",
    avatar: "",
    first_mes: "你好，旅行者！",
    description: "",
    personality: "",
    ...overrides,
  } as unknown as CharacterCard;
}

function createMockSession(overrides?: Partial<ChatSession>): ChatSession {
  return {
    id: "session-1",
    characterId: "char-1",
    title: "测试会话",
    messages: [
      { id: "msg-1", sender: "user", content: "你好", timestamp: 1000 } as Message,
      { id: "msg-2", sender: "assistant", content: "你好！", timestamp: 2000 } as Message,
    ],
    createdAt: 1000,
    turnCount: 1,
    ...overrides,
  } as unknown as ChatSession;
}

function createMockParams(overrides?: Partial<any>) {
  const setSessions = vi.fn();
  const setActiveCharId = vi.fn();
  const setActiveSessionId = vi.fn();
  const setActiveTab = vi.fn();
  const setChatSubTab = vi.fn();
  const setShowSessionManager = vi.fn();
  const setMsgMenuId = vi.fn();
  const deleteSession = vi.fn().mockResolvedValue(undefined);
  const triggerScroll = vi.fn();
  const showCustomAlert = vi.fn().mockResolvedValue(undefined);
  const showCustomConfirm = vi.fn().mockResolvedValue(true);
  const showCustomPrompt = vi.fn().mockResolvedValue("新分支");

  const character = createMockCharacter();
  const session = createMockSession();

  return {
    isSending: false,
    isSendingRef: { current: false },
    activeCharId: "char-1",
    activeCharacter: character,
    activeSession: session,
    activeSessionId: "session-1",
    sessions: [session],
    characters: [character],
    settings: { enableReplySuggestions: false } as unknown as UserSettings,
    setSessions,
    setActiveCharId,
    setActiveSessionId,
    setActiveTab,
    setChatSubTab,
    setShowSessionManager,
    setMsgMenuId,
    deleteSession,
    databaseService: {
      createNewSession: vi.fn().mockResolvedValue(createMockSession({ id: "new-session" })),
      createEmptyBranch: vi.fn().mockResolvedValue(createMockSession({ id: "branch-session" })),
      createBacktrackBranch: vi.fn().mockResolvedValue(createMockSession({ id: "backtrack-session" })),
      createBacktrackFromTimeline: vi.fn().mockResolvedValue(createMockSession({ id: "timeline-session" })),
    } as unknown as MockDatabaseService,
    telemetryService: {
      reportUsage: vi.fn(),
    } as unknown as ITelemetryService,
    triggerScroll,
    showCustomAlert,
    showCustomConfirm,
    showCustomPrompt,
    ...overrides,
  };
}

describe("useSessionManager", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("handleStartNewSession", () => {
    it("无活跃角色时不执行", async () => {
      const params = createMockParams({ activeCharacter: null });
      const { result } = renderHook(() => useSessionManager(params));
      await act(async () => {
        await result.current.handleStartNewSession();
      });
      expect(params.setSessions).not.toHaveBeenCalled();
    });

    it("正常创建新会话", async () => {
      const params = createMockParams();
      const { result } = renderHook(() => useSessionManager(params));
      await act(async () => {
        await result.current.handleStartNewSession();
      });
      expect(params.databaseService.createNewSession).toHaveBeenCalled();
      expect(params.setSessions).toHaveBeenCalled();
      expect(params.setActiveSessionId).toHaveBeenCalledWith("new-session");
      expect(params.triggerScroll).toHaveBeenCalled();
    });

    it("使用自定义首条消息", async () => {
      const params = createMockParams();
      const { result } = renderHook(() => useSessionManager(params));
      await act(async () => {
        await result.current.handleStartNewSession("自定义开场白");
      });
      expect(params.databaseService.createNewSession).toHaveBeenCalledWith(
        params.activeCharacter,
        "自定义开场白",
        undefined
      );
    });

    it("启用回复建议时附加默认 suggestions", async () => {
      const params = createMockParams({
        settings: { enableReplySuggestions: true } as unknown as UserSettings,
      });
      const { result } = renderHook(() => useSessionManager(params));
      await act(async () => {
        await result.current.handleStartNewSession();
      });
      const callArgs = params.databaseService.createNewSession.mock.calls[0];
      expect(callArgs[1]).toContain("<suggestions>");
      expect(callArgs[2]).toEqual(["继续对话", "打个招呼", "静观其变", "进行互动"]);
    });

    it("首条消息已含 suggestions 标签时不重复附加", async () => {
      const params = createMockParams({
        settings: { enableReplySuggestions: true } as unknown as UserSettings,
        activeCharacter: createMockCharacter({ first_mes: '你好<suggestions>["嗨"]</suggestions>' }),
      });
      const { result } = renderHook(() => useSessionManager(params));
      await act(async () => {
        await result.current.handleStartNewSession();
      });
      const callArgs = params.databaseService.createNewSession.mock.calls[0];
      // 不应附加默认 suggestions
      expect(callArgs[1]).not.toContain("继续对话");
    });

    it("createNewSession 抛错时不崩溃", async () => {
      const params = createMockParams();
      params.databaseService.createNewSession = vi.fn().mockRejectedValue(new Error("DB error"));
      const { result } = renderHook(() => useSessionManager(params));
      await act(async () => {
        await result.current.handleStartNewSession();
      });
      // 不应崩溃，setSessions 不应被调用
      expect(params.setSessions).not.toHaveBeenCalled();
    });
  });

  describe("selectCharacter", () => {
    it("正在发送时拒绝切换并提示", async () => {
      const params = createMockParams({ isSending: true });
      const { result } = renderHook(() => useSessionManager(params));
      await act(async () => {
        await result.current.selectCharacter("char-2");
      });
      expect(params.showCustomAlert).toHaveBeenCalled();
      expect(params.setActiveCharId).not.toHaveBeenCalled();
    });

    it("角色有历史会话时切换到最近会话", async () => {
      const oldSession = createMockSession({
        id: "old-session",
        messages: [{ id: "m1", sender: "user", content: "hi", timestamp: 100 } as Message],
        createdAt: 100,
      });
      const params = createMockParams({
        sessions: [oldSession, createMockSession()],
      });
      const { result } = renderHook(() => useSessionManager(params));
      await act(async () => {
        await result.current.selectCharacter("char-1");
      });
      expect(params.setActiveCharId).toHaveBeenCalledWith("char-1");
      // 应切换到最近活跃的会话
      expect(params.setActiveSessionId).toHaveBeenCalled();
      expect(params.setActiveTab).toHaveBeenCalledWith("chat");
    });

    it("角色无历史会话时创建新会话", async () => {
      const newChar = createMockCharacter({ id: "char-2", name: "新角色" });
      const params = createMockParams({
        characters: [createMockCharacter(), newChar],
        sessions: [createMockSession()],
      });
      const { result } = renderHook(() => useSessionManager(params));
      await act(async () => {
        await result.current.selectCharacter("char-2");
      });
      expect(params.databaseService.createNewSession).toHaveBeenCalled();
      expect(params.setSessions).toHaveBeenCalled();
    });

    it("切换后上报遥测", async () => {
      const params = createMockParams();
      const { result } = renderHook(() => useSessionManager(params));
      await act(async () => {
        await result.current.selectCharacter("char-1");
      });
      expect(params.telemetryService.reportUsage).toHaveBeenCalledWith(
        "performance_chat_load",
        expect.objectContaining({ detail: "Chat session load completed" })
      );
    });
  });

  describe("createNewBranch", () => {
    it("无活跃角色时不执行", async () => {
      const params = createMockParams({ activeCharId: null });
      const { result } = renderHook(() => useSessionManager(params));
      await act(async () => {
        await result.current.createNewBranch();
      });
      expect(params.databaseService.createEmptyBranch).not.toHaveBeenCalled();
    });

    it("正在发送时拒绝并提示", async () => {
      const params = createMockParams({ isSending: true });
      const { result } = renderHook(() => useSessionManager(params));
      await act(async () => {
        await result.current.createNewBranch();
      });
      expect(params.showCustomAlert).toHaveBeenCalled();
    });

    it("用户取消输入分支名时不创建", async () => {
      const params = createMockParams({
        showCustomPrompt: vi.fn().mockResolvedValue(null),
      });
      const { result } = renderHook(() => useSessionManager(params));
      await act(async () => {
        await result.current.createNewBranch();
      });
      expect(params.databaseService.createEmptyBranch).not.toHaveBeenCalled();
    });

    it("正常创建新分支", async () => {
      const params = createMockParams();
      const { result } = renderHook(() => useSessionManager(params));
      await act(async () => {
        await result.current.createNewBranch();
      });
      expect(params.databaseService.createEmptyBranch).toHaveBeenCalled();
      expect(params.setSessions).toHaveBeenCalled();
      expect(params.setActiveSessionId).toHaveBeenCalledWith("branch-session");
      expect(params.setShowSessionManager).toHaveBeenCalledWith(false);
    });
  });

  describe("deleteBranch", () => {
    it("正在发送时拒绝删除", async () => {
      const params = createMockParams({ isSending: true });
      const { result } = renderHook(() => useSessionManager(params));
      await act(async () => {
        await result.current.deleteBranch("session-1");
      });
      expect(params.showCustomAlert).toHaveBeenCalled();
      expect(params.deleteSession).not.toHaveBeenCalled();
    });

    it("用户取消确认时不删除", async () => {
      const params = createMockParams({
        showCustomConfirm: vi.fn().mockResolvedValue(false),
      });
      const { result } = renderHook(() => useSessionManager(params));
      await act(async () => {
        await result.current.deleteBranch("session-1");
      });
      expect(params.deleteSession).not.toHaveBeenCalled();
    });

    it("正常删除分支", async () => {
      const params = createMockParams();
      const { result } = renderHook(() => useSessionManager(params));
      await act(async () => {
        await result.current.deleteBranch("session-to-delete");
      });
      expect(params.deleteSession).toHaveBeenCalledWith("session-to-delete");
      expect(params.setSessions).toHaveBeenCalled();
    });

    it("删除活跃会话时切换到其他会话", async () => {
      const session1 = createMockSession({ id: "s1", messages: [{ id: "m1", sender: "user", content: "hi", timestamp: 2000 } as Message] });
      const session2 = createMockSession({ id: "s2", messages: [{ id: "m2", sender: "user", content: "hi", timestamp: 1000 } as Message] });
      const params = createMockParams({
        activeSessionId: "s1",
        sessions: [session1, session2],
      });
      const { result } = renderHook(() => useSessionManager(params));
      await act(async () => {
        await result.current.deleteBranch("s1");
      });
      // 应切换到 s2
      expect(params.setActiveSessionId).toHaveBeenCalledWith("s2");
    });
  });

  describe("createBacktrackBranch", () => {
    it("无活跃角色或会话时不执行", async () => {
      const params = createMockParams({ activeCharacter: null });
      const { result } = renderHook(() => useSessionManager(params));
      await act(async () => {
        await result.current.createBacktrackBranch({ id: "msg-1" } as Message);
      });
      expect(params.databaseService.createBacktrackBranch).not.toHaveBeenCalled();
    });

    it("正在发送时拒绝", async () => {
      const params = createMockParams({ isSending: true });
      const { result } = renderHook(() => useSessionManager(params));
      await act(async () => {
        await result.current.createBacktrackBranch({ id: "msg-1" } as Message);
      });
      expect(params.showCustomAlert).toHaveBeenCalled();
    });

    it("正常创建回溯分支", async () => {
      const params = createMockParams();
      const { result } = renderHook(() => useSessionManager(params));
      const msg = { id: "msg-1" } as Message;
      await act(async () => {
        await result.current.createBacktrackBranch(msg);
      });
      expect(params.databaseService.createBacktrackBranch).toHaveBeenCalledWith(
        params.activeSession,
        "新分支",
        "msg-1"
      );
      expect(params.setActiveSessionId).toHaveBeenCalledWith("backtrack-session");
      expect(params.setMsgMenuId).toHaveBeenCalledWith(null);
      expect(params.setChatSubTab).toHaveBeenCalledWith("dialogue");
      expect(params.showCustomAlert).toHaveBeenCalled();
    });

    it("用户取消分支名输入时不创建", async () => {
      const params = createMockParams({
        showCustomPrompt: vi.fn().mockResolvedValue(null),
      });
      const { result } = renderHook(() => useSessionManager(params));
      await act(async () => {
        await result.current.createBacktrackBranch({ id: "msg-1" } as Message);
      });
      expect(params.databaseService.createBacktrackBranch).not.toHaveBeenCalled();
    });
  });

  describe("createBacktrackFromTimeline", () => {
    it("无活跃角色或会话时不执行", async () => {
      const params = createMockParams({ activeSession: null });
      const { result } = renderHook(() => useSessionManager(params));
      await act(async () => {
        await result.current.createBacktrackFromTimeline({ id: "summary-1", timeTag: "第一幕" } as unknown as SummaryCard);
      });
      expect(params.databaseService.createBacktrackFromTimeline).not.toHaveBeenCalled();
    });

    it("正常创建时间线分支", async () => {
      const params = createMockParams();
      const { result } = renderHook(() => useSessionManager(params));
      const summary = { id: "summary-1", timeTag: "第一幕" } as unknown as SummaryCard;
      await act(async () => {
        await result.current.createBacktrackFromTimeline(summary);
      });
      expect(params.databaseService.createBacktrackFromTimeline).toHaveBeenCalledWith(
        params.activeSession,
        "新分支",
        "summary-1"
      );
      expect(params.setActiveSessionId).toHaveBeenCalledWith("timeline-session");
      expect(params.setChatSubTab).toHaveBeenCalledWith("dialogue");
    });
  });
});
