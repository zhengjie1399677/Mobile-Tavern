/**
 * 统一工具面板回归（2026-10-21）。
 *
 * 背景：`/tool` 曾被改写成直接打开 MCP 气泡，「工具」气泡里又混着一条同样打开 MCP 的
 * 「调用外部能力」，导致功能重复、而模型真正可用的 Tool 在聊天里完全不可见。
 *
 * 这里钉住合并后的契约：
 *   - 两个分区「自动调用」「手动调用」并存；
 *   - 自动调用分区只读展示模型可用的 Tool，不提供任何执行入口；
 *   - 手动调用分区只列插件命令（owner = tool-plugin/*），宿主内置命令不再混入；
 *   - `initialTab` 决定打开时的落点，供 `/tool` 与 `/mcp` 区分。
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import {
  ToolsPanel,
  type SessionModelToolSummary,
  type ToolsPanelTab,
} from "../../src/tabs/chat/composer-panels/ToolsPanel";
import type { ComposerCommandDescriptor } from "../../src/domain/composer/contracts";

vi.mock("../../src/application/externalSources/externalSourceUseCases", () => ({
  externalSourceUseCases: {
    list: vi.fn(async () => []),
    setEnabled: vi.fn(),
  },
}));

vi.mock("../../src/application/useCases/externalSourceToolMounting", () => ({
  syncExternalSourceToolMounts: vi.fn(),
}));

vi.mock("../../src/contexts/KernelContext", () => ({
  useOptionalKernel: () => null,
}));

vi.mock("../../src/hooks/useMobileBackHandler", () => ({
  useMobileBackHandler: () => undefined,
}));

const modelTools: SessionModelToolSummary[] = [
  {
    name: "character.read",
    description: "读取当前角色的公开字段",
    riskLevel: "low",
    sideEffect: "none",
    policy: "allow",
  },
  {
    name: "memory.write",
    description: "写入长期记忆",
    riskLevel: "high",
    sideEffect: "local-write",
    policy: "ask",
  },
];

const commands: ComposerCommandDescriptor[] = [
  {
    name: "dice",
    label: "掷骰子",
    description: "掷 NdM 骰子",
    owner: "tool-plugin/official.utility",
    acceptsArgument: true,
  },
  {
    name: "tool",
    label: "查看可用工具",
    description: "宿主内置命令不应出现在手动分区",
    owner: "host.builtin",
    acceptsArgument: true,
  },
];

function renderPanel(initialTab: ToolsPanelTab, onSelectCommand = vi.fn()) {
  const onOpenChange = vi.fn();
  // 固定中文，避免断言被语言包翻译成英文后失配。
  localStorage.setItem("mobile_tavern_language", "zh-CN");
  render(
    <LanguageProvider>
      <ToolsPanel
        open
        onOpenChange={onOpenChange}
        initialTab={initialTab}
        draftText=""
        modelTools={modelTools}
        availableCommands={commands}
        onSelectCommand={onSelectCommand}
        onInsertData={vi.fn()}
        onOpenWorkbench={vi.fn()}
        showAlert={vi.fn()}
        getRuntime={() => null}
        externalCapabilitiesEnabled={false}
      />
    </LanguageProvider>,
  );
  return { onOpenChange, onSelectCommand };
}

describe("统一工具面板", () => {
  it("默认落在自动调用分区，只读展示模型可用工具", () => {
    renderPanel("auto");

    expect(screen.getByRole("tab", { name: /自动调用/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("character.read")).toBeInTheDocument();
    expect(screen.getByText("memory.write")).toBeInTheDocument();
    // 风险与策略标签来自 Tool Definition，不是界面猜测
    expect(screen.getByText("高风险")).toBeInTheDocument();
    expect(screen.getByText("需确认")).toBeInTheDocument();
    // 只读：不存在执行按钮
    expect(screen.queryByRole("button", { name: /^调用$/ })).toBeNull();
  });

  it("手动调用分区只列插件命令，点选后回调并关闭面板", () => {
    const { onOpenChange, onSelectCommand } = renderPanel("manual");

    expect(screen.getByRole("tab", { name: /手动调用/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("/dice")).toBeInTheDocument();
    // 宿主内置的 /tool 不再混进手动分区，避免出现"工具里开工具"的重复入口
    expect(screen.queryByText("/tool")).toBeNull();

    fireEvent.click(screen.getByText("/dice").closest("button") as HTMLElement);
    expect(onSelectCommand).toHaveBeenCalledWith(expect.objectContaining({ name: "dice" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("initialTab=manual 时直接进入手动分区（/mcp 的落点）", () => {
    renderPanel("manual");
    expect(screen.getByRole("tab", { name: /手动调用/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("外部能力（MCP）")).toBeInTheDocument();
  });

  it("外部能力开关关闭时，手动分区给出明确提示而不是静默隐藏", () => {
    renderPanel("manual");
    expect(screen.getByText(/外部能力总开关关闭时/)).toBeInTheDocument();
    expect(screen.getByText(/总开关当前是关闭的/)).toBeInTheDocument();
  });
});
