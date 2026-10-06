import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ToolCapabilitiesWidget } from "../../src/components/workbench/ToolCapabilitiesWidget";
import { toolPluginManagementUseCases } from "../../src/application/useCases/toolPluginManagementUseCases";
import { externalSourceUseCases } from "../../src/application/externalSources/externalSourceUseCases";

vi.mock("../../src/application/useCases/toolPluginManagementUseCases", () => ({
  toolPluginManagementUseCases: {
    list: vi.fn(),
    setEnabled: vi.fn(),
  },
}));

vi.mock("../../src/application/externalSources/externalSourceUseCases", () => ({
  externalSourceUseCases: {
    list: vi.fn(),
    setEnabled: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
    setCredential: vi.fn(),
  },
}));

const mockGetDiagnostics = vi.fn().mockReturnValue({
  connectedSources: ["mcp-wiki"],
  registeredTools: ["mcp.mcp-wiki.search"],
  failures: {},
});

const mockGetSnapshot = vi.fn().mockReturnValue({
  sourceId: "mcp-wiki",
  serverName: "DeepWiki",
  tools: [
    {
      sourceId: "mcp-wiki",
      qualifiedName: "mcp.mcp-wiki.search",
      localName: "search",
      description: "Search documentation",
      inputSchema: { type: "object" },
    },
  ],
  resources: [],
  prompts: [],
  unsupportedCapabilities: [],
  warnings: [],
});

const mockReload = vi.fn().mockResolvedValue(undefined);

// 与生产一致：state 上的函数引用必须稳定，否则 selector 每次返回新引用会放大成无限渲染环。
const mockShowCustomAlert = vi.fn();
const mockShowCustomConfirm = vi.fn().mockResolvedValue(true);
const mockKernelService = {
  getDiagnostics: mockGetDiagnostics,
  getSnapshot: mockGetSnapshot,
  testCallTool: vi.fn().mockResolvedValue({ result: { text: "ok" }, durationMs: 1 }),
  reload: mockReload,
};
const mockGetKernelService = vi.fn().mockReturnValue(mockKernelService);

vi.mock("../../src/UnifiedAppContext", () => ({
  useUnifiedApp: <T,>(selector: (_state: Record<string, unknown>) => T) =>
    selector({
      showCustomAlert: mockShowCustomAlert,
      showCustomConfirm: mockShowCustomConfirm,
      getKernelService: mockGetKernelService,
    }),
}));

/**
 * 渲染并把两处异步加载（插件列表 / MCP 来源）在 act 窗口内收口。
 * 否则它们的 setState 会落在测试结束之后，刷出 "not wrapped in act(...)" 警告。
 */
async function renderSettledWidget(): Promise<ReturnType<typeof render>> {
  const view = render(<ToolCapabilitiesWidget />);
  await waitFor(() => {
    expect(toolPluginManagementUseCases.list).toHaveBeenCalledTimes(1);
    expect(externalSourceUseCases.list).toHaveBeenCalledTimes(1);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return view;
}

describe("ToolCapabilitiesWidget (工作台能力中枢与 MCP 视界)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(toolPluginManagementUseCases.list).mockResolvedValue([
      {
        id: "test.plugin",
        enabled: true,
        manifest: {
          name: "Test Search Plugin",
          version: "1.0.0",
          description: "A test external search plugin",
        },
        sourceVerification: { trustLevel: "official" },
      },
    ] as unknown as import("../../src/domain/toolPlugins").InstalledToolPlugin[]);

    vi.mocked(externalSourceUseCases.list).mockResolvedValue([
      {
        schemaVersion: 1,
        id: "mcp-wiki",
        kind: "mcp",
        displayName: "DeepWiki 知识库",
        endpoint: "https://mcp.deepwiki.com/mcp",
        transport: "streamable-http",
        era: "auto",
        enabled: true,
        createdAt: 1728172800000,
        updatedAt: 1728172800000,
      },
    ]);
  });

  it("默认选中 MCP 标签并展示已连接的第三方服务", async () => {
    await renderSettledWidget();

    expect(screen.getByText("扩展能力")).toBeInTheDocument();
    expect(screen.getByText("第三方 MCP 与宿主 Tool")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("DeepWiki 知识库")).toBeInTheDocument();
    });

    // 默认展示工具数徽标
    expect(screen.getByText("1 工具")).toBeInTheDocument();
  });

  it("支持展开查看工具详情", async () => {
    await renderSettledWidget();

    await waitFor(() => {
      expect(screen.getByText("DeepWiki 知识库")).toBeInTheDocument();
    });

    // 点击该来源展开
    fireEvent.click(screen.getByText("DeepWiki 知识库"));

    // 展开后显示端点与工具标签
    await waitFor(() => {
      expect(screen.getByText("已发现工具 (1)：")).toBeInTheDocument();
      expect(screen.getByText("search")).toBeInTheDocument();
      expect(screen.getByText("协议世代: auto")).toBeInTheDocument();
    });
  });

  it("支持切换到插件标签查看原生 Tool 插件", async () => {
    await renderSettledWidget();

    const pluginTabBtn = screen.getByText("插件");
    fireEvent.click(pluginTabBtn);

    await waitFor(() => {
      expect(screen.getByText("Test Search Plugin")).toBeInTheDocument();
      expect(screen.getByText("v1.0.0")).toBeInTheDocument();
      expect(screen.getByText("官方")).toBeInTheDocument();
    });
  });

  it("支持打开接入第三方 MCP 弹窗并展示热门预置模板", async () => {
    await renderSettledWidget();

    await waitFor(() => {
      expect(screen.getByText("接入第三方 MCP")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("接入第三方 MCP"));

    expect(screen.getByText("导入第三方配置")).toBeInTheDocument();
    expect(screen.getByText("推荐热门模板")).toBeInTheDocument();

    // 切换到推荐模板
    fireEvent.click(screen.getByText("推荐热门模板"));
    expect(screen.getByText("DeepWiki 文档检索")).toBeInTheDocument();
    expect(screen.getByText("Brave Search 远程搜索")).toBeInTheDocument();
  });

  it("选用需要鉴权的预置模板并保存时，鉴权头与鉴权方案必须随凭据一起带出", async () => {
    const view = await renderSettledWidget();

    fireEvent.click(screen.getByText("接入第三方 MCP"));
    fireEvent.click(screen.getByText("推荐热门模板"));
    fireEvent.click(screen.getByLabelText("选用预置 Brave Search 远程搜索"));

    const tokenInput = view.container.querySelector('input[type="password"]');
    expect(tokenInput).not.toBeNull();
    expect((tokenInput as HTMLInputElement).placeholder).toContain("Brave Search API Key");

    fireEvent.change(tokenInput as HTMLInputElement, { target: { value: "BSA-key-123" } });
    fireEvent.click(screen.getByText("保存并连接"));

    await waitFor(() => {
      expect(externalSourceUseCases.save).toHaveBeenCalledTimes(1);
    });
    // 若这里退化回默认 Authorization: Bearer，Brave 预置会直接 401
    expect(vi.mocked(externalSourceUseCases.save).mock.calls[0][0]).toMatchObject({
      id: "brave-search",
      authHeader: "x-subscription-token",
      authScheme: "raw",
    });
    expect(externalSourceUseCases.setCredential).toHaveBeenCalledWith(
      expect.objectContaining({ id: "brave-search" }),
      "BSA-key-123",
    );
  });
});
