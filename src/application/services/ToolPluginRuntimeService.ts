import { compareVersions } from "compare-versions";
import type { EffectDisposer, IKernel } from "../../kernel/types";
import type { AgentCompositionSnapshot, AgentToolExecutionContext } from "../../domain/agents/contracts";
import {
  createToolPluginValueSchema,
  type InstalledToolPlugin,
  type ToolPluginComposerCommand,
  type ToolPluginComposerCommandExecution,
  type ToolPluginHttpRequestTemplate,
  type ToolPluginManifest,
  type ToolPluginRuntimeDiagnostics,
  type ToolPluginToolDeclaration,
} from "../../domain/toolPlugins";
import {
  deleteToolPluginCredential,
  getInstalledToolPlugin,
  getToolPluginArtifact,
  listInstalledToolPlugins,
  listToolPluginCredentialStatus,
  resolveToolPluginCredential,
  setToolPluginCredential,
} from "../../infrastructure/toolPlugins/toolPluginStorage";
import { BrowserToolPluginExecutor } from "../../infrastructure/toolPlugins/browserToolPluginExecutor";
import { ToolPluginHttpClient } from "../../infrastructure/toolPlugins/toolPluginHttpClient";
import type {
  ToolPluginHttpPort,
  ToolPluginNetworkRequest,
  ToolPluginWorkerPort,
} from "../toolPlugins/executionContracts";
import {
  KernelServices,
  type IAgentRuntimeService,
  type IToolPluginRuntimeService,
} from "../serviceContracts";
import { readAgentSettingsFromComposition } from "../runtimeProfiles/agentSettings";
import type { MemoryServiceTyped } from "./memory";
import { executeToolPluginHostCapability } from "../toolPlugins/hostCapabilityExecutor";

const OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024;

interface RegisteredTool {
  readonly pluginId: string;
  readonly profileIds: readonly string[];
  readonly version: string;
}

interface RegisteredComposerCommand {
  readonly plugin: InstalledToolPlugin;
  readonly tool: ToolPluginToolDeclaration;
  readonly entryCode?: string;
  readonly toolName: string;
  readonly profileIds: readonly string[];
}

export class ToolPluginRuntimeService implements IToolPluginRuntimeService {
  readonly name = KernelServices.ToolConnectors;
  readonly isCritical = false;
  readonly dependencies = [KernelServices.AgentRuntime, KernelServices.Memory] as const;

  private kernel: IKernel | null = null;
  private registrations: EffectDisposer[] = [];
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly composerCommands = new Map<string, RegisteredComposerCommand>();
  private failures: Record<string, string> = {};

  constructor(
    private readonly http: ToolPluginHttpPort = new ToolPluginHttpClient(),
    private readonly worker: ToolPluginWorkerPort = new BrowserToolPluginExecutor(),
  ) {}

  async init(kernel: IKernel): Promise<void> {
    this.kernel = kernel;
    await this.reload();
  }

  async destroy(): Promise<void> {
    await this.disposeRegistrations();
    this.worker.destroy();
    this.kernel = null;
  }

  async reload(): Promise<void> {
    await this.disposeRegistrations();
    this.failures = {};
    const installed = await listInstalledToolPlugins();
    const runtime = this.getAgentRuntime();
    for (const plugin of installed) {
      if (!plugin.enabled || plugin.manifest.manifestVersion !== 2) continue;
      try {
        await this.registerPlugin(plugin, installed, runtime);
      } catch (error) {
        this.failures[plugin.id] = normalizeError(error);
      }
    }
  }

  getEnabledToolNames(profileId: string): string[] {
    return [...this.tools.entries()]
      .filter(([, tool]) => tool.profileIds.includes("*") || tool.profileIds.includes(profileId))
      .map(([name]) => name)
      .sort();
  }

  listComposerCommands(profileId: string): ToolPluginComposerCommand[] {
    return [...this.composerCommands.entries()]
      .filter(([, command]) => command.profileIds.includes("*") || command.profileIds.includes(profileId))
      .map(([name, command]) => ({
        name,
        label: command.tool.name,
        description: command.tool.description,
        pluginId: command.plugin.id,
        toolName: command.toolName,
        acceptsArgument: command.tool.composerCommand?.inputProperty !== undefined,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async executeComposerCommand(execution: ToolPluginComposerCommandExecution): Promise<string> {
    const name = execution.name.trim().toLowerCase();
    const registered = this.composerCommands.get(name);
    if (!registered) throw new Error("TOOL_PLUGIN_COMPOSER_COMMAND_NOT_FOUND");
    if (!registered.profileIds.includes("*") && !registered.profileIds.includes(execution.profileId)) {
      throw new Error("TOOL_PLUGIN_COMPOSER_COMMAND_PROFILE_UNAVAILABLE");
    }
    const declaration = registered.tool.composerCommand;
    if (!declaration) throw new Error("TOOL_PLUGIN_COMPOSER_COMMAND_INVALID");
    const argument = execution.argument.trim();
    if (!declaration.inputProperty && argument) {
      throw new Error("TOOL_PLUGIN_COMPOSER_COMMAND_ARGUMENT_UNSUPPORTED");
    }
    if (declaration.inputProperty && !argument) {
      throw new Error("TOOL_PLUGIN_COMPOSER_COMMAND_ARGUMENT_REQUIRED");
    }
    const input = declaration.inputProperty ? { [declaration.inputProperty]: argument } : {};
    const parsedInput = await createToolPluginValueSchema(registered.tool.inputSchema).parseAsync(input);
    const controller = new AbortController();
    const relayAbort = () => controller.abort(execution.signal?.reason);
    if (execution.signal?.aborted) relayAbort();
    else execution.signal?.addEventListener("abort", relayAbort, { once: true });
    const timeout = setTimeout(() => {
      controller.abort(new Error("TOOL_PLUGIN_COMPOSER_COMMAND_TIMEOUT"));
    }, registered.plugin.manifest.runtime.timeoutMs ?? 15_000);
    try {
      const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
      const rawResult = await this.executeTool(
        registered.plugin,
        registered.tool,
        registered.entryCode,
        parsedInput,
        {
          sessionId: execution.sessionId,
          turnId: `composer-${nonce}`,
          callId: `composer-call-${nonce}`,
          signal: controller.signal,
        },
      );
      const result = await createToolPluginValueSchema(registered.tool.outputSchema).parseAsync(rawResult);
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new Error("TOOL_PLUGIN_COMPOSER_COMMAND_OUTPUT_INVALID");
      }
      const text = (result as Record<string, unknown>)[declaration.outputProperty];
      if (typeof text !== "string") throw new Error("TOOL_PLUGIN_COMPOSER_COMMAND_OUTPUT_INVALID");
      return text;
    } finally {
      clearTimeout(timeout);
      execution.signal?.removeEventListener("abort", relayAbort);
    }
  }

  extendComposition(snapshot: AgentCompositionSnapshot): AgentCompositionSnapshot {
    const selectedTools = readAgentSettingsFromComposition(snapshot)?.toolMounts;
    const selectedByName = selectedTools
      ? new Map(selectedTools.map((tool) => [tool.name, tool.version]))
      : null;
    const toolNames = this.getEnabledToolNames(snapshot.profileId)
      .filter((name) => {
        if (!selectedByName) return true;
        if (!selectedByName.has(name)) return false;
        const requestedVersion = selectedByName.get(name);
        return requestedVersion === undefined || this.tools.get(name)?.version === requestedVersion;
      });
    if (toolNames.length === 0) return snapshot;
    const versions = { ...snapshot.pluginVersions };
    for (const toolName of toolNames) {
      const tool = this.tools.get(toolName);
      if (tool) versions[`tool-plugin/${tool.pluginId}`] = tool.version;
    }
    return {
      ...snapshot,
      pluginVersions: versions,
      contributionOrder: {
        ...snapshot.contributionOrder,
        tool: [...new Set([...(snapshot.contributionOrder.tool ?? []), ...toolNames])],
      },
    };
  }

  getDiagnostics(): ToolPluginRuntimeDiagnostics {
    return {
      registeredPlugins: [...new Set([...this.tools.values()].map((item) => item.pluginId))].sort(),
      registeredTools: [...this.tools.keys()].sort(),
      activeWorkers: this.worker.getActiveWorkerCount(),
      failures: { ...this.failures },
    };
  }

  listCredentialStatus(pluginId: string) { return listToolPluginCredentialStatus(pluginId); }

  async setCredential(pluginId: string, credentialId: string, value: string): Promise<void> {
    await setToolPluginCredential(pluginId, credentialId, value);
    await this.reload();
  }

  async deleteCredential(pluginId: string, credentialId: string): Promise<void> {
    await deleteToolPluginCredential(pluginId, credentialId);
    await this.reload();
  }

  private async registerPlugin(
    plugin: InstalledToolPlugin,
    installed: readonly InstalledToolPlugin[],
    runtime: IAgentRuntimeService,
  ): Promise<void> {
    assertCompatible(plugin, installed);
    const statuses = await listToolPluginCredentialStatus(plugin.id);
    const configured = new Set(statuses.filter((item) => item.configured).map((item) => item.id));
    if (plugin.manifest.credentials?.some((item) => item.required && !configured.has(item.id))) {
      throw new Error("TOOL_PLUGIN_REQUIRED_CREDENTIAL_MISSING");
    }
    const artifact = await getToolPluginArtifact(plugin.manifest.contentHash);
    const pending: EffectDisposer[] = [];
    try {
      for (const tool of plugin.manifest.tools) {
        if (!tool.permissions.every((permission) => plugin.grantedPermissions.includes(permission))) continue;
        const name = toolName(plugin.id, tool.id);
        const disposer = runtime.registerTool({
          name,
          version: plugin.manifest.version,
          description: tool.description,
          inputSchema: createToolPluginValueSchema(tool.inputSchema),
          inputJsonSchema: tool.inputSchema,
          outputSchema: createToolPluginValueSchema(tool.outputSchema),
          permissions: tool.permissions,
          riskLevel: tool.riskLevel,
          sideEffect: tool.sideEffect,
          executionScope: tool.executionScope,
          policy: "ask",
          timeoutMs: plugin.manifest.runtime.timeoutMs ?? 15_000,
          execute: (input, context) => this.executeTool(plugin, tool, artifact?.entryCode, input, context),
        });
        pending.push(disposer);
        this.tools.set(name, { pluginId: plugin.id, profileIds: plugin.manifest.targetProfiles, version: plugin.manifest.version });
        const command = tool.composerCommand;
        if (command) {
          if (this.composerCommands.has(command.name)) {
            throw new Error(`TOOL_PLUGIN_COMPOSER_COMMAND_DUPLICATE:${command.name}`);
          }
          this.composerCommands.set(command.name, {
            plugin,
            tool,
            entryCode: artifact?.entryCode,
            toolName: name,
            profileIds: plugin.manifest.targetProfiles,
          });
        }
      }
      this.registrations.push(...pending);
    } catch (error) {
      for (const dispose of pending.reverse()) await dispose();
      for (const [name, item] of this.tools) if (item.pluginId === plugin.id) this.tools.delete(name);
      for (const [name, command] of this.composerCommands) {
        if (command.plugin.id === plugin.id) this.composerCommands.delete(name);
      }
      throw error;
    }
  }

  private async executeTool(
    installedSnapshot: InstalledToolPlugin,
    tool: ToolPluginToolDeclaration,
    entryCode: string | undefined,
    input: unknown,
    context: AgentToolExecutionContext,
  ): Promise<unknown> {
    const current = await getInstalledToolPlugin(installedSnapshot.id);
    if (!current?.enabled || current.manifest.contentHash !== installedSnapshot.manifest.contentHash) {
      throw new Error("TOOL_PLUGIN_RUNTIME_REVOKED");
    }
    if (!tool.permissions.every((permission) => current.grantedPermissions.includes(permission))) {
      throw new Error("TOOL_PLUGIN_PERMISSION_REVOKED");
    }
    const handler = tool.handler;
    if (!handler) throw new Error("TOOL_PLUGIN_HANDLER_MISSING");
    const network = (request: ToolPluginNetworkRequest) => this.executeNetwork(current.manifest, request, context.signal);
    let result: unknown;
    if (handler.kind === "http") {
      result = await network(resolveHttpTemplate(handler.request, input));
    } else if (handler.kind === "worker") {
      if (!entryCode) throw new Error("TOOL_PLUGIN_ARTIFACT_MISSING");
      result = await this.worker.execute({
        pluginId: current.id,
        entryCode,
        exportName: handler.exportName,
        input,
        signal: context.signal,
        maxRequests: current.manifest.network?.maxRequestsPerCall ?? 0,
        network,
      });
    } else {
      result = await executeToolPluginHostCapability({
        capability: handler.capability,
        input,
        context,
        memory: this.getMemoryService(),
      });
    }
    if (new TextEncoder().encode(JSON.stringify(result) ?? "null").byteLength > OUTPUT_LIMIT_BYTES) {
      throw new Error("TOOL_PLUGIN_OUTPUT_TOO_LARGE");
    }
    return result;
  }

  private executeNetwork(manifest: ToolPluginManifest, request: ToolPluginNetworkRequest, signal: AbortSignal) {
    if (!manifest.network) return Promise.reject(new Error("TOOL_PLUGIN_NETWORK_NOT_DECLARED"));
    return this.http.request(request, {
      pluginId: manifest.id,
      policy: manifest.network,
      credentials: manifest.credentials ?? [],
      resolveCredential: (credentialId) => resolveToolPluginCredential(manifest.id, credentialId),
      signal,
    });
  }

  private getAgentRuntime(): IAgentRuntimeService {
    if (!this.kernel) throw new Error("TOOL_PLUGIN_RUNTIME_NOT_ACTIVE");
    return this.kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime);
  }

  private getMemoryService(): MemoryServiceTyped {
    if (!this.kernel) throw new Error("TOOL_PLUGIN_RUNTIME_NOT_ACTIVE");
    return this.kernel.getService<MemoryServiceTyped>(KernelServices.Memory);
  }

  private async disposeRegistrations(): Promise<void> {
    const disposers = this.registrations.splice(0).reverse();
    this.tools.clear();
    this.composerCommands.clear();
    const results = await Promise.allSettled(disposers.map((dispose) => dispose()));
    const failure = results.find((item): item is PromiseRejectedResult => item.status === "rejected");
    if (failure) throw failure.reason;
  }
}

function assertCompatible(plugin: InstalledToolPlugin, installed: readonly InstalledToolPlugin[]): void {
  const currentVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
  if (compareVersions(currentVersion, plugin.manifest.runtime.minVersion) < 0) throw new Error("TOOL_PLUGIN_RUNTIME_VERSION_UNSUPPORTED");
  const granted = new Set(plugin.grantedPermissions);
  if (plugin.manifest.permissions.some((item) => !item.optional && !granted.has(item.id))) {
    throw new Error("TOOL_PLUGIN_REQUIRED_PERMISSION_MISSING");
  }
  for (const dependency of plugin.manifest.dependencies) {
    const target = installed.find((item) => item.id === dependency.id && item.enabled);
    if (!target || compareVersions(target.manifest.version, dependency.version) !== 0) {
      throw new Error(`TOOL_PLUGIN_DEPENDENCY_UNAVAILABLE:${dependency.id}`);
    }
  }
}

function toolName(pluginId: string, toolId: string): string {
  const value = `ext.${pluginId}.${toolId}`;
  if (value.length > 128) throw new Error("TOOL_PLUGIN_TOOL_NAME_TOO_LONG");
  return value;
}

function resolveHttpTemplate(template: ToolPluginHttpRequestTemplate, input: unknown): ToolPluginNetworkRequest {
  return {
    method: template.method,
    url: interpolate(template.url, input, true),
    headers: template.headers
      ? Object.fromEntries(Object.entries(template.headers).map(([key, value]) => [key, interpolate(value, input, false)]))
      : undefined,
    body: mapTemplateValue(template.body, input),
    credentialIds: template.credentialIds,
  };
}

function mapTemplateValue(value: unknown, input: unknown): unknown {
  if (typeof value === "string") return interpolate(value, input, false);
  if (Array.isArray(value)) return value.map((item) => mapTemplateValue(item, input));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapTemplateValue(item, input)]));
  }
  return value;
}

function interpolate(value: string, input: unknown, urlEncode: boolean): string {
  return value.replace(/\{\{input\.([A-Za-z0-9_.-]+)\}\}/g, (_match, path: string) => {
    const resolved = path.split(".").reduce<unknown>((current, key) => (
      current && typeof current === "object" && !Array.isArray(current)
        ? (current as Record<string, unknown>)[key]
        : undefined
    ), input);
    if (!["string", "number", "boolean"].includes(typeof resolved)) throw new Error(`TOOL_PLUGIN_TEMPLATE_VALUE_INVALID:${path}`);
    const text = String(resolved);
    if (/\r|\n/.test(text)) throw new Error("TOOL_PLUGIN_TEMPLATE_VALUE_INVALID");
    return urlEncode ? encodeURIComponent(text) : text;
  });
}

function normalizeError(error: unknown): string { return error instanceof Error ? error.message : String(error); }
