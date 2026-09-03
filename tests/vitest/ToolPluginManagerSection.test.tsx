import "fake-indexeddb/auto";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ToolPluginManagerSection from "../../src/components/plugins/ToolPluginManagerSection";
import { parseToolPluginManifest } from "../../src/domain/toolPlugins";
import {
  __toolPluginStorageTest,
  installToolPluginManifest,
  listInstalledToolPlugins,
} from "../../src/infrastructure/toolPlugins/toolPluginStorage";
import { unifiedAppStore } from "../../src/UnifiedAppContext";
import { createToolPluginManifest } from "./helpers/toolPluginFixture";

describe("ToolPluginManagerSection", () => {
  beforeEach(async () => {
    await __toolPluginStorageTest.reset();
    unifiedAppStore.setRawState({
      ...unifiedAppStore.getState(),
      showCustomAlert: vi.fn(),
      showCustomConfirm: vi.fn(async () => true),
      showCustomPrompt: vi.fn(async () => "test-api-key"),
    });
  });

  it("展示独立入口，并完成权限授权、允许装载与安全回滚", async () => {
    const v1 = await parseToolPluginManifest(JSON.stringify(await createToolPluginManifest()));
    const v2 = await parseToolPluginManifest(JSON.stringify(await createToolPluginManifest({ version: "2.0.0" })));
    await installToolPluginManifest(v1, 10);
    await installToolPluginManifest(v2, 20);

    render(<ToolPluginManagerSection />);
    await waitFor(() => expect(screen.getByText("会话助手")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "导入 .mttool / Manifest" })).toBeInTheDocument();
    expect(screen.getAllByText("待授权").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Worker 隔离").length).toBeGreaterThan(0);
    expect(screen.getByText(/来源标签只用于辨识发布来源/u)).toBeInTheDocument();

    const sessionCard = screen.getByText("会话助手").closest("article");
    expect(sessionCard).not.toBeNull();
    fireEvent.click(within(sessionCard as HTMLElement).getByRole("button", { name: "权限、Tool 与版本" }));

    const sourceSection = screen.getByText("来源与版本").parentElement;
    expect(sourceSection).not.toBeNull();
    expect(within(sourceSection as HTMLElement).getByText(/未验证来源/u)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "授予权限 session.read" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "撤销权限 session.read" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("switch", { name: "授予权限 session.write" }));
    await waitFor(() => expect(within(sessionCard as HTMLElement).getByText("已授权 · 停用")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "允许装载 会话助手" }));
    await waitFor(() => expect(within(sessionCard as HTMLElement).getByText("允许装载")).toBeInTheDocument());

    const rollbackBtn = await screen.findByRole("button", { name: "v1.0.0" });
    await waitFor(() => expect(rollbackBtn).not.toBeDisabled());
    fireEvent.click(rollbackBtn);
    await waitFor(async () => {
      expect((await listInstalledToolPlugins())[0]).toMatchObject({
        enabled: false,
        grantedPermissions: [],
        manifest: { version: "1.0.0" },
      });
    });
  });

  it("卸载会清除插件管理记录", async () => {
    const manifest = await parseToolPluginManifest(JSON.stringify(await createToolPluginManifest()));
    await installToolPluginManifest(manifest);
    render(<ToolPluginManagerSection />);
    await waitFor(() => expect(screen.getByText("会话助手")).toBeInTheDocument());

    const sessionCard = screen.getByText("会话助手").closest("article");
    expect(sessionCard).not.toBeNull();
    fireEvent.click(within(sessionCard as HTMLElement).getByRole("button", { name: "权限、Tool 与版本" }));
    fireEvent.click(within(sessionCard as HTMLElement).getByRole("button", { name: "卸载 会话助手" }));
    await waitFor(() => expect(screen.queryByText("会话助手")).not.toBeInTheDocument());
    expect(await listInstalledToolPlugins()).toEqual([]);
  });

  it("允许安装未验证来源，但在确认前明确告知代码与授权风险", async () => {
    const manifest = await createToolPluginManifest();
    render(<ToolPluginManagerSection />);
    await screen.findByRole("button", { name: "导入 .mttool / Manifest" });

    fireEvent.change(screen.getByLabelText("选择 Tool Plugin Manifest"), {
      target: {
        files: [new File([JSON.stringify(manifest)], "community.mttool.json", { type: "application/json" })],
      },
    });

    expect(await screen.findByText("导入插件 会话助手")).toBeInTheDocument();
    expect(screen.getByText(/没有可验证的签名/u)).toBeInTheDocument();
    expect(screen.getByText(/不会阻止安装/u)).toBeInTheDocument();
    expect(screen.getByText(/使用你随后授予的网络或数据权限/u)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认导入，稍后授权" }));
    await waitFor(() => expect(screen.getByText("会话助手")).toBeInTheDocument());
    expect((await listInstalledToolPlugins())[0].sourceVerification?.trustLevel).toBe("unverified");
  });

  it("官方能力开箱即用直接呈现，支持一键启用装载", async () => {
    render(<ToolPluginManagerSection />);
    expect(await screen.findByText("Brave 网页搜索")).toBeInTheDocument();
    expect(screen.getByText("长期记忆写入")).toBeInTheDocument();
    expect(screen.getByText("设备日期时间")).toBeInTheDocument();
    expect(screen.getByText("本地实用工具")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "允许装载 设备日期时间" }));
    await waitFor(async () => {
      const installed = await listInstalledToolPlugins();
      expect(installed.length).toBeGreaterThan(0);
      expect(installed[0]).toMatchObject({
        id: "official.device-time",
        enabled: true,
      });
    });
  });

  it("把声明式 memory.write 明确标注为宿主授权能力", async () => {
    render(<ToolPluginManagerSection />);
    expect(await screen.findByText("长期记忆写入")).toBeInTheDocument();
    expect(screen.getAllByText("宿主授权能力").length).toBeGreaterThan(0);
    const memoryCard = screen.getByText("长期记忆写入").closest("article");
    expect(memoryCard).not.toBeNull();
    fireEvent.click(within(memoryCard as HTMLElement).getByRole("button", { name: "权限、Tool 与版本" }));
    expect(within(memoryCard as HTMLElement).getAllByText("memory.write").length).toBeGreaterThan(0);
  });
});
