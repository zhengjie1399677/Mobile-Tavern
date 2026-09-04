import { useEffect, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PromptsConfigSection from "../../src/components/presetForm/PromptsConfigSection";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import type { UserSettings } from "../../src/types";

function Harness({
  initial,
  onToggleCustomPrompt,
  onUpdateCustomPrompt,
  onAddNewCustomPrompt,
  onDeleteCustomPrompt,
}: {
  initial: UserSettings;
  onToggleCustomPrompt?: (id: string, enabled: boolean) => void;
  onUpdateCustomPrompt?: (id: string, name: string, role: any, content: string) => void;
  onAddNewCustomPrompt?: () => void;
  onDeleteCustomPrompt?: (id: string) => Promise<void>;
}) {
  const [settings, setSettings] = useState<UserSettings>(initial);
  const updateSettings = (next: UserSettings | ((prev: UserSettings) => UserSettings)) => {
    setSettings((prev) => (typeof next === "function" ? next(prev) : next));
  };
  return (
    <LanguageProvider>
      <PromptsConfigSection
        settings={settings}
        updateSettings={updateSettings}
        handleToggleCustomPrompt={onToggleCustomPrompt ?? vi.fn()}
        handleUpdateCustomPrompt={onUpdateCustomPrompt ?? vi.fn()}
        handleAddNewCustomPrompt={onAddNewCustomPrompt ?? vi.fn()}
        handleDeleteCustomPrompt={onDeleteCustomPrompt ?? vi.fn(async () => undefined)}
        isPromptsFolded={false}
        handleTogglePromptsFold={vi.fn()}
        coreStatusText="0/4"
        activeCustomPrompts={settings.promptConfig.customPrompts?.length ?? 0}
        selectedPromptIds={[]}
        setSelectedPromptIds={vi.fn()}
        isBatchDeletingPrompts={false}
        setIsBatchDeletingPrompts={vi.fn()}
        handleBatchDeletePrompts={vi.fn(async () => undefined)}
      />
    </LanguageProvider>
  );
}

describe("PromptsConfigSection 所有预设一视同仁统一列表", () => {
  beforeEach(() => {
    localStorage.setItem("mobile_tavern_language", "zh-CN");
  });

  it("统一呈现提示词列表，不设 CORE PROMPTS 或 PROMPT MODULES 分区", () => {
    render(<Harness initial={structuredClone(DEFAULT_SETTINGS)} />);
    expect(screen.queryByText("CORE PROMPTS")).not.toBeInTheDocument();
    expect(screen.queryByText("PROMPT MODULES")).not.toBeInTheDocument();
    expect(screen.getByText(/提示词列表/)).toBeInTheDocument();
    expect(screen.getAllByText(/底层扮演/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/规则提示/).length).toBeGreaterThan(0);
  });

  it("支持新建提示词模组", () => {
    const handleAddNew = vi.fn();
    render(
      <Harness
        initial={structuredClone(DEFAULT_SETTINGS)}
        onAddNewCustomPrompt={handleAddNew}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "新建模组" }));
    expect(handleAddNew).toHaveBeenCalledTimes(1);
  });

  it("所有提示词一视同仁支持开关与删除", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.promptConfig.customPrompts = [
      {
        id: "custom-1",
        name: "第一人称约束",
        role: "system",
        content: "必须使用第一人称进行回答。",
        enabled: true,
      },
    ];

    const handleToggle = vi.fn();
    const handleDelete = vi.fn(async () => undefined);

    render(
      <Harness
        initial={settings}
        onToggleCustomPrompt={handleToggle}
        onDeleteCustomPrompt={handleDelete}
      />,
    );

    expect(screen.getByText("第一人称约束")).toBeInTheDocument();
    const toggleSwitch = screen.getByRole("switch", { name: "启用提示词 第一人称约束" });
    expect(toggleSwitch).toBeChecked();

    fireEvent.click(toggleSwitch);
    expect(handleToggle).toHaveBeenCalledWith("custom-1", false);

    fireEvent.click(screen.getByRole("button", { name: "删除提示词 第一人称约束" }));
    expect(handleDelete).toHaveBeenCalledWith("custom-1");
  });

  it("自由编排模式下，切换系统提示词开关会同步更新 composition.blocks", () => {
    let currentSettings: UserSettings | null = null;
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.promptConfig.usePromptComposition = true;
    settings.promptConfig.useMainPrompt = true;
    settings.promptConfig.mainPrompt = "系统核心指令";
    settings.promptConfig.composition = {
      id: "comp_1",
      name: "测试编排",
      version: 1,
      blocks: [
        {
          id: "built-in-main-prompt",
          name: "底层扮演系统指令",
          enabled: true,
          role: "system",
          source: { type: "template" },
          template: "系统核心指令",
          order: 100,
          placement: { type: "ordered" },
          compatibility: { source: "sillytavern", originalIdentifier: "main" },
        },
      ],
    };

    function CompositionHarness() {
      const [localSettings, setLocalSettings] = useState<UserSettings>(settings);
      useEffect(() => {
        currentSettings = localSettings;
      }, [localSettings]);
      return (
        <LanguageProvider>
          <PromptsConfigSection
            settings={localSettings}
            updateSettings={(next) => setLocalSettings((prev) => (typeof next === "function" ? next(prev) : next))}
            handleToggleCustomPrompt={vi.fn()}
            handleUpdateCustomPrompt={vi.fn()}
            handleAddNewCustomPrompt={vi.fn()}
            handleDeleteCustomPrompt={vi.fn(async () => undefined)}
            isPromptsFolded={false}
            handleTogglePromptsFold={vi.fn()}
            coreStatusText="1/1"
            activeCustomPrompts={0}
            selectedPromptIds={[]}
            setSelectedPromptIds={vi.fn()}
            isBatchDeletingPrompts={false}
            setIsBatchDeletingPrompts={vi.fn()}
            handleBatchDeletePrompts={vi.fn(async () => undefined)}
          />
        </LanguageProvider>
      );
    }

    render(<CompositionHarness />);
    const mainSwitch = screen.getByRole("switch", { name: /启用提示词.*底层扮演/ });
    expect(mainSwitch).toBeChecked();

    fireEvent.click(mainSwitch);

    expect(currentSettings!.promptConfig.useMainPrompt).toBe(false);
    expect(currentSettings!.promptConfig.composition?.blocks[0].enabled).toBe(false);
  });
});
