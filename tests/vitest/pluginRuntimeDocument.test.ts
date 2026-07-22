import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginRuntimeDocument, type InstalledFullscreenPlugin } from "../../src/domain/plugins";

const plugin: InstalledFullscreenPlugin = {
  id: "example.gal.demo",
  manifest: {
    format: "mobile-tavern.plugin", manifestVersion: 1, id: "example.gal.demo",
    name: "Gal", version: "1.0.0", type: "fullscreen", entry: "index.html",
  },
  files: {
    "manifest.json": new TextEncoder().encode("{}"),
    "index.html": new TextEncoder().encode('<html><head><link rel="stylesheet" href="style.css"></head><body><img src="assets/bg.png"><script src="game.js"></script></body></html>'),
    "style.css": new TextEncoder().encode("body{background:url('./assets/bg.png')}") ,
    "game.js": new TextEncoder().encode("window.started=true"),
    "assets/bg.png": new Uint8Array([1, 2, 3]),
  },
  installedAt: 1, updatedAt: 1, uncompressedSize: 3,
};

describe("全屏插件运行文档", () => {
  let blobs: Blob[];
  beforeEach(() => {
    blobs = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return `blob:test-${blobs.length}`;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  it("注入严格 CSP、受限桥接并把包内资源替换为 Blob URL", async () => {
    const runtime = createPluginRuntimeDocument(plugin, "channel-test");
    const html = await blobs.at(-1)!.text();

    expect(runtime.url).toMatch(/^blob:test-/);
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("MobileTavernPlugin");
    expect(html).toContain("channel-test");
    expect(html).toContain('href="blob:test-');
    expect(html).toContain('src="blob:test-');

    runtime.revoke();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(blobs.length);
  });
});

