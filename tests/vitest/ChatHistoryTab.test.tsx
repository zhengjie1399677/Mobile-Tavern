import React from "react";
import { render, screen } from "@testing-library/react";
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
  setActiveCharId: vi.fn(),
  setActiveSessionId: vi.fn(),
  setActiveTab: vi.fn(),
  setChatSubTab: vi.fn(),
  deleteBranch: vi.fn(),
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
      return key;
    },
  }),
}));

describe("历史记录页", () => {
  beforeEach(() => {
    localStorage.setItem("mobile_tavern_history_view_mode", "timeline");
  });

  it("冷启动消息尚未水合时显示 sessions Store 的持久化统计", () => {
    render(<ChatHistoryTab />);

    expect(screen.getByText("旧旅程")).toBeInTheDocument();
    expect(screen.getByText(/12 回合 · 3\.5k 字/)).toBeInTheDocument();
  });
});
