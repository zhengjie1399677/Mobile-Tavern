/**
 * MCP 气泡弹层内部"子条目"的收起能力回归。
 *
 * 用户反馈（2026-10-08）：展开的来源行、选中工具后冒出的参数/结果区都没有单独的收起按钮，
 * 只能整面板关掉。这里钉住两条：
 *   - 来源展开区的「收起」只折叠工具列表，面板不关；
 *   - 参数/结果区的 × 只清空当前工具选择，来源仍保持展开，可继续选别的工具。
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/application/externalSources/externalSourceUseCases", () => ({
  externalSourceUseCases: {
    list: vi.fn(),
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

import { McpChatPopover } from "../../src/components/externalTools/McpChatPopover";
import { externalSourceUseCases } from "../../src/application/externalSources/externalSourceUseCases";

const runtime = {
  getSnapshot: () => ({
    sourceId: "deepwiki",
    serverName: "DeepWiki",
    tools: [
      {
        sourceId: "deepwiki",
        qualifiedName: "mcp.deepwiki.ask_question",
        localName: "ask_question",
        description: "向仓库文档提问",
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: { query: { type: "string" } },
        },
      },
    ],
    resources: [],
    prompts: [],
    unsupportedCapabilities: [],
    warnings: [],
  }),
  reload: vi.fn(async () => undefined),
  testCallTool: vi.fn(),
};

const renderPopover = () => render(
  <McpChatPopover
    open
    onOpenChange={vi.fn()}
    getRuntime={() => runtime as never}
    onInsertData={vi.fn()}
    onOpenWorkbench={vi.fn()}
    showAlert={vi.fn()}
  />,
);

beforeEach(() => {
  vi.mocked(externalSourceUseCases.list).mockResolvedValue([
    {
      id: "deepwiki",
      displayName: "DeepWiki 文档检索",
      enabled: true,
    },
  ] as never);
});

describe("MCP 气泡内部子条目收起", () => {
  it("展开来源后可以单独收起工具列表（面板不关）", async () => {
    renderPopover();
    const sourceRow = await screen.findByRole("button", { name: /DeepWiki 文档检索/ });

    fireEvent.click(sourceRow);
    const tool = await screen.findByRole("button", { name: /ask_question/ });
    expect(tool).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "收起 DeepWiki 文档检索" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /ask_question/ })).toBeNull();
    });
    // 面板本体仍在
    expect(screen.getByLabelText("MCP 能力面板")).toBeInTheDocument();
  });

  it("选中工具后可以单独收起参数区，来源保持展开", async () => {
    renderPopover();
    const sourceRow = await screen.findByRole("button", { name: /DeepWiki 文档检索/ });
    fireEvent.click(sourceRow);

    const tool = await screen.findByRole("button", { name: /ask_question/ });
    fireEvent.click(tool);
    expect(screen.getByText(/DeepWiki 文档检索 \/ ask_question/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/输入查询内容/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "收起工具面板" }));
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/输入查询内容/)).toBeNull();
    });
    // 工具列表还在，可以继续选别的工具
    expect(screen.getByRole("button", { name: /ask_question/ })).toBeInTheDocument();
  });
});
