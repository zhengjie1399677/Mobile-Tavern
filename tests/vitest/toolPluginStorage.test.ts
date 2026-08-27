import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { parseToolPluginManifest } from "../../src/domain/toolPlugins";
import {
  __toolPluginStorageTest,
  installToolPluginManifest,
  deleteToolPluginCredential,
  listInstalledToolPlugins,
  rollbackToolPlugin,
  setToolPluginEnabled,
  setToolPluginCredential,
  listToolPluginCredentialStatus,
  resolveToolPluginCredential,
  setToolPluginPermissions,
  uninstallToolPlugin,
} from "../../src/infrastructure/toolPlugins/toolPluginStorage";
import { createToolPluginManifest, createV2HttpManifest } from "./helpers/toolPluginFixture";

describe("Tool Plugin 独立管理存储", () => {
  beforeEach(async () => __toolPluginStorageTest.reset());

  it("安装后默认停用且未授权，权限齐全后才能启用", async () => {
    const manifest = await parseToolPluginManifest(JSON.stringify(await createToolPluginManifest()));
    await installToolPluginManifest(manifest, 10);
    await expect(setToolPluginEnabled(manifest.id, true, 11))
      .rejects.toThrow("TOOL_PLUGIN_REQUIRED_PERMISSION_MISSING");

    await setToolPluginPermissions(manifest.id, ["session.read", "session.write"], 12);
    await setToolPluginEnabled(manifest.id, true, 13);
    expect(await listInstalledToolPlugins()).toMatchObject([{
      enabled: true,
      grantedPermissions: ["session.read", "session.write"],
    }]);
  });

  it("升级保留旧版本；回滚后停用并撤销全部权限", async () => {
    const v1 = await parseToolPluginManifest(JSON.stringify(await createToolPluginManifest()));
    const v2 = await parseToolPluginManifest(JSON.stringify(await createToolPluginManifest({ version: "2.0.0" })));
    await installToolPluginManifest(v1, 10);
    await setToolPluginPermissions(v1.id, ["session.read", "session.write"], 11);
    await setToolPluginEnabled(v1.id, true, 12);
    await installToolPluginManifest(v2, 20);

    const upgraded = (await listInstalledToolPlugins())[0];
    expect(upgraded.manifest.version).toBe("2.0.0");
    expect(upgraded.enabled).toBe(false);
    expect(upgraded.history[0].manifest.version).toBe("1.0.0");

    const rolledBack = await rollbackToolPlugin(v1.id, v1.contentHash, 30);
    expect(rolledBack.manifest.version).toBe("1.0.0");
    expect(rolledBack.enabled).toBe(false);
    expect(rolledBack.grantedPermissions).toEqual([]);
  });

  it("撤销必需权限会自动停用，卸载会删除全部版本记录", async () => {
    const manifest = await parseToolPluginManifest(JSON.stringify(await createToolPluginManifest()));
    await installToolPluginManifest(manifest);
    await setToolPluginPermissions(manifest.id, ["session.read", "session.write"]);
    await setToolPluginEnabled(manifest.id, true);
    const revoked = await setToolPluginPermissions(manifest.id, ["session.read"]);
    expect(revoked.enabled).toBe(false);

    await uninstallToolPlugin(manifest.id);
    expect(await listInstalledToolPlugins()).toEqual([]);
  });

  it("凭据加密分轨保存，只对宿主解析并在删除必需凭据时停用", async () => {
    const value = await createV2HttpManifest({
      credentials: [{ id: "api-key", label: "API Key", required: true, injection: { location: "header", name: "Authorization" } }],
    });
    const manifest = await parseToolPluginManifest(JSON.stringify(value));
    await installToolPluginManifest(manifest);
    await setToolPluginPermissions(manifest.id, ["network.request"]);
    await expect(setToolPluginEnabled(manifest.id, true)).rejects.toThrow("TOOL_PLUGIN_REQUIRED_CREDENTIAL_MISSING");
    await setToolPluginCredential(manifest.id, "api-key", "secret-value", 10);
    expect(await listToolPluginCredentialStatus(manifest.id)).toEqual([{ id: "api-key", configured: true, updatedAt: 10 }]);
    expect(await resolveToolPluginCredential(manifest.id, "api-key")).toBe("secret-value");
    await setToolPluginEnabled(manifest.id, true);
    await deleteToolPluginCredential(manifest.id, "api-key");
    expect((await listInstalledToolPlugins())[0].enabled).toBe(false);
  });
});
