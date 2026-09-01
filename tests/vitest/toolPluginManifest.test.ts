import { describe, expect, it } from "vitest";
import {
  parseToolPluginManifest,
} from "../../src/domain/toolPlugins";
import { createToolPluginManifest } from "./helpers/toolPluginFixture";

describe("受控 Tool Plugin Manifest", () => {
  it("校验来源、哈希、Worker 边界和 Tool 权限声明", async () => {
    const manifest = await createToolPluginManifest();
    await expect(parseToolPluginManifest(JSON.stringify(manifest))).resolves.toMatchObject({
      id: "example.session-tools",
      runtime: { execution: "worker" },
      tools: [{ id: "example.session.rename" }],
    });
  });

  it("拒绝被篡改的内容哈希和 App 进程执行位置", async () => {
    const manifest = await createToolPluginManifest();
    await expect(parseToolPluginManifest(JSON.stringify({ ...manifest, name: "被篡改" })))
      .rejects.toThrow("TOOL_PLUGIN_CONTENT_HASH_MISMATCH");
    const appProcess = await createToolPluginManifest({
      runtime: { minVersion: "1.0.0", execution: "app" },
    });
    await expect(parseToolPluginManifest(JSON.stringify(appProcess)))
      .rejects.toThrow("TOOL_PLUGIN_MANIFEST_INVALID");
  });

  it("拒绝 Tool 使用 Manifest 未声明的权限", async () => {
    const manifest = await createToolPluginManifest({ permissions: [] });
    await expect(parseToolPluginManifest(JSON.stringify(manifest)))
      .rejects.toThrow("未声明权限");
  });

  it("允许显式星号把 Tool 声明为适用于全部 Profile", async () => {
    const manifest = await createToolPluginManifest({ targetProfiles: ["*"] });
    await expect(parseToolPluginManifest(JSON.stringify(manifest))).resolves.toMatchObject({
      targetProfiles: ["*"],
    });
  });
});
