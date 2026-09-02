import type { ToolPluginInspection, ToolPluginManifest } from "../../domain/toolPlugins";
import { computeToolPluginManifestHash } from "../../domain/toolPlugins";

export const BRAVE_SEARCH_TOOL_PLUGIN_ID = "official.brave-search";
export const BRAVE_SEARCH_TOOL_NAME = `ext.${BRAVE_SEARCH_TOOL_PLUGIN_ID}.web.search`;
export const MEMORY_TOOL_PLUGIN_ID = "official.memory";
export const MEMORY_WRITE_TOOL_NAME = `ext.${MEMORY_TOOL_PLUGIN_ID}.memory.write`;
export const DEVICE_TIME_TOOL_PLUGIN_ID = "official.device-time";
export const DEVICE_TIME_TOOL_NAME = `ext.${DEVICE_TIME_TOOL_PLUGIN_ID}.system.time`;
export const UTILITY_TOOL_PLUGIN_ID = "official.utility";
export const UTILITY_DICE_TOOL_NAME = `ext.${UTILITY_TOOL_PLUGIN_ID}.random.dice`;
export const UTILITY_COIN_TOOL_NAME = `ext.${UTILITY_TOOL_PLUGIN_ID}.random.coin`;
export const UTILITY_PICK_TOOL_NAME = `ext.${UTILITY_TOOL_PLUGIN_ID}.random.pick`;
export const UTILITY_COUNT_TOOL_NAME = `ext.${UTILITY_TOOL_PLUGIN_ID}.text.count`;

const braveSearchManifest = {
  format: "mobile-tavern.tool-plugin",
  manifestVersion: 2,
  id: BRAVE_SEARCH_TOOL_PLUGIN_ID,
  name: "Brave 网页搜索",
  version: "1.0.0",
  description: "通过受控 Brave Search API 为 Agent 提供实时网页搜索；需要用户自行配置 API Key。",
  author: "Mobile Tavern",
  source: {
    label: "Mobile Tavern 官方预置",
    url: "https://github.com/zhengjie1399677/Mobile-Tavern",
  },
  runtime: {
    minVersion: "1.8.9",
    execution: "worker",
    timeoutMs: 15_000,
  },
  network: {
    allowedOrigins: ["https://api.search.brave.com"],
    allowedMethods: ["GET"],
    maxRequestsPerCall: 1,
    maxRequestBytes: 4_096,
    maxResponseBytes: 512 * 1_024,
  },
  credentials: [{
    id: "brave-api-key",
    label: "Brave Search API Key",
    required: true,
    injection: {
      location: "header",
      name: "X-Subscription-Token",
    },
  }],
  targetProfiles: ["*"],
  dependencies: [],
  permissions: [{
    id: "network.request",
    reason: "把搜索词发送到 Brave Search API 并读取网页搜索结果。",
    riskLevel: "medium",
  }],
  tools: [{
    id: "web.search",
    name: "网页搜索",
    description: "搜索公开网页并返回标题、链接和摘要。适合查询需要最新资料或外部事实的问题。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 400 },
        count: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["query", "count"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
    permissions: ["network.request"],
    riskLevel: "medium",
    sideEffect: "external",
    executionScope: "external",
    handler: {
      kind: "http",
      request: {
        method: "GET",
        url: "https://api.search.brave.com/res/v1/web/search?q={{input.query}}&count={{input.count}}&safesearch=moderate",
        headers: { Accept: "application/json" },
        credentialIds: ["brave-api-key"],
      },
    },
  }],
  cleanup: {
    onDisable: "revoke-runtime",
    onPermissionRevoke: "disable-dependent-tools",
    onUninstall: ["registrations", "credentials", "plugin-data"],
  },
} as const satisfies Omit<ToolPluginManifest, "contentHash">;

const memoryManifest = {
  format: "mobile-tavern.tool-plugin",
  manifestVersion: 2,
  id: MEMORY_TOOL_PLUGIN_ID,
  name: "长期记忆写入",
  version: "1.0.0",
  description: "让 Agent 在用户逐次确认后，把结构化事实写入当前会话的长期记忆。",
  author: "Mobile Tavern",
  source: {
    label: "Mobile Tavern 官方预置",
    url: "https://github.com/zhengjie1399677/Mobile-Tavern",
  },
  runtime: {
    minVersion: "1.8.9",
    execution: "worker",
    timeoutMs: 5_000,
  },
  targetProfiles: ["*"],
  dependencies: [],
  permissions: [{
    id: "memory.write",
    reason: "向当前会话的长期记忆写入一条可召回事实。",
    riskLevel: "high",
  }],
  tools: [{
    id: "memory.write",
    name: "写入长期记忆",
    description: "保存一条以后需要召回的事实。只在信息明确、长期有用且用户批准本次写入时使用。",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", minLength: 1, maxLength: 2_000 },
        participants: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 120 },
          maxItems: 16,
        },
        tags: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 120 },
          minItems: 1,
          maxItems: 24,
        },
        importance: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["content", "participants", "tags", "importance"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: { type: "string", enum: ["active"] },
        sourceMessageId: { type: "string" },
      },
      required: ["id", "status", "sourceMessageId"],
      additionalProperties: false,
    },
    permissions: ["memory.write"],
    riskLevel: "high",
    sideEffect: "local-write",
    executionScope: "memory",
    handler: { kind: "host", capability: "memory.write" },
  }],
  cleanup: {
    onDisable: "revoke-runtime",
    onPermissionRevoke: "disable-dependent-tools",
    onUninstall: ["registrations", "credentials", "plugin-data"],
  },
} as const satisfies Omit<ToolPluginManifest, "contentHash">;

const deviceTimeManifest = {
  format: "mobile-tavern.tool-plugin",
  manifestVersion: 2,
  id: DEVICE_TIME_TOOL_PLUGIN_ID,
  name: "设备日期时间",
  version: "1.0.0",
  description: "读取当前设备的本地日期、时间和时区；无需联网或申请权限。",
  author: "Mobile Tavern",
  source: {
    label: "Mobile Tavern 官方预置",
    url: "https://github.com/zhengjie1399677/Mobile-Tavern",
  },
  runtime: {
    minVersion: "1.8.9",
    execution: "worker",
    timeoutMs: 1_000,
  },
  targetProfiles: ["*"],
  dependencies: [],
  permissions: [],
  tools: [{
    id: "system.time",
    name: "当前设备时间",
    description: "读取当前设备的本地日期、时间和 IANA 时区，并生成可直接发送的文本。",
    inputSchema: {
      type: "object",
      properties: {},
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
    composerCommand: { name: "time", outputProperty: "text" },
    handler: { kind: "host", capability: "system.time" },
  }],
  cleanup: {
    onDisable: "revoke-runtime",
    onPermissionRevoke: "disable-dependent-tools",
    onUninstall: ["registrations", "credentials", "plugin-data"],
  },
} as const satisfies Omit<ToolPluginManifest, "contentHash">;

const utilityManifest = {
  format: "mobile-tavern.tool-plugin",
  manifestVersion: 2,
  id: UTILITY_TOOL_PLUGIN_ID,
  name: "本地实用工具",
  version: "1.0.0",
  description: "一批纯本地、无权限、无副作用的实用小工具，通过输入框命令直接生成可发送的文本草稿。",
  author: "Mobile Tavern",
  source: {
    label: "Mobile Tavern 官方预置",
    url: "https://github.com/zhengjie1399677/Mobile-Tavern",
  },
  runtime: {
    minVersion: "1.8.9",
    execution: "worker",
    timeoutMs: 1_000,
  },
  targetProfiles: ["*"],
  dependencies: [],
  permissions: [],
  tools: [{
    id: "random.dice",
    name: "掷骰子",
    description: "掷 NdM 骰子（如 2d6、1d20、3d6+2），返回每次结果与总和。",
    inputSchema: {
      type: "object",
      properties: { expression: { type: "string", minLength: 2, maxLength: 20 } },
      required: ["expression"],
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
    composerCommand: { name: "dice", inputProperty: "expression", outputProperty: "text" },
    handler: { kind: "host", capability: "random.dice" },
  }, {
    id: "random.coin",
    name: "掷硬币",
    description: "掷一枚硬币，返回正面或反面。",
    inputSchema: {
      type: "object",
      properties: {},
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
    composerCommand: { name: "coin", outputProperty: "text" },
    handler: { kind: "host", capability: "random.coin" },
  }, {
    id: "random.pick",
    name: "随机抽取",
    description: "从逗号分隔的多个选项中随机抽取一个。",
    inputSchema: {
      type: "object",
      properties: { options: { type: "string", minLength: 2, maxLength: 2_000 } },
      required: ["options"],
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
    composerCommand: { name: "pick", inputProperty: "options", outputProperty: "text" },
    handler: { kind: "host", capability: "random.pick" },
  }, {
    id: "text.count",
    name: "字数统计",
    description: "统计一段文本的字符数、非空白字符数、汉字数和行数。",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", minLength: 1, maxLength: 20_000 } },
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
    composerCommand: { name: "count", inputProperty: "text", outputProperty: "text" },
    handler: { kind: "host", capability: "text.count" },
  }],
  cleanup: {
    onDisable: "revoke-runtime",
    onPermissionRevoke: "disable-dependent-tools",
    onUninstall: ["registrations", "credentials", "plugin-data"],
  },
} as const satisfies Omit<ToolPluginManifest, "contentHash">;

export async function listOfficialToolPluginInspections(): Promise<ToolPluginInspection[]> {
  return Promise.all([braveSearchManifest, memoryManifest, deviceTimeManifest, utilityManifest].map(async (manifest) => ({
    manifest: structuredClone({
      ...manifest,
      contentHash: await computeToolPluginManifestHash(manifest),
    }) as ToolPluginManifest,
    sourceVerification: {
      trustLevel: "official",
      verificationMethod: "bundled",
      signerId: "mobile-tavern.bundled-catalog",
      signerLabel: "Mobile Tavern 内置目录",
    },
  })));
}
