/**
 * 统一工具面板回归（2026-10-21 合并入口；2026-10-22 拆分「模型可用 / 立即执行」）。
 *
 * 钉住四件事：
 *   - 三个分区并存：模型可用、立即执行、MCP；
 *   - 模型可用分区只读，不提供执行入口；
 *   - `autoInvoke: false` 的收费工具只出现在「立即执行」，填表后真正调用用例；
 *   - 宿主内置命令不混进插件命令列表（曾经导致"工具里再开工具"）。
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import {
  ToolsPanel,
  type SessionManualToolSummary,
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

const SEARCH_TOOL = "ext.official.deepseek-web.web.search";
const FETCH_TOOL = "ext.official.deepseek-web.web.fetch";

const modelTools: SessionModelToolSummary[] = [
  {
    name: "character.read",
    description: "读取当前角色的公开字段",
    riskLevel: "low",
    sideEffect: "none",
    policy: "allow",
  },
];

const manualTools: SessionManualToolSummary[] = [
  {
    name: "character.read",
    description: "读取当前角色的公开字段",
    riskLevel: "low",
    sideEffect: "none",
    policy: "allow",
    inputJsonSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: SEARCH_TOOL,
    description: "搜索公开网页并返回标题、链接和摘要",
    riskLevel: "medium",
    sideEffect: "external",
    policy: "ask",
    inputJsonSchema: {
      type: "object",
      properties: { query: { type: "string", description: "检索关键词" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: FETCH_TOOL,
    description: "抓取指定 URL 网页的完整正文",
    riskLevel: "medium",
    sideEffect: "external",
    policy: "ask",
    inputJsonSchema: {
      type: "object",
      properties: { url: { type: "string", description: "网页地址" } },
      required: ["url"],
      additionalProperties: false,
    },
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
    description: "宿主内置命令不应出现在插件命令里",
    owner: "host.builtin",
    acceptsArgument: true,
  },
];

function renderPanel(options: {
  initialTab?: ToolsPanelTab;
  onInvokeTool?: (toolName: string, input: Record<string, unknown>) => Promise<{
    toolName: string;
    data: string;
    durationMs: number;
    isError: boolean;
  }>;
} = {}) {
  const onOpenChange = vi.fn();
  const onInvokeTool = options.onInvokeTool ?? vi.fn();
  localStorage.setItem("mobile_tavern_language", "zh-CN");
  render(
    <LanguageProvider>
      <ToolsPanel
        open
        onOpenChange={onOpenChange}
        initialTab={options.initialTab ?? "model"}
        draftText=""
        modelTools={modelTools}
        manualTools={manualTools}
        availableCommands={commands}
        onSelectCommand={vi.fn()}
        onInvokeTool={onInvokeTool}
        onInsertData={vi.fn()}
        onOpenWorkbench={vi.fn()}
        showAlert={vi.fn()}
        getRuntime={() => null}
        externalCapabilitiesEnabled={false}
      />
    </LanguageProvider>,
  );
  return { onOpenChange, onInvokeTool };
}

describe("统一工具面板", () => {
  it("默认落在模型可用分区，只读展示模型可自动调用的工具", () => {
    renderPanel();

    expect(screen.getByRole("tab", { name: /模型可用/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("character.read")).toBeInTheDocument();
    // 收费检索不在模型可用分区里
    expect(screen.queryByText(SEARCH_TOOL)).toBeNull();
    // 只读：没有「执行」按钮
    expect(screen.queryByRole("button", { name: /^执行$/ })).toBeNull();
  });

  it("立即执行分区能手动跑 autoInvoke:false 的收费检索工具", async () => {
    const onInvokeTool = vi.fn(async () => ({
      toolName: SEARCH_TOOL,
      data: "【结果】唐朝建立于 618 年",
      durationMs: 42,
      isError: false,
    }));
    renderPanel({ initialTab: "run", onInvokeTool });

    expect(screen.getByRole("tab", { name: /立即执行/ })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByText(SEARCH_TOOL).closest("button") as HTMLElement);
    fireEvent.change(screen.getByPlaceholderText("检索关键词"), { target: { value: "唐朝" } });
    fireEvent.click(screen.getByRole("button", { name: /^执行$/ }));

    await waitFor(() => {
      expect(onInvokeTool).toHaveBeenCalledWith(SEARCH_TOOL, { query: "唐朝" });
    });
    expect(await screen.findByText(/唐朝建立于 618 年/)).toBeInTheDocument();
  });

  it("搜索结果里的 URL 能一键接力给抓取工具（search → fetch 不是两个孤立按钮）", async () => {
    const onInvokeTool = vi.fn(async () => ({
      toolName: SEARCH_TOOL,
      data: "1. 唐朝 - 维基百科\nhttps://zh.wikipedia.org/wiki/唐朝\n2. 唐 - 百度百科\nhttps://baike.baidu.com/item/唐",
      durationMs: 30,
      isError: false,
    }));
    renderPanel({ initialTab: "run", onInvokeTool });

    fireEvent.click(screen.getByText(SEARCH_TOOL).closest("button") as HTMLElement);
    fireEvent.change(screen.getByPlaceholderText("检索关键词"), { target: { value: "唐朝" } });
    fireEvent.click(screen.getByRole("button", { name: /^执行$/ }));

    const link = await screen.findByRole("button", { name: /zh\.wikipedia\.org/ });
    fireEvent.click(link);

    // 接力后表单切到抓取工具，URL 已预填
    expect(screen.getAllByText(FETCH_TOOL).length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("https://zh.wikipedia.org/wiki/唐朝")).toBeInTheDocument();
  });

  it("插件命令列表只收 tool-plugin 归属的命令", () => {
    renderPanel({ initialTab: "run" });

    expect(screen.getByText("/dice")).toBeInTheDocument();
    expect(screen.queryByText("/tool")).toBeNull();
  });

  it("initialTab=mcp 时进入 MCP 分区并给出总开关提示", () => {
    renderPanel({ initialTab: "mcp" });

    expect(screen.getByRole("tab", { name: /MCP/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("外部能力（MCP）")).toBeInTheDocument();
    expect(screen.getByText(/总开关当前是关闭的/)).toBeInTheDocument();
  });
});
