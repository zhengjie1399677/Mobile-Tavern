import { describe, expect, it } from "vitest";
import {
  parseToolPluginPackage,
  TOOL_PLUGIN_SOURCE_PROOF_ALGORITHM,
  TOOL_PLUGIN_SOURCE_PROOF_FORMAT,
} from "../../src/domain/toolPlugins";
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

  it("提取保留的来源证明且不让签名参与循环内容哈希", async () => {
    const sourceProof = {
      format: TOOL_PLUGIN_SOURCE_PROOF_FORMAT,
      proofVersion: 1,
      plugin: {
        id: "example.worker",
        version: "1.0.0",
        contentHash: `sha256:${"a".repeat(64)}`,
      },
      signer: {
        id: "example.publisher",
        publicKey: { format: "spki", value: "A".repeat(120) },
      },
      algorithm: TOOL_PLUGIN_SOURCE_PROOF_ALGORITHM,
      signature: "B".repeat(86),
    } as const;
    const inspection = await parseToolPluginPackage(await createV2WorkerPackage(undefined, sourceProof));
    expect(inspection.sourceProof).toEqual(sourceProof);
    expect(inspection.artifact?.sourceProof).toEqual(sourceProof);
  });
});
