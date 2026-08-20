import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CharactersTab from "../../src/tabs/CharactersTab";

vi.mock("../../src/UnifiedAppContext", () => ({
  useUnifiedApp: (selector: (state: Record<string, unknown>) => unknown) => selector({
    characters: [{
      id: "character-1",
      name: "冷启动角色",
      description: "用于验证首页统计",
    }],
    sessionCountsByCharacter: { "character-1": 7 },
    totalSessionCount: 7,
    areSessionCountsReady: true,
    activeCharId: null,
    showCustomConfirm: vi.fn(),
    selectCharacter: vi.fn(),
    handleAddNewCharacter: vi.fn(),
    handleEditCharacter: vi.fn(),
    handleDeleteCharacter: vi.fn(),
    handleImportCardFile: vi.fn(),
    handleExportCharacterJSON: vi.fn(),
    handleExportCharacterPNG: vi.fn(),
    setActiveTab: vi.fn(),
    setActiveWorldbookHostId: vi.fn(),
    loadCharacterById: vi.fn(),
  }),
}));

vi.mock("../../src/contexts/LanguageContext", () => ({
  useTranslation: () => ({
    t: (key: string, variables?: Record<string, string | number>) =>
      key === "characters_tab.branch_count"
        ? `${variables?.count} 分支`
        : key,
  }),
}));

vi.mock("../../src/infrastructure/plugins/builtinPlugins", () => ({
  listBuiltinPluginCards: vi.fn(() => new Promise<never>(() => undefined)),
}));

vi.mock("../../src/components/CharacterDetailDrawer", () => ({ default: () => null }));
vi.mock("../../src/components/LocalCardScanner", () => ({ default: () => null }));

describe("角色首页", () => {
  it("冷启动时使用独立持久化统计展示完整分支数", () => {
    render(<CharactersTab />);

    expect(screen.getByText("冷启动角色")).toBeInTheDocument();
    expect(screen.getByText("7 分支")).toBeInTheDocument();
    expect(screen.getByText("nav.chat-history")).toBeInTheDocument();
  });
});
