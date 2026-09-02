import { zipSync } from "fflate";
import {
  computeToolPluginManifestHash,
  computeToolPluginPackageHash,
} from "../../../src/domain/toolPlugins";
import type { ToolPluginSourceProof } from "../../../src/domain/toolPlugins";
import { TOOL_PLUGIN_SOURCE_PROOF_PATH } from "../../../src/domain/toolPlugins";

export async function createToolPluginManifest(
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const hashable = {
    format: "mobile-tavern.tool-plugin",
    manifestVersion: 1,
    id: "example.session-tools",
    name: "会话助手",
    version: "1.0.0",
    description: "提供受控的会话整理能力。",
    author: "Example Studio",
    source: { label: "本地测试包", url: "https://example.com/tool" },
    runtime: { minVersion: "1.0.0", execution: "worker" },
    targetProfiles: ["mobile-tavern.base"],
    dependencies: [],
    permissions: [
      { id: "session.read", reason: "读取当前会话标题", riskLevel: "low" },
      { id: "session.write", reason: "整理会话标题", riskLevel: "medium" },
    ],
    tools: [{
      id: "example.session.rename",
      name: "整理会话标题",
      description: "根据当前内容生成并保存标题。",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: { title: { type: "string" } } },
      permissions: ["session.read", "session.write"],
      riskLevel: "medium",
      sideEffect: "local-write",
      executionScope: "session",
    }],
    cleanup: {
      onDisable: "revoke-runtime",
      onPermissionRevoke: "disable-dependent-tools",
      onUninstall: ["registrations", "credentials", "plugin-data"],
    },
    ...overrides,
  };
  return { ...hashable, contentHash: await computeToolPluginManifestHash(hashable) };
}

export async function createV2HttpManifest(
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return createToolPluginManifest({
    manifestVersion: 2,
    id: "example.weather",
    name: "天气连接器",
    description: "通过受控 HTTPS 请求查询天气。",
    runtime: { minVersion: "1.0.0", execution: "worker", timeoutMs: 5_000 },
    network: {
      allowedOrigins: ["https://api.example.com"],
      allowedMethods: ["GET"],
      maxRequestsPerCall: 2,
      maxRequestBytes: 4096,
      maxResponseBytes: 65536,
    },
    credentials: [{
      id: "api-key",
      label: "API Key",
      required: false,
      injection: { location: "header", name: "Authorization", prefix: "Bearer " },
    }],
    permissions: [{ id: "network.request", reason: "访问天气服务", riskLevel: "medium" }],
    tools: [{
      id: "weather.get",
      name: "查询天气",
      description: "查询指定城市天气。",
      inputSchema: {
        type: "object",
        properties: { city: { type: "string", minLength: 1 } },
        required: ["city"],
        additionalProperties: false,
      },
      outputSchema: { type: "object", properties: {}, additionalProperties: true },
      permissions: ["network.request"],
      riskLevel: "medium",
      sideEffect: "external",
      executionScope: "external",
      handler: { kind: "http", request: { method: "GET", url: "https://api.example.com/weather?city={{input.city}}" } },
    }],
    ...overrides,
  });
}

export async function createV2WorkerPackage(
  entryCode = `globalThis.MobileTavernToolPlugin = { tools: { echo: async (input) => ({ value: input.value }) } };`,
  sourceProof?: ToolPluginSourceProof,
  overrides: Record<string, unknown> = {},
): Promise<Uint8Array> {
  const entryBytes = new TextEncoder().encode(entryCode);
  const hashable = {
    format: "mobile-tavern.tool-plugin" as const,
    manifestVersion: 2 as const,
    id: "example.worker",
    name: "Worker 示例",
    version: "1.0.0",
    description: "在一次性 Worker 中执行示例 Tool。",
    author: "Example Studio",
    source: { label: "本地测试包" },
    runtime: { minVersion: "1.0.0", execution: "worker" as const, entry: "index.js", timeoutMs: 5_000 },
    targetProfiles: ["mobile-tavern.base"],
    dependencies: [],
    permissions: [],
    tools: [{
      id: "echo",
      name: "回显",
      description: "回显输入。",
      inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
      outputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
      permissions: [],
      riskLevel: "low" as const,
      sideEffect: "none" as const,
      executionScope: "turn" as const,
      handler: { kind: "worker" as const, exportName: "echo" },
    }],
    cleanup: {
      onDisable: "revoke-runtime" as const,
      onPermissionRevoke: "disable-dependent-tools" as const,
      onUninstall: ["registrations", "credentials", "plugin-data"] as const,
    },
    ...overrides,
  };
  const contentHash = await computeToolPluginPackageHash(hashable, { "index.js": entryBytes });
  const manifest = new TextEncoder().encode(JSON.stringify({ ...hashable, contentHash }));
  return zipSync({
    "manifest.json": manifest,
    "index.js": entryBytes,
    ...(sourceProof ? {
      [TOOL_PLUGIN_SOURCE_PROOF_PATH]: new TextEncoder().encode(JSON.stringify(sourceProof)),
    } : {}),
  });
}
