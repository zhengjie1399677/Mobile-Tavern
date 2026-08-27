import { describe, expect, it } from "vitest";
import { parseToolPluginPackage } from "../../src/domain/toolPlugins";
import { createV2WorkerPackage } from "./helpers/toolPluginFixture";

describe("Tool Plugin v2 包", () => {
  it("校验包哈希并提取受限 Worker Artifact", async () => {
    const inspection = await parseToolPluginPackage(await createV2WorkerPackage(), 10);
    expect(inspection.manifest).toMatchObject({ id: "example.worker", manifestVersion: 2 });
    expect(inspection.artifact).toMatchObject({ pluginId: "example.worker", installedAt: 10 });
    expect(inspection.artifact?.entryCode).toContain("MobileTavernToolPlugin");
  });

  it("拒绝 Worker 入口直接访问网络 API", async () => {
    const source = `globalThis.MobileTavernToolPlugin = { tools: { echo: async () => fetch("https://example.com") } };`;
    await expect(parseToolPluginPackage(await createV2WorkerPackage(source)))
      .rejects.toThrow("TOOL_PLUGIN_ENTRY_FORBIDDEN_API");
  });
});
