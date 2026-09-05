import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defineToolPluginHandlers,
  defineToolPluginManifest,
  registerToolPlugin,
} from "../../sdk/tool-plugin/src";
import type { ToolPluginWorkerHost } from "../../sdk/tool-plugin/src";
import {
  buildToolPluginPackage,
  createToolPluginPackage,
} from "../../sdk/tool-plugin/src/packageBuilder";
import { parseToolPluginPackage } from "../../src/domain/toolPlugins";

const manifest = defineToolPluginManifest({
  format: "mobile-tavern.tool-plugin",
  manifestVersion: 2,
  id: "example.sdk-test",
  name: "SDK 测试",
  version: "1.0.0",
  description: "验证 SDK 生成物与运行时契约一致。",
  author: "Mobile Tavern",
  source: { label: "SDK 测试" },
  runtime: { minVersion: "1.0.0", execution: "worker", entry: "index.js" },
  targetProfiles: ["mobile-tavern.base"],
  dependencies: [],
  permissions: [],
  tools: [{
    id: "echo",
    name: "回显",
    description: "回显输入文本。",
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
    permissions: [],
    riskLevel: "low",
    sideEffect: "none",
    executionScope: "turn",
    handler: { kind: "worker", exportName: "echo" },
  }],
  cleanup: {
    onDisable: "revoke-runtime",
    onPermissionRevoke: "disable-dependent-tools",
    onUninstall: ["registrations", "credentials", "plugin-data"],
  },
});

describe("Tool Plugin SDK", () => {
  it("生成可被运行时校验和解析的确定性 mttool 包", async () => {
    const entryCode = "globalThis.MobileTavernToolPlugin={tools:{echo:async input=>({value:input.value})}};";
    const first = createToolPluginPackage({ manifest, entryCode });
    const second = createToolPluginPackage({ manifest, entryCode });
    expect(first).toEqual(second);

    const inspection = await parseToolPluginPackage(first, 10);
    expect(inspection.manifest).toMatchObject({ id: "example.sdk-test", manifestVersion: 2 });
    expect(inspection.artifact?.entryCode).toContain("MobileTavernToolPlugin");
  });

  it("将 TypeScript Worker 入口编译为可安装包", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mobile-tavern-tool-sdk-"));
    const outputFile = join(directory, "sdk-test.mttool");
    try {
      await buildToolPluginPackage({
        manifest,
        entryPoint: resolve("tests/fixtures/toolPluginSdkEntry.ts"),
        outputFile,
      });
      const inspection = await parseToolPluginPackage(await readFile(outputFile));
      expect(inspection.manifest.id).toBe("example.sdk-test");
      expect(inspection.artifact?.entryCode).toContain("MobileTavernToolPlugin");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("注册冻结的 Worker handlers", async () => {
    const handlers = defineToolPluginHandlers({
      echo: async (
        input: { readonly value: string },
        _host: ToolPluginWorkerHost,
      ) => ({ value: input.value }),
    });
    registerToolPlugin(handlers);
    const registered = (globalThis as typeof globalThis & {
      MobileTavernToolPlugin?: { readonly tools: typeof handlers };
    }).MobileTavernToolPlugin;

    await expect(registered?.tools.echo({ value: "ok" }, {
      network: async () => { throw new Error("unexpected"); },
    })).resolves.toEqual({ value: "ok" });
    expect(Object.isFrozen(registered?.tools)).toBe(true);
  });
});

it("SDK 可选字段显式 undefined 时仍与归档 JSON 的哈希一致", async () => {
  const entryCode = "globalThis.MobileTavernToolPlugin={tools:{echo:input=>input}};";
  const archive = createToolPluginPackage({
    manifest: { ...manifest, source: { ...manifest.source, url: undefined }, network: undefined },
    entryCode,
  });
  const inspection = await parseToolPluginPackage(archive);
  expect(inspection.manifest.id).toBe(manifest.id);
});
