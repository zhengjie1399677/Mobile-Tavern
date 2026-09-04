import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import PersonaConfigSection from "../../src/tabs/settings/PersonaConfigSection";
import type { UserSettings } from "../../src/types";

describe("PersonaConfigSection", () => {
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

  it("正确渲染人设列表、当前生效状态及脚手架模版", () => {
    const updateSettings = vi.fn();
    const switchUserPersona = vi.fn();

    render(
      <LanguageProvider>
        <PersonaConfigSection
          settings={mockSettings}
          updateSettings={updateSettings}
          switchUserPersona={switchUserPersona}
          addUserPersona={vi.fn()}
          deleteUserPersona={vi.fn()}
          showCustomAlert={vi.fn()}
        />
      </LanguageProvider>
    );

    // 检查标题与卡片
    expect(screen.getByText("我的玩家人设")).toBeInTheDocument();
    expect(screen.getByText("当前生效")).toBeInTheDocument();
    expect(screen.getByText("编辑人设：探险家")).toBeInTheDocument();

    // 检查快捷模版按钮
    const bioButton = screen.getByText("身份背景");
    expect(bioButton).toBeInTheDocument();
    fireEvent.click(bioButton);

    expect(updateSettings).toHaveBeenCalled();
  });
});
