import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChatHistoryTab from "../../src/tabs/ChatHistoryTab";

const fixture = vi.hoisted(() => {
  const session = {
    id: "session-1",
    characterId: "character-1",
    title: "旧旅程",
    createdAt: 1_000,
    updatedAt: Date.now(),
    lifecycle: "active" as const,
    contentRevision: 1,
    messages: [],
    summaries: [],
    turnCount: 12,
    charCount: 3_456,
    lastMessagePreview: "仍在旅途中",
  };
  const entry = {
    session,
    characterName: "冷启动角色",
    branchCount: 0,
  };
  const service = {
    queryDirectory: vi.fn(async (query?: { search?: string }) => ({
      active: query?.search && !`${session.title} 冷启动角色`.includes(query.search) ? [] : [entry],
      favorites: [],
      archived: [],
      pageInfo: {
        active: { hasMore: false },
        favorite: { hasMore: false },
        archived: { hasMore: false },
      },
      characters: [{ id: "character-1", name: "冷启动角色" }],
    })),
    archiveSession: vi.fn().mockResolvedValue(undefined),
    restoreSession: vi.fn().mockResolvedValue(undefined),
    favoriteSession: vi.fn().mockResolvedValue(undefined),
    updateFavoriteBackup: vi.fn().mockResolvedValue(undefined),
    removeFavoriteBackup: vi.fn().mockResolvedValue(undefined),
    restoreFavoriteBackup: vi.fn().mockResolvedValue(session),
    permanentlyDeleteArchivedSession: vi.fn().mockResolvedValue(undefined),
  };
  return { session, entry, service };
});

const appState = vi.hoisted(() => ({
  activeSessionId: "session-1",
  isSending: false,
  setActiveCharId: vi.fn(),
  setActiveSessionId: vi.fn(),
  setActiveTab: vi.fn(),
  setChatSubTab: vi.fn(),
  setShowSessionManager: vi.fn(),
  updateSessionMetadata: vi.fn().mockResolvedValue(undefined),
  loadSessions: vi.fn().mockResolvedValue(undefined),
  showCustomPrompt: vi.fn().mockResolvedValue("新的会话名称"),
  showCustomConfirm: vi.fn().mockResolvedValue(true),
  showCustomAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/UnifiedAppContext", () => ({
  useUnifiedApp: (selector: (state: typeof appState) => unknown) => selector(appState),
}));

vi.mock("../../src/contexts/KernelContext", () => ({
  useKernel: () => ({ getService: () => fixture.service }),
}));

vi.mock("../../src/contexts/LanguageContext", () => ({
  useTranslation: () => ({
    t: (key: string, variables?: Record<string, string | number>) => {
      if (key === "history.turns") return `${variables?.count} 回合`;
      if (key === "session_manager.result_count") return `${variables?.count} 个结果`;
      return key;
    },
  }),
}));

describe("会话管理器页面", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appState.isSending = false;
    fixture.service.queryDirectory.mockImplementation(async (query?: { search?: string }) => ({
      active: query?.search && !`${fixture.session.title} 冷启动角色`.includes(query.search) ? [] : [fixture.entry],
      favorites: [],
      archived: [],
      pageInfo: {
        active: { hasMore: false },
        favorite: { hasMore: false },
        archived: { hasMore: false },
      },
      characters: [{ id: "character-1", name: "冷启动角色" }],
    }));
  });

  it("展示权威目录投影和三个固定分类", async () => {
    render(<ChatHistoryTab />);

    expect(await screen.findByText("旧旅程")).toBeInTheDocument();
    expect(screen.getByText("仍在旅途中")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "session_manager.category_active" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "session_manager.category_favorite" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "session_manager.category_archived" })).toBeInTheDocument();
  });

  it("搜索只查询会话名称和角色名称，不冒充消息全文搜索", async () => {
    render(<ChatHistoryTab />);
    await screen.findByText("旧旅程");
    fireEvent.click(screen.getByRole("button", { name: /session_manager.search/ }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "不存在" } });

    await waitFor(() => expect(fixture.service.queryDirectory).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "不存在" }),
    ));
    expect(await screen.findByText("session_manager.empty_active")).toBeInTheDocument();
  });

  it("高级筛选将时间、分支和备份状态交给权威目录查询", async () => {
    render(<ChatHistoryTab />);
    await screen.findByText("旧旅程");
    fireEvent.click(screen.getByRole("button", { name: "session_manager.filters" }));
    fireEvent.change(screen.getByLabelText("session_manager.filter_created"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("session_manager.filter_branch"), { target: { value: "yes" } });
    fireEvent.change(screen.getByLabelText("session_manager.filter_backup"), { target: { value: "outdated" } });

    await waitFor(() => expect(fixture.service.queryDirectory).toHaveBeenLastCalledWith(
      expect.objectContaining({
        createdAfter: expect.any(Number),
        hasBranch: true,
        backupStatus: "outdated",
      }),
    ));
  });

  it("未归档会话只提供归档，不提供永久删除", async () => {
    render(<ChatHistoryTab />);
    await screen.findByText("旧旅程");
    fireEvent.click(screen.getByRole("button", { name: /history.more_actions/ }));

    expect(screen.getByRole("button", { name: "session_manager.archive" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "session_manager.delete_permanent" })).not.toBeInTheDocument();
  });

  it("更多操作中可以重命名会话", async () => {
    render(<ChatHistoryTab />);
    await screen.findByText("旧旅程");
    fireEvent.click(screen.getByRole("button", { name: /history.more_actions/ }));
    fireEvent.click(screen.getByRole("button", { name: "history.rename" }));

    await waitFor(() => expect(appState.updateSessionMetadata).toHaveBeenCalledWith("session-1", {
      title: "新的会话名称",
    }));
  });

  it("生成中从历史页打开会话会被统一守卫拦截", async () => {
    appState.isSending = true;
    render(<ChatHistoryTab />);

    const title = await screen.findByText("旧旅程");
    const openButton = title.closest("button");
    expect(openButton).not.toBeNull();
    fireEvent.click(openButton as HTMLButtonElement);

    await waitFor(() => expect(appState.showCustomAlert).toHaveBeenCalled());
    expect(appState.setActiveSessionId).not.toHaveBeenCalled();
    expect(appState.setActiveCharId).not.toHaveBeenCalled();
  });
});
