import "fake-indexeddb/auto";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PluginManagerSection from "../../src/components/plugins/PluginManagerSection";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import { __pluginStorageTest } from "../../src/infrastructure/plugins/pluginStorage";
import { unifiedAppStore } from "../../src/UnifiedAppContext";

// listBuiltinPlugins 生产环境用 ?url + fetch 加载，测试环境无法 fetch 本地资源，
// 此处 mock 返回最小插件数据（仅需满足渲染断言：name + builtin）。
vi.mock("../../src/infrastructure/plugins/builtinPlugins", () => ({
  listBuiltinPlugins: vi.fn(async () => [
    {
      id: "demo.astral-rift",
      manifest: { id: "demo.astral-rift", name: "星渊终焉", version: "1.0.0", entry: "index.html", orientation: "landscape" },
      files: {},
      installedAt: 0,
      updatedAt: 0,
      uncompressedSize: 0,
      builtin: true,
    },
    {
      id: "demo.rain-sword-duel",
      manifest: { id: "demo.rain-sword-duel", name: "夜雨试剑", version: "1.3.0", entry: "index.html", orientation: "landscape" },
      files: {},
      installedAt: 0,
      updatedAt: 0,
      uncompressedSize: 0,
      builtin: true,
    },
  ]),
}));

describe("PluginManagerSection", () => {
  beforeEach(async () => {
    await __pluginStorageTest.reset();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => "zh-CN"), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn(),
    });
    unifiedAppStore.setRawState({
      ...unifiedAppStore.getState(),
      showCustomAlert: vi.fn(),
      showCustomConfirm: vi.fn(async () => true),
    });
  });

  it("展示本地安装入口、安全边界和两个只读内置插件", async () => {
    render(<LanguageProvider><PluginManagerSection /></LanguageProvider>);
    expect(screen.getByRole("button", { name: "导入 .mtplugin" })).toBeInTheDocument();
    expect(screen.getByText(/隔离的全屏容器/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("星渊终焉")).toBeInTheDocument());
    expect(screen.getByText("夜雨试剑")).toBeInTheDocument();
    expect(screen.getAllByText("内置")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /删除插件/ })).not.toBeInTheDocument();
  });
});
