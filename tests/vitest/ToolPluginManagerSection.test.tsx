import "fake-indexeddb/auto";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    expect(screen.getByText("Worker 隔离")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "权限、Tool 与版本" }));
    fireEvent.click(screen.getByRole("switch", { name: "授予权限 session.read" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "撤销权限 session.read" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("switch", { name: "授予权限 session.write" }));
    await waitFor(() => expect(screen.getByText("已授权 · 停用")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "允许装载 会话助手" }));
    await waitFor(() => expect(screen.getAllByText("允许装载").length).toBeGreaterThan(1));

    fireEvent.click(screen.getByRole("button", { name: "v1.0.0" }));
    await waitFor(() => expect(screen.getAllByText("待授权").length).toBeGreaterThan(0));
    expect((await listInstalledToolPlugins())[0]).toMatchObject({
      enabled: false,
      grantedPermissions: [],
      manifest: { version: "1.0.0" },
    });
  });

  it("卸载会清除插件管理记录", async () => {
    const manifest = await parseToolPluginManifest(JSON.stringify(await createToolPluginManifest()));
    await installToolPluginManifest(manifest);
    render(<ToolPluginManagerSection />);
    await waitFor(() => expect(screen.getByText("会话助手")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "权限、Tool 与版本" }));
    fireEvent.click(screen.getByRole("button", { name: "卸载 会话助手" }));
    await waitFor(() => expect(screen.getByText("尚未安装 Tool Plugin Manifest")).toBeInTheDocument());
    expect(await listInstalledToolPlugins()).toEqual([]);
  });

  it("从官方能力积木完成审阅安装且保持默认停用和未授权", async () => {
    render(<ToolPluginManagerSection />);
    const reviewButton = await screen.findByRole("button", { name: "查看并安装 Brave 网页搜索" });

    fireEvent.click(reviewButton);
    expect(screen.getByText("确认安装 Brave 网页搜索")).toBeInTheDocument();
    expect(screen.getByText("network.request")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认安装，稍后授权" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "已安装 Brave 网页搜索" })).toBeDisabled());
    expect(await listInstalledToolPlugins()).toMatchObject([{
      id: "official.brave-search",
      enabled: false,
      grantedPermissions: [],
    }]);
  });
});
