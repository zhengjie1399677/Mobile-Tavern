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

  it("空状态展示本地安装入口和安全边界", async () => {
    render(<LanguageProvider><PluginManagerSection /></LanguageProvider>);
    expect(screen.getByRole("button", { name: "导入 .mtplugin" })).toBeInTheDocument();
    expect(screen.getByText(/隔离的全屏容器/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("尚未安装全屏插件")).toBeInTheDocument());
  });
});
