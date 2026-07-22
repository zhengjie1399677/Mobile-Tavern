import "fake-indexeddb/auto";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PluginManagerSection from "../../src/components/plugins/PluginManagerSection";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import { __pluginStorageTest } from "../../src/infrastructure/plugins/pluginStorage";
import { unifiedAppStore } from "../../src/UnifiedAppContext";

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
