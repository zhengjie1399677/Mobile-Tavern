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

  it("拒绝把 memory.write Host Capability 降低风险或伪装成无副作用 Tool", async () => {
    const manifest = await createToolPluginManifest({
      manifestVersion: 2,
      permissions: [{ id: "memory.write", reason: "写入长期记忆", riskLevel: "high" }],
      tools: [{
        id: "memory.write",
        name: "写入长期记忆",
        description: "写入一条长期记忆。",
        inputSchema: { type: "object", properties: {} },
        outputSchema: { type: "object", properties: {} },
        permissions: ["memory.write"],
        riskLevel: "medium",
        sideEffect: "none",
        executionScope: "turn",
        handler: { kind: "host", capability: "memory.write" },
      }],
    });
    await expect(parseToolPluginManifest(JSON.stringify(manifest)))
      .rejects.toThrow("必须是高风险、本地写入和 memory Scope");
  });

  it("允许低风险无副作用 Tool 声明输入框斜杠命令", async () => {
    const manifest = await createToolPluginManifest({
      manifestVersion: 2,
      runtime: { minVersion: "1.0.0", execution: "worker", entry: "index.js" },
      permissions: [],
      tools: [{
        id: "text.echo",
        name: "回填文本",
        description: "把文本回填到输入框。",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false,
        },
        permissions: [],
        riskLevel: "low",
        sideEffect: "none",
        executionScope: "turn",
        composerCommand: { name: "echo", inputProperty: "text", outputProperty: "text" },
        handler: { kind: "worker", exportName: "echo" },
      }],
    });

    await expect(parseToolPluginManifest(JSON.stringify(manifest))).resolves.toMatchObject({
      tools: [{ composerCommand: { name: "echo", inputProperty: "text", outputProperty: "text" } }],
    });
  });

  it("拒绝让有权限或副作用的 Tool 暴露输入框命令", async () => {
    const manifest = await createToolPluginManifest({
      manifestVersion: 2,
      runtime: { minVersion: "1.0.0", execution: "worker", entry: "index.js" },
      tools: [{
        id: "session.rename",
        name: "修改会话",
        description: "修改会话标题。",
        inputSchema: { type: "object", properties: {} },
        outputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
        permissions: ["session.write"],
        riskLevel: "medium",
        sideEffect: "local-write",
        executionScope: "session",
        composerCommand: { name: "rename", outputProperty: "text" },
        handler: { kind: "worker", exportName: "rename" },
      }],
    });

    await expect(parseToolPluginManifest(JSON.stringify(manifest)))
      .rejects.toThrow("只能绑定低风险、无副作用、无权限");
  });
});
