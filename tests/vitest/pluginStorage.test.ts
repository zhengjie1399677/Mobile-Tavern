import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  __pluginStorageTest,
  deletePlugin,
  installPlugin,
  listInstalledPlugins,
  loadPluginData,
  loadPluginFiles,
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

  it("列表视图不返回 files 字段，避免内存峰值", async () => {
    await installPlugin(plugin);
    const list = await listInstalledPlugins();
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty("files");
    expect(list[0].id).toBe(plugin.id);
    expect(list[0].manifest.name).toBe("测试 Gal");
  });

  it("installPlugin 拆分写入，loadPluginFiles 按需读回完整字节", async () => {
    await installPlugin(plugin);
    const files = await loadPluginFiles(plugin.id);
    expect(Object.keys(files)).toEqual(["index.html"]);
    expect(files["index.html"]).toEqual(new Uint8Array([60, 62]));
  });

  it("loadPluginFiles 对未安装插件返回空对象", async () => {
    expect(await loadPluginFiles("not.exist")).toEqual({});
  });

  it("deletePlugin 同时清理 packageFiles 字节", async () => {
    await installPlugin(plugin);
    expect(Object.keys(await loadPluginFiles(plugin.id))).toHaveLength(1);
    await deletePlugin(plugin.id);
    expect(await loadPluginFiles(plugin.id)).toEqual({});
  });

  it("v1→v2 迁移：旧 packages.files 拆到 packageFiles，列表不再持有字节", async () => {
    await __pluginStorageTest.seedV1Record(plugin);
    await __pluginStorageTest.reopenWithCurrentVersion();

    const list = await listInstalledPlugins();
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty("files");
    const files = await loadPluginFiles(plugin.id);
    expect(files["index.html"]).toEqual(new Uint8Array([60, 62]));
  });

  it("v1→v2 迁移：多记录全部完成迁移，cursor 遍历不中断", async () => {
    // 回归保护：cursor.update + cursor.continue 在真实浏览器会抛 InvalidStateError（MDN 规范约束），
    // 导致遍历中断、后续记录未迁移。改用 store.put 后多条记录应全部完成迁移。
    // fake-indexeddb 实现宽松未复现该异常，本测试验证多记录场景的逻辑正确性。
    const pluginA: InstalledFullscreenPlugin = { ...plugin, id: "a.demo", manifest: { ...plugin.manifest, id: "a.demo", name: "A" } };
    const pluginB: InstalledFullscreenPlugin = { ...plugin, id: "b.demo", manifest: { ...plugin.manifest, id: "b.demo", name: "B" } };
    const pluginC: InstalledFullscreenPlugin = { ...plugin, id: "c.demo", manifest: { ...plugin.manifest, id: "c.demo", name: "C" } };
    await __pluginStorageTest.seedV1Records([pluginA, pluginB, pluginC]);
    await __pluginStorageTest.reopenWithCurrentVersion();

    const list = await listInstalledPlugins();
    expect(list).toHaveLength(3);
    for (const meta of list) {
      expect(meta).not.toHaveProperty("files");
    }
    expect((await loadPluginFiles("a.demo"))["index.html"]).toEqual(new Uint8Array([60, 62]));
    expect((await loadPluginFiles("b.demo"))["index.html"]).toEqual(new Uint8Array([60, 62]));
    expect((await loadPluginFiles("c.demo"))["index.html"]).toEqual(new Uint8Array([60, 62]));
  });
});
