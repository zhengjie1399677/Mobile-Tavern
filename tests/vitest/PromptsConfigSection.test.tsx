import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PromptsConfigSection from "../../src/components/presetForm/PromptsConfigSection";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import zhCN from "../../src/locales/zh-CN";
import type { UserSettings } from "../../src/types";

function Harness({
  initial,
  onToggleCustomPrompt,
  onUpdateCustomPrompt,
  onAddNewCustomPrompt,
  onDeleteCustomPrompt,
  onDeleteBuiltinPrompt,
  onSettingsChange,
}: {
  initial: UserSettings;
  onToggleCustomPrompt?: (id: string, enabled: boolean) => void;
  onUpdateCustomPrompt?: (id: string, name: string, role: any, content: string) => void;
  onAddNewCustomPrompt?: () => void;
  onDeleteCustomPrompt?: (id: string) => Promise<void>;
  onDeleteBuiltinPrompt?: (kind: "main" | "jailbreak") => Promise<void>;
  onSettingsChange?: (settings: UserSettings) => void;
}) {
  const [settings, setSettings] = useState<UserSettings>(initial);
  const updateSettings = (next: UserSettings | ((prev: UserSettings) => UserSettings)) => {
    setSettings((prev) => (typeof next === "function" ? next(prev) : next));
  };
  useEffect(() => {
    onSettingsChange?.(settings);
  }, [settings, onSettingsChange]);
  // 与生产实现同语义的更新路径：命中条目改名/改角色/改正文，保证受控输入框真的能改。
  const updateCustomPrompt = (
    id: string,
    name: string,
    role: "system" | "user" | "assistant",
    content: string,
  ) => {
    onUpdateCustomPrompt?.(id, name, role, content);
    setSettings((prev) => ({
      ...prev,
      promptConfig: {
        ...prev.promptConfig,
        customPrompts: (prev.promptConfig.customPrompts ?? []).map((item) =>
          (item.id ? item.id === id : Boolean(item.identifier) && item.identifier === id)
            ? { ...item, id: item.id || id, name, role, content }
            : item,
        ),
      },
    }));
  };
  return (
    <LanguageProvider>
      <PromptsConfigSection
        settings={settings}
        updateSettings={updateSettings}
        handleToggleCustomPrompt={onToggleCustomPrompt ?? vi.fn()}
        handleUpdateCustomPrompt={updateCustomPrompt}
        handleAddNewCustomPrompt={onAddNewCustomPrompt ?? vi.fn()}
        handleDeleteCustomPrompt={onDeleteCustomPrompt ?? vi.fn(async () => undefined)}
        handleDeleteBuiltinPrompt={onDeleteBuiltinPrompt ?? vi.fn(async () => undefined)}
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
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.promptConfig.mainPrompt = "系统核心设定";
    settings.promptConfig.useMainPrompt = true;
    render(<Harness initial={settings} />);
    expect(screen.queryByText("CORE PROMPTS")).not.toBeInTheDocument();
    expect(screen.queryByText("PROMPT MODULES")).not.toBeInTheDocument();
    expect(screen.getByText(/提示词列表/)).toBeInTheDocument();
    expect(screen.getAllByText(/系统提示词/).length).toBeGreaterThan(0);
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

  it("自动过滤 marker 为 true 的系统插槽锚点，不作为提示词平铺", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.promptConfig.customPrompts = [
      {
        id: "marker-chat-history",
        name: "chatHistory",
        role: "system",
        content: "",
        enabled: true,
        marker: true,
      },
      {
        id: "normal-custom-1",
        name: "正常模组",
        role: "system",
        content: "这是有效内容",
        enabled: true,
      },
    ];

    render(<Harness initial={settings} />);

    // 正常模组应该显示
    expect(screen.getByText("正常模组")).toBeInTheDocument();
    // marker 锚点绝对不能在提示词列表中作为卡片平铺展示
    expect(screen.queryByText("chatHistory")).not.toBeInTheDocument();
  });

  it("对齐 SillyTavern 交互：同屏完整展示全部模组，未开启项就地保留且支持关键字搜索", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.promptConfig.customPrompts = [
      {
        id: "active-mod",
        name: "激活的文风模组",
        role: "system",
        content: "细腻小说叙事",
        enabled: true,
      },
      {
        id: "inactive-mod",
        name: "备用的视角模组",
        role: "user",
        content: "第二人称代入",
        enabled: false,
      },
    ];

    render(<Harness initial={settings} />);

    // 对齐 SillyTavern：默认同屏完整展示全部模组，未开启模组就地展示且不隐藏
    expect(screen.getByText("激活的文风模组")).toBeInTheDocument();
    expect(screen.getByText("备用的视角模组")).toBeInTheDocument();

    // 搜索框实时过滤
    const searchInput = screen.getByPlaceholderText(/搜索提示词/);
    fireEvent.change(searchInput, { target: { value: "第二人称" } });
    expect(screen.getByText("备用的视角模组")).toBeInTheDocument();
    expect(screen.queryByText("激活的文风模组")).not.toBeInTheDocument();

    // 清空搜索框后恢复全量平铺
    fireEvent.change(searchInput, { target: { value: "" } });
    expect(screen.getByText("激活的文风模组")).toBeInTheDocument();
    expect(screen.getByText("备用的视角模组")).toBeInTheDocument();
  });

  it("当 customPrompts 中含有同源 main/jailbreak 时，不重复平铺双重卡片", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.promptConfig.mainPrompt = "系统核心设定";
    settings.promptConfig.customPrompts = [
      {
        id: "st_main",
        identifier: "main",
        name: "Main Prompt",
        role: "system",
        content: "系统核心设定",
        enabled: true,
      },
      {
        id: "st_custom",
        identifier: "writing_style",
        name: "文风规范",
        role: "system",
        content: "言简意赅",
        enabled: true,
      },
    ];

    render(<Harness initial={settings} />);
    // 应该只展示一个系统提示词卡片和一个自定义模组卡片，不出现重复的 Main Prompt
    expect(screen.getAllByText(/系统提示词/).length).toBeGreaterThan(0);
    expect(screen.getByText("文风规范")).toBeInTheDocument();
    expect(screen.queryByText("Main Prompt")).not.toBeInTheDocument();
  });

  it("改名内置「系统提示词」就地保存，不平转成新模组且输入框保持原位", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.promptConfig.mainPrompt = "系统核心设定";
    settings.promptConfig.useMainPrompt = true;
    settings.promptConfig.customPrompts = [];

    let latest: UserSettings = settings;
    render(
      <Harness
        initial={settings}
        onSettingsChange={(next) => {
          latest = next;
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /展开或折叠 .*系统提示词/ }));
    fireEvent.change(screen.getByPlaceholderText("提示词名称"), {
      target: { value: "人格核心" },
    });

    // 名字落在顶层显示名上，正文与开关不动，也不会平转出新的自定义模组。
    expect(latest.promptConfig.mainPromptName).toBe("人格核心");
    expect(latest.promptConfig.mainPrompt).toBe("系统核心设定");
    expect(latest.promptConfig.customPrompts).toEqual([]);
    // 输入框仍在（未被卸载），可以继续把名字敲完。
    expect(screen.getByDisplayValue("人格核心")).toBeInTheDocument();
  });

  it("把内置显示名改回默认文案时不落库，保证仍跟随界面语言", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.promptConfig.mainPrompt = "系统核心设定";
    settings.promptConfig.useMainPrompt = true;
    settings.promptConfig.mainPromptName = "旧名字";

    let latest: UserSettings = settings;
    render(
      <Harness
        initial={settings}
        onSettingsChange={(next) => {
          latest = next;
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /展开或折叠 旧名字/ }));
    fireEvent.change(screen.getByPlaceholderText("提示词名称"), {
      target: { value: zhCN["prompts.system_prompt"] },
    });

    expect(latest.promptConfig.mainPromptName).toBeUndefined();
  });

  it("搜索态下改名不会让展开中的条目当场消失", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.promptConfig.customPrompts = [
      {
        id: "style-mod",
        name: "文风规范",
        role: "system",
        content: "言简意赅",
        enabled: true,
      },
    ];

    render(<Harness initial={settings} />);
    fireEvent.change(screen.getByPlaceholderText(/搜索提示词/), {
      target: { value: "文风" },
    });
    fireEvent.click(screen.getByRole("button", { name: /展开或折叠 文风规范/ }));

    fireEvent.change(screen.getByPlaceholderText("提示词名称"), {
      target: { value: "完全无关的名字" },
    });

    // 展开中的条目不参与搜索过滤，输入框还在，名字可以继续改。
    expect(screen.getByDisplayValue("完全无关的名字")).toBeInTheDocument();
  });
});
