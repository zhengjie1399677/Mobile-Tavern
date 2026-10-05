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

/** 配置来源端口；测试可注入内存实现，生产默认走独立 IndexedDB。 */
export interface ExternalSourceStorePort {
  list(): Promise<readonly ExternalCapabilitySource[]>;
  get(id: string): Promise<ExternalCapabilitySource | null>;
}

export interface ExternalSourceRuntimeDeps {
  readonly store?: ExternalSourceStorePort;
  /** 默认实现动态 import MCP driver；测试可注入确定性 driver。 */
  readonly loadDriver?: () => Promise<ConnectorDriver>;
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
    await this.reload();
  }

  async destroy(): Promise<void> {
    await this.disposeAll();
    this.kernel = null;
  }

  async reload(): Promise<void> {
    await this.disposeAll();
    const store = this.deps.store ?? (await defaultStore());
    const sources = await store.list();
    for (const source of sources) {
      if (!source.enabled) continue;
      try {
        await this.connectSource(source);
      } catch (error) {
        // 单个来源失败不影响其它来源，也不会让应用启动失败。
        this.failures[source.id] = error instanceof Error ? error.message : String(error);
      }
    }
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
    });
    try {
      return handle.snapshot;
    } finally {
      await handle.dispose();
    }
  }

  private async connectSource(source: ExternalCapabilitySource): Promise<void> {
    const runtime = this.getAgentRuntime();
    const driver = await this.loadDriver();
    const registry = createConnectorRegistry();
    registry.register(driver);
    const handle = await openExternalSource(source, {
      registry,
      timeoutMs: DEFAULT_CONNECTOR_TIMEOUT_MS,
    });
    const pending: EffectDisposer[] = [];
    try {
      for (const tool of handle.snapshot.tools) {
        const disposer = runtime.registerTool(
          this.createToolDefinition(source, tool, handle),
        );
        pending.push(disposer);
      }
      this.registrations.push(...pending);
      this.connections.set(source.id, {
        handle,
        version: handle.snapshot.serverVersion ?? "1.0.0",
        toolNames: handle.snapshot.tools.map((tool) => tool.qualifiedName),
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

  private async executeExternalTool(
    handle: OpenedExternalSource,
    sourceId: string,
    localName: string,
    input: unknown,
    context: AgentToolExecutionContext,
  ): Promise<unknown> {
    // 撤销即时生效：每次执行前重新确认来源仍然启用，不信任注册时的快照。
    const store = this.deps.store ?? (await defaultStore());
    const current = await store.get(sourceId);
    if (!current?.enabled) throw new Error("EXTERNAL_SOURCE_REVOKED");

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
