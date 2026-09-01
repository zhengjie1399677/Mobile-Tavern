import { defineToolPluginManifest } from "../../sdk/tool-plugin/src";

export const textToolkitManifest = defineToolPluginManifest({
  format: "mobile-tavern.tool-plugin",
  manifestVersion: 2,
  id: "example.text-toolkit",
  name: "文本工具箱示例",
  version: "1.0.0",
  description: "演示如何使用官方 SDK 构建无权限、无副作用的 Worker Tool Plugin。",
  author: "Mobile Tavern",
  source: {
    label: "Mobile Tavern 官方示例",
    url: "https://github.com/zhengjie1399677/Mobile-Tavern/tree/main/examples/tool-plugin-text-toolkit",
  },
  runtime: {
    minVersion: "1.0.0",
    execution: "worker",
    entry: "index.js",
    timeoutMs: 5_000,
  },
  targetProfiles: ["*"],
  dependencies: [],
  permissions: [],
  tools: [
    {
      id: "text.stats",
      name: "统计文本",
      description: "统计 Unicode 字符、非空单词和文本行数。",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string", maxLength: 100_000 } },
        required: ["text"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          characters: { type: "integer", minimum: 0 },
          words: { type: "integer", minimum: 0 },
          lines: { type: "integer", minimum: 0 },
        },
        required: ["characters", "words", "lines"],
        additionalProperties: false,
      },
      permissions: [],
      riskLevel: "low",
      sideEffect: "none",
      executionScope: "turn",
      handler: { kind: "worker", exportName: "textStats" },
    },
    {
      id: "text.normalize-whitespace",
      name: "整理文本空白",
      description: "统一换行符、移除行尾空白，并把连续空行压缩为一行。",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string", maxLength: 100_000 } },
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
      handler: { kind: "worker", exportName: "normalizeWhitespace" },
    },
  ],
  cleanup: {
    onDisable: "revoke-runtime",
    onPermissionRevoke: "disable-dependent-tools",
    onUninstall: ["registrations", "credentials", "plugin-data"],
  },
});
