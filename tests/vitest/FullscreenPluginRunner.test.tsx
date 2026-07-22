import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FullscreenPluginRunner from "../../src/components/plugins/FullscreenPluginRunner";
import type { InstalledFullscreenPlugin } from "../../src/domain/plugins";

const plugin: InstalledFullscreenPlugin = {
  id: "example.gal.demo",
  manifest: {
    format: "mobile-tavern.plugin", manifestVersion: 1, id: "example.gal.demo",
    name: "测试 Gal", version: "1.0.0", type: "fullscreen", entry: "index.html",
  },
  files: {
    "manifest.json": new TextEncoder().encode("{}"),
    "index.html": new TextEncoder().encode("<h1>Gal</h1>"),
  },
  installedAt: 1, updatedAt: 1, uncompressedSize: 1,
};

describe("FullscreenPluginRunner", () => {
  it("只给 iframe 脚本权限，不授予同源、表单、弹窗和导航权限", () => {
    (window as unknown as { happyDOM?: { settings: { disableIframePageLoading: boolean } } }).happyDOM!.settings.disableIframePageLoading = true;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-runtime");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    render(<FullscreenPluginRunner plugin={plugin} onExit={vi.fn()} />);

    const iframe = screen.getByTitle("测试 Gal");
    expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(screen.getByRole("button", { name: "退出插件" })).toBeInTheDocument();
  });
});
