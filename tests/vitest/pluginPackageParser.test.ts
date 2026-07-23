import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseFullscreenPluginPackage } from "../../src/domain/plugins";

function buildPackage(overrides: Record<string, unknown> = {}, extra: Record<string, Uint8Array> = {}) {
  const manifest = {
    format: "mobile-tavern.plugin",
    manifestVersion: 1,
    id: "example.gal.demo",
    name: "测试 Gal",
    version: "1.0.0",
    type: "fullscreen",
    entry: "index.html",
    orientation: "landscape",
    ...overrides,
  };
  return zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "index.html": strToU8("<!doctype html><title>test</title>"),
    ...extra,
  });
}

describe("第三方全屏插件包协议", () => {
  it("解析受支持的 .mtplugin ZIP 与清单", async () => {
    const parsed = await parseFullscreenPluginPackage(buildPackage(), 100);
    expect(parsed).toMatchObject({
      id: "example.gal.demo",
      installedAt: 100,
      updatedAt: 100,
      manifest: { name: "测试 Gal", orientation: "landscape" },
    });
    expect(new TextDecoder().decode(parsed.files["index.html"])).toContain("<title>test</title>");
  });

  it("拒绝路径穿越和缺失入口", async () => {
    await expect(parseFullscreenPluginPackage(buildPackage({ entry: "../index.html" }))).rejects.toThrow("PLUGIN_PACKAGE_UNSAFE_PATH");
    await expect(parseFullscreenPluginPackage(buildPackage({ entry: "missing.html" }))).rejects.toThrow("PLUGIN_ENTRY_MISSING");
  });

  it("拒绝未知格式、无效 ID 与非语义版本", async () => {
    await expect(parseFullscreenPluginPackage(buildPackage({ format: "other" }))).rejects.toThrow("PLUGIN_MANIFEST_UNSUPPORTED");
    await expect(parseFullscreenPluginPackage(buildPackage({ id: "Bad ID" }))).rejects.toThrow("PLUGIN_MANIFEST_INVALID_ID");
    await expect(parseFullscreenPluginPackage(buildPackage({ version: "latest" }))).rejects.toThrow("PLUGIN_MANIFEST_INVALID_VERSION");
  });

  it("解压损坏的 ZIP 抛出无效包错误", async () => {
    const corrupted = new Uint8Array(25);
    await expect(parseFullscreenPluginPackage(corrupted)).rejects.toThrow();
  });
});

