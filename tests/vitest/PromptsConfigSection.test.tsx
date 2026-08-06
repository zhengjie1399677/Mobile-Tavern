import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PromptsConfigSection from "../../src/components/presetForm/PromptsConfigSection";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import type { UserSettings } from "../../src/types";

function Harness({
  initial,
  onOpenComposer,
}: {
  initial: UserSettings;
  onOpenComposer?: () => void;
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
        handleToggleCustomPrompt={vi.fn()}
        handleUpdateCustomPrompt={vi.fn()}
        handleAddNewCustomPrompt={vi.fn()}
        handleDeleteCustomPrompt={vi.fn(async () => undefined)}
        isPromptsFolded={false}
        handleTogglePromptsFold={vi.fn()}
        coreStatusText="0/4"
        activeCustomPrompts={0}
        selectedPromptIds={[]}
        setSelectedPromptIds={vi.fn()}
        isBatchDeletingPrompts={false}
        setIsBatchDeletingPrompts={vi.fn()}
        handleBatchDeletePrompts={vi.fn(async () => undefined)}
        onOpenComposer={onOpenComposer}
      />
    </LanguageProvider>
  );
}

function withComposition(
  blocks: NonNullable<UserSettings["promptConfig"]["composition"]>["blocks"],
): UserSettings {
  const initial = structuredClone(DEFAULT_SETTINGS);
  initial.promptConfig.usePromptComposition = true;
  initial.promptConfig.composition = {
    id: "section-test",
    name: "区块开关测试",
    version: 1,
    blocks,
  };
  return initial;
}

const sampleBlocks: NonNullable<UserSettings["promptConfig"]["composition"]>["blocks"] = [
  {
    id: "block-pov",
    name: "视角-第一人称",
    enabled: false,
    role: "system",
    source: { type: "template" },
    template: "第一人称约束",
    order: 100,
    placement: { type: "ordered" },
  },
  {
    id: "block-style",
    name: "文风-轻小说",
    enabled: true,
    role: "user",
    source: { type: "template" },
    template: "轻小说文风",
    order: 200,
    placement: { type: "ordered" },
  },
];

describe("PromptsConfigSection 自由编排区块开关", () => {
  beforeEach(() => {
    localStorage.setItem("mobile_tavern_language", "zh-CN");
  });

  it("自由编排模式下直接列出当前编排的 Prompt 区块与开关状态", () => {
    render(<Harness initial={withComposition(sampleBlocks)} />);
    expect(screen.getByText("视角-第一人称")).toBeInTheDocument();
    expect(screen.getByText("文风-轻小说")).toBeInTheDocument();
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(2);
    expect(switches[0]).not.toBeChecked();
    expect(switches[1]).toBeChecked();
  });

  it("点击开关即更新对应区块的启用状态", () => {
    render(<Harness initial={withComposition(sampleBlocks)} />);
    const firstSwitch = screen.getByRole("switch", { name: /视角-第一人称/ });
    fireEvent.click(firstSwitch);
    expect(firstSwitch).toBeChecked();
    const secondSwitch = screen.getByRole("switch", { name: /文风-轻小说/ });
    fireEvent.click(secondSwitch);
    expect(secondSwitch).not.toBeChecked();
  });

  it("点击编辑按钮可直接修改区块名称与内容", () => {
    render(<Harness initial={withComposition(sampleBlocks)} />);
    fireEvent.click(
      screen.getByRole("button", { name: /编辑 Prompt 区块 视角-第一人称/ }),
    );
    const nameInput = screen.getByLabelText("区块名称");
    fireEvent.change(nameInput, { target: { value: "视角-第二人称" } });
    expect(screen.getByDisplayValue("视角-第二人称")).toBeInTheDocument();
  });

  it("点击删除按钮二次确认后移除对应区块", () => {
    render(<Harness initial={withComposition(sampleBlocks)} />);
    const deleteButton = screen.getByRole("button", {
      name: /删除区块 视角-第一人称/,
    });
    fireEvent.click(deleteButton);
    fireEvent.click(deleteButton);
    expect(screen.queryByText("视角-第一人称")).not.toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(1);
  });

  it("编辑对话框中可复制区块", () => {
    render(<Harness initial={withComposition(sampleBlocks)} />);
    fireEvent.click(
      screen.getByRole("button", { name: /编辑 Prompt 区块 视角-第一人称/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "复制区块" }));
    // 复制后列表出现副本条目；不再以对话框内开关数量断言（高级字段已收敛
    // 到编排页，对话框仅保留基础开关）。
    expect(screen.getByText("视角-第一人称 副本")).toBeInTheDocument();
    expect(screen.getByText("视角-第一人称")).toBeInTheDocument();
  });

  it("空编排时给出明确提示而不是空白", () => {
    render(<Harness initial={withComposition([])} />);
    expect(
      screen.getByText("当前为空编排，这是合法状态，不会隐式注入内容。"),
    ).toBeInTheDocument();
  });

  it("传统模式仍渲染 CORE PROMPTS 与 PROMPT MODULES", () => {
    render(<Harness initial={structuredClone(DEFAULT_SETTINGS)} />);
    expect(screen.getByText("CORE PROMPTS")).toBeInTheDocument();
    expect(screen.getByText("PROMPT MODULES")).toBeInTheDocument();
  });

  it("预设界面编辑对话框不展示高级字段，仅提示前往自由 Prompt 编排", () => {
    render(<Harness initial={withComposition(sampleBlocks)} />);
    fireEvent.click(
      screen.getByRole("button", { name: /编辑 Prompt 区块 视角-第一人称/ }),
    );
    expect(
      screen.queryByText("条件与 Token 策略"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/高级编辑，请在「自由 Prompt 编排」中调整/),
    ).toBeInTheDocument();
  });

  it("提供 onOpenComposer 时渲染前往编排按钮并触发回调", () => {
    const openComposer = vi.fn();
    render(
      <Harness
        initial={withComposition(sampleBlocks)}
        onOpenComposer={openComposer}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "前往自由 Prompt 编排" }),
    );
    expect(openComposer).toHaveBeenCalledTimes(1);
  });
});
