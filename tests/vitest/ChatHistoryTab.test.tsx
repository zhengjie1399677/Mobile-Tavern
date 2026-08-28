import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChatHistoryTab from "../../src/tabs/ChatHistoryTab";

const appState = vi.hoisted(() => ({
  characters: [{ id: "character-1", name: "冷启动角色" }],
  sessions: [{
    id: "session-1",
    characterId: "character-1",
    title: "旧旅程",
    createdAt: 1_000,
    messages: [],
    summaries: [],
    turnCount: 12,
    charCount: 3_456,
  }],
  activeSessionId: "session-1",
  setActiveCharId: vi.fn(),
  setActiveSessionId: vi.fn(),
  setActiveTab: vi.fn(),
  setChatSubTab: vi.fn(),
  deleteBranch: vi.fn(),
  updateSessionMetadata: vi.fn().mockResolvedValue(undefined),
  showCustomPrompt: vi.fn().mockResolvedValue("新的会话名称"),
  totalSessionCount: 51,
  loadMoreSessions: vi.fn().mockResolvedValue(undefined),
  hasMoreSessions: true,
  isLoadingMoreSessions: false,
  triggerScroll: vi.fn(),
}));

vi.mock("../../src/UnifiedAppContext", () => ({
  useUnifiedApp: (selector: (state: typeof appState) => unknown) => selector(appState),
}));

vi.mock("../../src/contexts/LanguageContext", () => ({
  useTranslation: () => ({
    t: (key: string, variables?: Record<string, string | number>) => {
      if (key === "history.turns_chars") {
        return `${variables?.turnCount} 回合 · ${variables?.charCount} 字`;
      }
      if (key === "history.loaded_sessions") {
        return `已加载 ${variables?.loaded} / ${variables?.total}`;
      }
      return key;
    },
  }),
}));

describe("历史记录页", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("mobile_tavern_history_view_mode", "timeline");
    appState.hasMoreSessions = true;
    appState.isLoadingMoreSessions = false;
  });

  it("冷启动消息尚未水合时显示 sessions Store 的持久化统计", () => {
    render(<ChatHistoryTab />);

    expect(screen.getByText("旧旅程")).toBeInTheDocument();
    expect(screen.getByText(/12 回合 · 3\.5k 字/)).toBeInTheDocument();
  });

  it("有更早会话时可通过明确按钮继续加载", () => {
    render(<ChatHistoryTab />);

    expect(screen.getByText("已加载 1 / 51")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "history.load_more" }));

    expect(appState.loadMoreSessions).toHaveBeenCalledTimes(1);
  });

  it("加载期间禁用分页按钮并显示进度", () => {
    appState.isLoadingMoreSessions = true;

    render(<ChatHistoryTab />);

    expect(screen.getByRole("button", { name: "history.loading_more" })).toBeDisabled();
  });

  it("支持搜索会话并显示无结果状态", () => {
    render(<ChatHistoryTab />);

    fireEvent.change(screen.getByRole("searchbox", { name: "history.search_placeholder" }), {
      target: { value: "不存在" },
    });

    expect(screen.queryByText("旧旅程")).not.toBeInTheDocument();
    expect(screen.getByText("history.search_empty")).toBeInTheDocument();
  });

  it("更多操作中可以重命名会话", async () => {
    render(<ChatHistoryTab />);

    fireEvent.click(screen.getByRole("button", { name: /history.more_actions/ }));
    fireEvent.click(screen.getByRole("button", { name: "history.rename" }));

    await waitFor(() => {
      expect(appState.updateSessionMetadata).toHaveBeenCalledWith("session-1", {
        title: "新的会话名称",
      });
    });
  });
});
