import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import UserPersonaModal from "../../src/components/UserPersonaModal";
import type { UserSettings } from "../../src/types";

const renderWithLang = (ui: React.ReactElement) => (
  render(<LanguageProvider>{ui}</LanguageProvider>)
);

describe("UserPersonaModal", () => {
  const mockSettings: UserSettings = {
    userName: "探险家",
    userAvatar: "",
    userInfo: "一名经验丰富的探险家",
    activePersonaId: "persona-1",
    userPersonas: [
      { id: "persona-1", name: "探险家", description: "一名经验丰富的探险家", avatar: "" },
      { id: "persona-2", name: "侦探", description: "冷酷的私家侦探", avatar: "" },
    ],
  } as unknown as UserSettings;

  it("renders persona list and shows active persona badge", () => {
    renderWithLang(
      <UserPersonaModal
        isOpen={true}
        onClose={vi.fn()}
        settings={mockSettings}
        updateSettings={vi.fn()}
        switchUserPersona={vi.fn()}
        showCustomConfirm={vi.fn().mockResolvedValue(true)}
        showCustomAlert={vi.fn()}
        hasActiveConversation={false}
      />
    );

    expect(screen.getByText("玩家人设管理")).toBeInTheDocument();
    expect(screen.getByText("探险家")).toBeInTheDocument();
    expect(screen.getByText("侦探")).toBeInTheDocument();
    expect(screen.getByText("当前使用")).toBeInTheDocument();
  });

  it("warns and prompts confirmation when switching persona mid-conversation", async () => {
    const showConfirm = vi.fn().mockResolvedValue(true);
    const switchPersona = vi.fn();

    renderWithLang(
      <UserPersonaModal
        isOpen={true}
        onClose={vi.fn()}
        settings={mockSettings}
        updateSettings={vi.fn()}
        switchUserPersona={switchPersona}
        showCustomConfirm={showConfirm}
        showCustomAlert={vi.fn()}
        hasActiveConversation={true}
      />
    );

    const useButtons = screen.getAllByRole("button", { name: "使用" });
    fireEvent.click(useButtons[0]);

    await waitFor(() => {
      expect(showConfirm).toHaveBeenCalled();
      expect(switchPersona).toHaveBeenCalledWith("persona-2");
    });
  });

  it("does not switch persona if user cancels mid-conversation warning", async () => {
    const showConfirm = vi.fn().mockResolvedValue(false);
    const switchPersona = vi.fn();

    renderWithLang(
      <UserPersonaModal
        isOpen={true}
        onClose={vi.fn()}
        settings={mockSettings}
        updateSettings={vi.fn()}
        switchUserPersona={switchPersona}
        showCustomConfirm={showConfirm}
        showCustomAlert={vi.fn()}
        hasActiveConversation={true}
      />
    );

    const useButtons = screen.getAllByRole("button", { name: "使用" });
    fireEvent.click(useButtons[0]);

    await waitFor(() => {
      expect(showConfirm).toHaveBeenCalled();
      expect(switchPersona).not.toHaveBeenCalled();
    });
  });

  it("can open create persona form and fill name and description", () => {
    renderWithLang(
      <UserPersonaModal
        isOpen={true}
        onClose={vi.fn()}
        settings={mockSettings}
        updateSettings={vi.fn()}
        switchUserPersona={vi.fn()}
        showCustomConfirm={vi.fn().mockResolvedValue(true)}
        showCustomAlert={vi.fn()}
        hasActiveConversation={false}
      />
    );

    fireEvent.click(screen.getByText("新建人设"));
    expect(screen.getByText("新建玩家人设")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/例如：旅人、指挥官、侦探/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/描述你在世界观中的背景身份/)).toBeInTheDocument();
  });
});
