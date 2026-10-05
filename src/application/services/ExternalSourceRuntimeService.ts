/**
 * 外部能力源运行时服务。
 *
 * 职责：把已启用的外部能力源连起来，并把它们的工具投影成既有 `AgentToolDefinition`
 * 注册进 Agent Runtime。协议细节全部留在 infrastructure；本服务只消费中立契约。
 *
 * 懒加载：只有存在已启用来源时才会动态 import 协议 driver，未配置来源的用户
 * 不会为 MCP SDK 付出任何体积与启动成本。
 */
import { z } from "zod";
import type { EffectDisposer, IKernel } from "../../kernel/types";
import type {
  AgentCompositionSnapshot,
  AgentToolDefinition,
  AgentToolExecutionContext,
} from "../../domain/agents/contracts";
import {
  DEFAULT_CONNECTOR_TIMEOUT_MS,
  DEFAULT_EXTERNAL_TOOL_TIMEOUT_MS,
  buildExternalSourceAuthHeaders,
  externalSourceCredentialKey,
  type ConnectorDriver,
  type ExternalCapabilitySnapshot,
  type ExternalCapabilitySource,
  type ExternalSourceRuntimeDiagnostics,
  type ExternalToolDescriptor,
} from "../../domain/externalSources/contracts";
import { createConnectorRegistry } from "../../domain/externalSources/registry";
import { createExternalValueSchema } from "../../domain/externalSources/schemaBounds";
import {
  openExternalSource,
  type OpenedExternalSource,
} from "../externalSources/externalSourceService";
import { readAgentSettingsFromComposition } from "../runtimeProfiles/agentSettings";
import {
  KernelServices,
  type IAgentRuntimeService,
  type IExternalSourceRuntimeService,
} from "../serviceContracts";

const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const MAX_PROMPT_TEXT_LENGTH = 200_000;
/** 派生资源工具的本地名；与来源自带工具重名时跳过派生，避免第二条访问路径。 */
export const RESOURCES_LIST_LOCAL_NAME = "resources.list";
export const RESOURCES_READ_LOCAL_NAME = "resources.read";
/** 启动期的单来源连接预算：宁可先标记失败，也不让应用启动被远端拖住。 */
const BOOTSTRAP_CONNECT_TIMEOUT_MS = 4_000;

/** 配置来源端口；测试可注入内存实现，生产默认走独立 IndexedDB。 */
export interface ExternalSourceStorePort {
  list(): Promise<readonly ExternalCapabilitySource[]>;
  get(id: string): Promise<ExternalCapabilitySource | null>;
}

export interface ExternalSourceRuntimeDeps {
  readonly store?: ExternalSourceStorePort;
  /** 默认实现动态 import MCP driver；测试可注入确定性 driver。 */
  readonly loadDriver?: () => Promise<ConnectorDriver>;
  /** 解析来源静态凭据为请求头；默认走独立加密凭据库，测试可注入。 */
  readonly resolveAuthHeaders?: (
    source: ExternalCapabilitySource,
  ) => Promise<Readonly<Record<string, string>> | undefined>;
}

interface ConnectedEntry {
  readonly handle: OpenedExternalSource;
  readonly toolNames: readonly string[];
  readonly version: string;
}

async function defaultLoadDriver(): Promise<ConnectorDriver> {
  const module = await import("../../infrastructure/externalSources/mcp/mcpConnectorDriver");
  return module.createMcpConnectorDriver();
}

async function defaultStore(): Promise<ExternalSourceStorePort> {
  const module = await import("../../infrastructure/externalSources/externalSourceStorage");
  return {
    list: () => module.listExternalSources(),
    get: (id) => module.getExternalSource(id),
  };
}

async function defaultResolveAuthHeaders(
  source: ExternalCapabilitySource,
): Promise<Readonly<Record<string, string>> | undefined> {
  const module = await import("../../infrastructure/externalSources/externalSourceStorage");
  const secret = await module.resolveExternalSourceCredential(externalSourceCredentialKey(source));
  return buildExternalSourceAuthHeaders(source, secret);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 把 MCP 内容块压平成模型可消费的文本；非文本块只保留类型占位。 */
export function flattenExternalContent(content: readonly unknown[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      parts.push(record.text);
      continue;
    }
    if (typeof record.type === "string") parts.push(`[${record.type}]`);
  }
  const text = parts.join("\n");
  return text.length > MAX_PROMPT_TEXT_LENGTH ? `${text.slice(0, MAX_PROMPT_TEXT_LENGTH)}…` : text;
}

export class ExternalSourceRuntimeService implements IExternalSourceRuntimeService {
  readonly name = KernelServices.ExternalSources;
  readonly isCritical = false;
  readonly dependencies = [KernelServices.AgentRuntime] as const;

  private kernel: IKernel | null = null;
  private registrations: EffectDisposer[] = [];
  private readonly connections = new Map<string, ConnectedEntry>();
  private failures: Record<string, string> = {};

  constructor(private readonly deps: ExternalSourceRuntimeDeps = {}) {}

  async init(kernel: IKernel): Promise<void> {
    this.kernel = kernel;
    await this.reload(BOOTSTRAP_CONNECT_TIMEOUT_MS);
  }

  async destroy(): Promise<void> {
    await this.disposeAll();
    this.kernel = null;
  }

  /** 重新连接所有已启用来源；来源之间并行，单个失败只记录不抛出。 */
  async reload(connectTimeoutMs = DEFAULT_CONNECTOR_TIMEOUT_MS): Promise<void> {
    await this.disposeAll();
    const store = this.deps.store ?? (await defaultStore());
    const enabled = (await store.list()).filter((source) => source.enabled);
    const settled = await Promise.allSettled(
      enabled.map((source) => this.connectSource(source, connectTimeoutMs)),
    );
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") return;
      const source = enabled[index];
      this.failures[source.id] =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
    });
  }

  getEnabledToolNames(_profileId: string): string[] {
    return [...this.connections.values()].flatMap((entry) => [...entry.toolNames]);
  }

  extendComposition(snapshot: AgentCompositionSnapshot): AgentCompositionSnapshot {
    const selected = readAgentSettingsFromComposition(snapshot)?.toolMounts.map((tool) => tool.name);
    const toolNames = this.getEnabledToolNames(snapshot.profileId)
      .filter((name) => selected === undefined || selected.includes(name));
    if (toolNames.length === 0) return snapshot;
    const pluginVersions = { ...snapshot.pluginVersions };
    for (const [sourceId, entry] of this.connections) {
      if (entry.toolNames.some((name) => toolNames.includes(name))) {
        pluginVersions[`external-source/${sourceId}`] = entry.version;
      }
    }
    return {
      ...snapshot,
      pluginVersions,
      contributionOrder: {
        ...snapshot.contributionOrder,
        tool: [...new Set([...(snapshot.contributionOrder.tool ?? []), ...toolNames])],
      },
    };
  }

  getDiagnostics(): ExternalSourceRuntimeDiagnostics {
    return {
      connectedSources: [...this.connections.keys()].sort(),
      registeredTools: this.getEnabledToolNames("").sort(),
      failures: { ...this.failures },
    };
  }

  async probe(sourceId: string): Promise<ExternalCapabilitySnapshot> {
    const store = this.deps.store ?? (await defaultStore());
    const source = await store.get(sourceId);
    if (!source) throw new Error("EXTERNAL_SOURCE_NOT_FOUND");
    const driver = await this.loadDriver();
    const registry = createConnectorRegistry();
    registry.register(driver);
    const handle = await openExternalSource(source, {
      registry,
      timeoutMs: DEFAULT_CONNECTOR_TIMEOUT_MS,
      deps: { authHeaders: await this.resolveAuthHeaders(source) },
    });
    try {
      return handle.snapshot;
    } finally {
      await handle.dispose();
    }
  }

  private async connectSource(
    source: ExternalCapabilitySource,
    connectTimeoutMs: number,
  ): Promise<void> {
    const runtime = this.getAgentRuntime();
    const driver = await this.loadDriver();
    const registry = createConnectorRegistry();
    registry.register(driver);
    const handle = await openExternalSource(source, {
      registry,
      timeoutMs: connectTimeoutMs,
      deps: { authHeaders: await this.resolveAuthHeaders(source) },
    });
    const pending: EffectDisposer[] = [];
    try {
      for (const tool of handle.snapshot.tools) {
        const disposer = runtime.registerTool(
          this.createToolDefinition(source, tool, handle),
        );
        pending.push(disposer);
      }
      const resourceTools = this.createResourceTools(source, handle);
      for (const tool of resourceTools) {
        pending.push(runtime.registerTool(tool));
      }
      this.registrations.push(...pending);
      this.connections.set(source.id, {
        handle,
        version: handle.snapshot.serverVersion ?? "1.0.0",
        toolNames: [
          ...handle.snapshot.tools.map((tool) => tool.qualifiedName),
          ...resourceTools.map((tool) => tool.name),
        ],
      });
    } catch (error) {
      for (const dispose of pending.reverse()) await dispose();
      await handle.dispose().catch(() => undefined);
      throw error;
    }
  }

  private createToolDefinition(
    source: ExternalCapabilitySource,
    tool: ExternalToolDescriptor,
    handle: OpenedExternalSource,
  ): AgentToolDefinition {
    const sourceId = source.id;
    const localName = tool.localName;
    return {
      name: tool.qualifiedName,
      version: "1.0.0",
      description: tool.description || `外部能力源 ${source.displayName} 提供的工具`,
      inputSchema: createExternalValueSchema(tool.inputSchema),
      inputJsonSchema: tool.inputSchema,
      outputSchema: z.unknown(),
      permissions: [`external.source.${sourceId}`],
      // 外部能力默认不视为只读：风险未知，授权一律走单次审批。
      riskLevel: "medium",
      sideEffect: "external",
      executionScope: "external",
      policy: "ask",
      timeoutMs: DEFAULT_EXTERNAL_TOOL_TIMEOUT_MS,
      execute: (input, context) => this.executeExternalTool(handle, sourceId, localName, input, context),
    };
  }

  /**
   * 资源访问只走工具这条路径（用户/模型决定取用），不额外注入上下文。
   * 读取白名单 = 连接时 server 自己声明的资源列表，模型无法让宿主去抓任意 URI。
   */
  private createResourceTools(
    source: ExternalCapabilitySource,
    handle: OpenedExternalSource,
  ): AgentToolDefinition[] {
    if (handle.snapshot.resources.length === 0) return [];
    const existing = new Set(handle.snapshot.tools.map((tool) => tool.localName));
    if (existing.has(RESOURCES_LIST_LOCAL_NAME) || existing.has(RESOURCES_READ_LOCAL_NAME)) {
      return [];
    }
    const sourceId = source.id;
    const prefix = `${source.kind}.${sourceId}`;
    const listTool: AgentToolDefinition = {
      name: `${prefix}.${RESOURCES_LIST_LOCAL_NAME}`,
      version: "1.0.0",
      description: `列出外部能力源 ${source.displayName} 声明的资源（只读元数据，不读取内容）。`,
      inputSchema: z.object({}).strict(),
      inputJsonSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      outputSchema: z.unknown(),
      permissions: [`external.source.${sourceId}`],
      riskLevel: "low",
      sideEffect: "none",
      executionScope: "external",
      policy: "allow",
      timeoutMs: DEFAULT_EXTERNAL_TOOL_TIMEOUT_MS,
      execute: async (_input, context) => {
        await this.assertSourceActive(sourceId);
        return {
          resources: handle.snapshot.resources.map((resource) => ({
            uri: resource.uri,
            name: resource.name,
            mimeType: resource.mimeType ?? null,
            description: resource.description || null,
          })),
        };
      },
    };
    const readTool: AgentToolDefinition = {
      name: `${prefix}.${RESOURCES_READ_LOCAL_NAME}`,
      version: "1.0.0",
      description: `读取外部能力源 ${source.displayName} 已声明资源的内容；只允许读取 resources.list 返回过的 URI。`,
      inputSchema: z.object({ uri: z.string().min(1).max(2048) }).strict(),
      inputJsonSchema: {
        type: "object",
        properties: { uri: { type: "string", maxLength: 2048 } },
        required: ["uri"],
        additionalProperties: false,
      },
      outputSchema: z.unknown(),
      permissions: [`external.source.${sourceId}`],
      riskLevel: "medium",
      sideEffect: "external",
      executionScope: "external",
      policy: "ask",
      timeoutMs: DEFAULT_EXTERNAL_TOOL_TIMEOUT_MS,
      execute: (input, context) => this.readExternalResource(handle, sourceId, input, context),
    };
    return [listTool, readTool];
  }

  private async readExternalResource(
    handle: OpenedExternalSource,
    sourceId: string,
    input: unknown,
    context: AgentToolExecutionContext,
  ): Promise<unknown> {
    await this.assertSourceActive(sourceId);
    const uri = isRecord(input) ? input.uri : undefined;
    if (typeof uri !== "string") throw new Error("EXTERNAL_SOURCE_RESOURCE_URI_INVALID");
    if (!handle.snapshot.resources.some((resource) => resource.uri === uri)) {
      throw new Error("EXTERNAL_SOURCE_RESOURCE_NOT_ADVERTISED");
    }
    const controller = new AbortController();
    const relayAbort = () => controller.abort(context.signal.reason);
    if (context.signal.aborted) relayAbort();
    else context.signal.addEventListener("abort", relayAbort, { once: true });
    try {
      const content = await handle.connected.readResource(uri, {
        signal: controller.signal,
        timeoutMs: DEFAULT_EXTERNAL_TOOL_TIMEOUT_MS,
      });
      const text = content.text ?? "";
      const projected = {
        uri: content.uri,
        mimeType: content.mimeType ?? null,
        text: text.length > MAX_PROMPT_TEXT_LENGTH ? `${text.slice(0, MAX_PROMPT_TEXT_LENGTH)}…` : text,
      };
      if (new TextEncoder().encode(JSON.stringify(projected) ?? "null").byteLength > MAX_RESULT_BYTES) {
        throw new Error("EXTERNAL_SOURCE_RESULT_TOO_LARGE");
      }
      return projected;
    } finally {
      context.signal.removeEventListener("abort", relayAbort);
    }
  }

  private async assertSourceActive(sourceId: string): Promise<void> {
    const store = this.deps.store ?? (await defaultStore());
    const current = await store.get(sourceId);
    if (!current?.enabled) throw new Error("EXTERNAL_SOURCE_REVOKED");
  }

  private async executeExternalTool(
    handle: OpenedExternalSource,
    sourceId: string,
    localName: string,
    input: unknown,
    context: AgentToolExecutionContext,
  ): Promise<unknown> {
    // 撤销即时生效：每次执行前重新确认来源仍然启用，不信任注册时的快照。
    await this.assertSourceActive(sourceId);

    const controller = new AbortController();
    const relayAbort = () => controller.abort(context.signal.reason);
    if (context.signal.aborted) relayAbort();
    else context.signal.addEventListener("abort", relayAbort, { once: true });
    const timeout = setTimeout(() => {
      controller.abort(new Error("EXTERNAL_SOURCE_TOOL_TIMEOUT"));
    }, DEFAULT_EXTERNAL_TOOL_TIMEOUT_MS);
    try {
      const result = await handle.connected.callTool(localName, input, {
        signal: controller.signal,
        timeoutMs: DEFAULT_EXTERNAL_TOOL_TIMEOUT_MS,
      });
      const projected = {
        isError: result.isError,
        text: flattenExternalContent(result.content),
        structuredContent: result.structuredContent ?? null,
      };
      if (new TextEncoder().encode(JSON.stringify(projected) ?? "null").byteLength > MAX_RESULT_BYTES) {
        throw new Error("EXTERNAL_SOURCE_RESULT_TOO_LARGE");
      }
      return projected;
    } finally {
      clearTimeout(timeout);
      context.signal.removeEventListener("abort", relayAbort);
    }
  }

  private async loadDriver(): Promise<ConnectorDriver> {
    return this.deps.loadDriver ? this.deps.loadDriver() : defaultLoadDriver();
  }

  private async resolveAuthHeaders(
    source: ExternalCapabilitySource,
  ): Promise<Readonly<Record<string, string>> | undefined> {
    return this.deps.resolveAuthHeaders
      ? this.deps.resolveAuthHeaders(source)
      : defaultResolveAuthHeaders(source);
  }

  private getAgentRuntime(): IAgentRuntimeService {
    if (!this.kernel) throw new Error("EXTERNAL_SOURCE_RUNTIME_NOT_ACTIVE");
    return this.kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime);
  }

  private async disposeAll(): Promise<void> {
    const disposers = this.registrations.splice(0).reverse();
    const handles = [...this.connections.values()].map((entry) => entry.handle);
    this.connections.clear();
    this.failures = {};
    await Promise.allSettled(disposers.map((dispose) => dispose()));
    await Promise.allSettled(handles.map((handle) => handle.dispose()));
  }
}
