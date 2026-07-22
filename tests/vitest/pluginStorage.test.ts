import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  __pluginStorageTest,
  deletePlugin,
  installPlugin,
  listInstalledPlugins,
  loadPluginData,
  savePluginData,
} from "../../src/infrastructure/plugins/pluginStorage";
import type { InstalledFullscreenPlugin } from "../../src/domain/plugins";

const plugin: InstalledFullscreenPlugin = {
  id: "example.gal.demo",
  manifest: {
    format: "mobile-tavern.plugin",
    manifestVersion: 1,
    id: "example.gal.demo",
    name: "测试 Gal",
    version: "1.0.0",
    type: "fullscreen",
    entry: "index.html",
  },
  files: { "index.html": new Uint8Array([60, 62]) },
  installedAt: 1,
  updatedAt: 1,
  uncompressedSize: 2,
};

describe("插件独立存储", () => {
  beforeEach(async () => __pluginStorageTest.reset());

  it("安装包和存档不进入主 settings/session 数据库", async () => {
    await installPlugin(plugin);
    await savePluginData(plugin.id, "slot_1", { chapter: 3 });

    expect(await listInstalledPlugins()).toHaveLength(1);
    expect(await loadPluginData(plugin.id, "slot_1")).toEqual({ chapter: 3 });
  });

  it("卸载插件时同时清除其独立存档", async () => {
    await installPlugin(plugin);
    await savePluginData(plugin.id, "auto", { ok: true });
    await deletePlugin(plugin.id);

    expect(await listInstalledPlugins()).toEqual([]);
    expect(await loadPluginData(plugin.id, "auto")).toBeNull();
  });

  it("拒绝危险存档槽位和超额数据", async () => {
    await expect(savePluginData(plugin.id, "../bad", {})).rejects.toThrow("PLUGIN_SAVE_INVALID_SLOT");
    await expect(savePluginData(plugin.id, "large", "x".repeat(1024 * 1024 + 1))).rejects.toThrow("PLUGIN_SAVE_TOO_LARGE");
  });
});
