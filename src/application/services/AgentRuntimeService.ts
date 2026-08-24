import type { EffectDisposer, IKernel } from "../../kernel/types";
import type { IAgentRuntimeService } from "../serviceContracts";
import type {
  AgentDriverDefinition,
  AgentCompositionSnapshot,
  AgentHandle,
  AgentHandleSnapshot,
  AgentJournalEvent,
  AgentMediaProcessorDefinition,
  AgentMediaProcessingRequest,
  AgentMediaProcessingResult,
  AgentProviderDefinition,
  AgentToolCall,
  AgentToolDefinition,
  AgentTurnExecutionContext,
  AgentTurnInput,
  AgentTurnResult,
} from "../../domain/agents/contracts";
import {
  appendAgentJournalEvent,
  listAgentJournalEventsBySession,
  replaceAgentJournalEvents,
  deleteAgentJournalBySession,
} from "../../infrastructure/agents/agentJournalStorage";

const RUNTIME_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/;
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9._-]{1,127}$/;
const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
const MAX_TOOL_TIMEOUT_MS = 300_000;

export interface AgentJournalPort {
  append(event: AgentJournalEvent): Promise<void>;
  listBySession(sessionId: string): Promise<AgentJournalEvent[]>;
  replace(events: readonly AgentJournalEvent[]): Promise<void>;
  deleteBySession(sessionId: string): Promise<void>;
}

export interface OpenAgentHandleOptions {
  readonly sessionId: string;
  readonly driverId: string;
  readonly providerId: string;
  readonly executeLegacy: (context: AgentTurnExecutionContext) => Promise<void>;
  readonly grantedPermissions: readonly string[];
}

export interface AgentRuntimeDiagnostics {
  readonly drivers: ReadonlyArray<{ id: string; version: string }>;
  readonly providers: ReadonlyArray<{ id: string; version: string }>;
  readonly tools: ReadonlyArray<{ name: string; version: string }>;
  readonly mediaProcessors: ReadonlyArray<{ id: string; version: string }>;
  readonly activeHandles: number;
}

const indexedDbJournal: AgentJournalPort = {
  append: appendAgentJournalEvent,
  listBySession: listAgentJournalEventsBySession,
  replace: replaceAgentJournalEvents,
  deleteBySession: deleteAgentJournalBySession,
};

class AgentRuntimeError extends Error {
  constructor(readonly code: string, message = code) {
    super(message === code ? code : `${code}: ${message}`);
    this.name = "AgentRuntimeError";
  }
}

/**
 * Agent、Provider 与 Tool 的应用层组合主干。
 *
 * Kernel 只托管本服务生命周期；所有 Agent 语义、Turn 状态和权限判断均留在应用层。
 */
export class AgentRuntimeService implements IAgentRuntimeService {
  readonly name = "agentRuntime";
  readonly isCritical = false;
  readonly dependencies = [] as const;

  private readonly drivers = new Map<string, AgentDriverDefinition>();
  private readonly providers = new Map<string, AgentProviderDefinition>();
  private readonly tools = new Map<string, AgentToolDefinition>();
  private readonly mediaProcessors = new Map<string, AgentMediaProcessorDefinition>();
  private readonly handles = new Set<ManagedAgentHandle>();
  private compositionSnapshot: AgentCompositionSnapshot | null = null;
  private active = false;

  constructor(private readonly journal: AgentJournalPort = indexedDbJournal) {}

  init(_kernel: IKernel): void {
    this.active = true;
  }

  async destroy(): Promise<void> {
    if (!this.active && this.handles.size === 0) return;
    this.active = false;
    const handles = Array.from(this.handles);
    const results = await Promise.allSettled(handles.map((handle) => handle.dispose()));
    this.handles.clear();
    this.tools.clear();
    this.mediaProcessors.clear();
    this.providers.clear();
    this.drivers.clear();
    this.compositionSnapshot = null;
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason as unknown);
    if (failures.length > 0) {
      throw new AggregateError(failures, "AGENT_RUNTIME_DESTROY_FAILED");
    }
  }

  registerDriver(definition: AgentDriverDefinition): EffectDisposer {
    this.assertActive();
    assertRuntimeId(definition.id, "AGENT_DRIVER_ID_INVALID");
    assertVersion(definition.version, "AGENT_DRIVER_VERSION_INVALID");
    if (this.drivers.has(definition.id)) {
      throw new AgentRuntimeError("AGENT_DRIVER_DUPLICATE");
    }
    this.drivers.set(definition.id, definition);
    return createRegistrationDisposer(this.drivers, definition.id, definition);
  }

  registerProvider(definition: AgentProviderDefinition): EffectDisposer {
    this.assertActive();
    assertRuntimeId(definition.id, "AGENT_PROVIDER_ID_INVALID");
    assertVersion(definition.version, "AGENT_PROVIDER_VERSION_INVALID");
    if (definition.capabilities.inputModalities.length === 0) {
      throw new AgentRuntimeError("AGENT_PROVIDER_MODALITIES_EMPTY");
    }
    if (this.providers.has(definition.id)) {
      throw new AgentRuntimeError("AGENT_PROVIDER_DUPLICATE");
    }
    this.providers.set(definition.id, definition);
    return createRegistrationDisposer(this.providers, definition.id, definition);
  }

  registerTool(definition: AgentToolDefinition): EffectDisposer {
    this.assertActive();
    if (!TOOL_NAME_PATTERN.test(definition.name)) {
      throw new AgentRuntimeError("AGENT_TOOL_NAME_INVALID");
    }
    assertVersion(definition.version, "AGENT_TOOL_VERSION_INVALID");
    if (!definition.description.trim()) {
      throw new AgentRuntimeError("AGENT_TOOL_DESCRIPTION_INVALID");
    }
    if (
      !Number.isFinite(definition.timeoutMs)
      || definition.timeoutMs <= 0
      || definition.timeoutMs > MAX_TOOL_TIMEOUT_MS
    ) {
      throw new AgentRuntimeError("AGENT_TOOL_TIMEOUT_INVALID");
    }
    if (this.tools.has(definition.name)) {
      throw new AgentRuntimeError("AGENT_TOOL_DUPLICATE");
    }
    this.tools.set(definition.name, definition);
    return createRegistrationDisposer(this.tools, definition.name, definition);
  }

  registerMediaProcessor(definition: AgentMediaProcessorDefinition): EffectDisposer {
    this.assertActive();
    assertRuntimeId(definition.id, "AGENT_MEDIA_PROCESSOR_ID_INVALID");
    assertVersion(definition.version, "AGENT_MEDIA_PROCESSOR_VERSION_INVALID");
    if (definition.inputKinds.length === 0) {
      throw new AgentRuntimeError("AGENT_MEDIA_PROCESSOR_KINDS_EMPTY");
    }
    if (this.mediaProcessors.has(definition.id)) {
      throw new AgentRuntimeError("AGENT_MEDIA_PROCESSOR_DUPLICATE");
    }
    this.mediaProcessors.set(definition.id, definition);
    return createRegistrationDisposer(this.mediaProcessors, definition.id, definition);
  }

  bindComposition(snapshot: AgentCompositionSnapshot): EffectDisposer {
    this.assertActive();
    if (this.compositionSnapshot) throw new AgentRuntimeError("AGENT_COMPOSITION_ALREADY_BOUND");
    const normalized = normalizeReplayValue(snapshot) as AgentCompositionSnapshot;
    this.compositionSnapshot = deepFreeze(normalized);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.compositionSnapshot === normalized) this.compositionSnapshot = null;
    };
  }

  getCompositionSnapshot(): AgentCompositionSnapshot | null {
    return this.compositionSnapshot
      ? structuredClone(this.compositionSnapshot)
      : null;
  }

  listDrivers(): AgentDriverDefinition[] {
    return sortById(this.drivers.values(), (item) => item.id);
  }

  listProviders(): AgentProviderDefinition[] {
    return sortById(this.providers.values(), (item) => item.id);
  }

  listTools(): AgentToolDefinition[] {
    return sortById(this.tools.values(), (item) => item.name);
  }

  listMediaProcessors(): AgentMediaProcessorDefinition[] {
    return sortById(this.mediaProcessors.values(), (item) => item.id);
  }

  getProvider(providerId: string): AgentProviderDefinition {
    this.assertActive();
    const provider = this.providers.get(providerId);
    if (!provider) throw new AgentRuntimeError("AGENT_PROVIDER_NOT_FOUND", providerId);
    return provider;
  }

  openHandle(options: OpenAgentHandleOptions): AgentHandle {
    this.assertActive();
    if (!options.sessionId.trim()) throw new AgentRuntimeError("AGENT_SESSION_ID_INVALID");
    const driver = this.drivers.get(options.driverId);
    if (!driver) throw new AgentRuntimeError("AGENT_DRIVER_NOT_FOUND", options.driverId);
    const provider = this.providers.get(options.providerId);
    if (!provider) throw new AgentRuntimeError("AGENT_PROVIDER_NOT_FOUND", options.providerId);

    const handle = new ManagedAgentHandle({
      journal: this.journal,
      driver,
      provider,
      tools: this.tools,
      mediaProcessors: this.mediaProcessors,
      options,
      onDispose: () => this.handles.delete(handle),
    });
    this.handles.add(handle);
    return handle;
  }

  getDiagnostics(): AgentRuntimeDiagnostics {
    return {
      drivers: this.listDrivers().map(({ id, version }) => ({ id, version })),
      providers: this.listProviders().map(({ id, version }) => ({ id, version })),
      tools: this.listTools().map(({ name, version }) => ({ name, version })),
      mediaProcessors: this.listMediaProcessors().map(({ id, version }) => ({ id, version })),
      activeHandles: this.handles.size,
    };
  }

  listJournalBySession(sessionId: string): Promise<AgentJournalEvent[]> {
    if (!sessionId.trim()) throw new AgentRuntimeError("AGENT_SESSION_ID_INVALID");
    return this.journal.listBySession(sessionId);
  }

  replaceJournal(events: readonly AgentJournalEvent[]): Promise<void> {
    this.assertActive();
    return this.journal.replace(events.map((event) => structuredClone(event)));
  }

  deleteJournalBySession(sessionId: string): Promise<void> {
    this.assertActive();
    if (!sessionId.trim()) throw new AgentRuntimeError("AGENT_SESSION_ID_INVALID");
    return this.journal.deleteBySession(sessionId);
  }

  private assertActive(): void {
    if (!this.active) throw new AgentRuntimeError("AGENT_RUNTIME_NOT_ACTIVE");
  }
}

interface ManagedAgentHandleDependencies {
  readonly journal: AgentJournalPort;
  readonly driver: AgentDriverDefinition;
  readonly provider: AgentProviderDefinition;
  readonly tools: ReadonlyMap<string, AgentToolDefinition>;
  readonly mediaProcessors: ReadonlyMap<string, AgentMediaProcessorDefinition>;
  readonly options: OpenAgentHandleOptions;
  readonly onDispose: () => void;
}

class ManagedAgentHandle implements AgentHandle {
  private status: AgentHandleSnapshot["status"] = "idle";
  private activeTurnId: string | null = null;
  private activeController: AbortController | null = null;
  private activeTask: Promise<AgentTurnResult> | null = null;
  private sequence = 0;
  private readonly listeners = new Set<(snapshot: AgentHandleSnapshot) => void>();
  private readonly permissions: ReadonlySet<string>;

  constructor(private readonly dependencies: ManagedAgentHandleDependencies) {
    this.permissions = new Set(dependencies.options.grantedPermissions);
  }

  send(input: AgentTurnInput): Promise<AgentTurnResult> {
    if (this.status === "disposed") {
      return Promise.reject(new AgentRuntimeError("AGENT_HANDLE_DISPOSED"));
    }
    if (this.activeTask) {
      return Promise.reject(new AgentRuntimeError("AGENT_TURN_ALREADY_RUNNING"));
    }
    const normalizedInput: AgentTurnInput = {
      text: input.text,
      attachmentIds: Array.from(new Set(input.attachmentIds)),
      attachmentParts: input.attachmentParts ? structuredClone(input.attachmentParts) : undefined,
      skipModel: input.skipModel,
      continuation: input.continuation,
    };
    const turnId = createId("turn");
    const controller = new AbortController();
    this.sequence = 0;
    this.activeTurnId = turnId;
    this.activeController = controller;
    this.status = "running";
    this.emit();

    const task = this.runTurn(turnId, normalizedInput, controller);
    this.activeTask = task;
    void task.finally(() => {
      if (this.activeTask !== task) return;
      this.activeTask = null;
      this.activeController = null;
      this.activeTurnId = null;
      if (this.status !== "disposed") this.status = "idle";
      this.emit();
    }).catch(() => undefined);
    return task;
  }

  async stop(reason = "user"): Promise<void> {
    if (!this.activeController || !this.activeTask) return;
    if (!this.activeController.signal.aborted) {
      this.activeController.abort(new DOMException(reason, "AbortError"));
    }
    await this.activeTask.catch(() => undefined);
  }

  async dispose(): Promise<void> {
    if (this.status === "disposed") return;
    this.status = "disposed";
    this.emit();
    await this.stop("handle-disposed");
    this.listeners.clear();
    this.dependencies.onDispose();
  }

  getSnapshot(): AgentHandleSnapshot {
    return Object.freeze({
      sessionId: this.dependencies.options.sessionId,
      driverId: this.dependencies.driver.id,
      providerId: this.dependencies.provider.id,
      status: this.status,
      activeTurnId: this.activeTurnId,
    });
  }

  subscribe(listener: (snapshot: AgentHandleSnapshot) => void): () => void {
    if (this.status === "disposed") throw new AgentRuntimeError("AGENT_HANDLE_DISPOSED");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async runTurn(
    turnId: string,
    input: AgentTurnInput,
    controller: AbortController,
  ): Promise<AgentTurnResult> {
    const { driver, provider, options } = this.dependencies;
    await this.appendEvent(turnId, {
      type: "turn.started",
      driverId: driver.id,
      driverVersion: driver.version,
      providerId: provider.id,
      providerVersion: provider.version,
      input: normalizeReplayValue(input) as AgentTurnInput,
    });

    const context: AgentTurnExecutionContext = {
      sessionId: options.sessionId,
      turnId,
      driverId: driver.id,
      providerId: provider.id,
      input,
      signal: controller.signal,
      provider,
      executeLegacy: () => options.executeLegacy(context),
      executeTool: (call) => this.executeTool(turnId, call, controller.signal),
      processMedia: (processorId, request) => this.processMedia(
        turnId,
        processorId,
        request,
        controller.signal,
      ),
      recordDecision: (decisionType, value) => this.recordDecision(turnId, decisionType, value),
    };

    try {
      await driver.run(context);
      if (controller.signal.aborted) {
        await this.appendCancelled(turnId, controller.signal.reason);
        return { turnId, status: "cancelled" };
      }
      await this.appendEvent(turnId, { type: "turn.completed" });
      return { turnId, status: "completed" };
    } catch (error: unknown) {
      if (controller.signal.aborted || isAbortError(error)) {
        await this.appendCancelled(turnId, controller.signal.reason ?? error);
        return { turnId, status: "cancelled" };
      }
      const normalized = normalizeError(error);
      await this.appendEvent(turnId, {
        type: "turn.failed",
        errorCode: normalized.code,
        errorMessage: normalized.message,
      });
      throw error;
    }
  }

  private async executeTool(
    turnId: string,
    call: AgentToolCall,
    turnSignal: AbortSignal,
  ): Promise<unknown> {
    if (!call.callId.trim()) throw new AgentRuntimeError("AGENT_TOOL_CALL_ID_INVALID");
    const tool = this.dependencies.tools.get(call.name);
    if (!tool) {
      const error = new AgentRuntimeError("AGENT_TOOL_NOT_FOUND", call.name);
      await this.appendToolFailure(turnId, call.callId, call.name, error);
      throw error;
    }
    for (const permission of tool.permissions) {
      if (!this.permissions.has(permission)) {
        const error = new AgentRuntimeError(
          "AGENT_TOOL_PERMISSION_DENIED",
          `${call.name}: ${permission}`,
        );
        await this.appendToolFailure(turnId, call.callId, call.name, error);
        throw error;
      }
    }

    let parsedInput: unknown;
    try {
      parsedInput = await tool.inputSchema.parseAsync(call.arguments);
    } catch (error: unknown) {
      const validationError = new AgentRuntimeError(
        "AGENT_TOOL_INPUT_INVALID",
        normalizeError(error).message,
      );
      await this.appendToolFailure(turnId, call.callId, call.name, validationError);
      throw validationError;
    }
    const replayInput = normalizeReplayValue(parsedInput);
    await this.appendEvent(turnId, {
      type: "tool.called",
      callId: call.callId,
      toolName: tool.name,
      toolVersion: tool.version,
      arguments: replayInput,
    });

    const timeoutMs = tool.timeoutMs || DEFAULT_TOOL_TIMEOUT_MS;
    const controller = new AbortController();
    const relayAbort = () => controller.abort(turnSignal.reason);
    if (turnSignal.aborted) relayAbort();
    else turnSignal.addEventListener("abort", relayAbort, { once: true });
    const timeout = setTimeout(() => {
      controller.abort(new AgentRuntimeError("AGENT_TOOL_TIMEOUT", tool.name));
    }, timeoutMs);

    try {
      const execution = tool.execute(parsedInput, {
        sessionId: this.dependencies.options.sessionId,
        turnId,
        callId: call.callId,
        signal: controller.signal,
      });
      const rawResult = await raceWithAbort(execution, controller.signal);
      let parsedResult: unknown;
      try {
        parsedResult = await tool.outputSchema.parseAsync(rawResult);
      } catch (error: unknown) {
        throw new AgentRuntimeError(
          "AGENT_TOOL_OUTPUT_INVALID",
          normalizeError(error).message,
        );
      }
      const replayResult = normalizeReplayValue(parsedResult);
      await this.appendEvent(turnId, {
        type: "tool.result",
        callId: call.callId,
        toolName: tool.name,
        result: replayResult,
      });
      return replayResult;
    } catch (error: unknown) {
      const failure = controller.signal.aborted ? controller.signal.reason : error;
      await this.appendToolFailure(turnId, call.callId, tool.name, failure);
      throw failure;
    } finally {
      clearTimeout(timeout);
      turnSignal.removeEventListener("abort", relayAbort);
    }
  }

  private appendToolFailure(
    turnId: string,
    callId: string,
    toolName: string,
    error: unknown,
  ): Promise<void> {
    const normalized = normalizeError(error);
    return this.appendEvent(turnId, {
      type: "tool.failed",
      callId,
      toolName,
      errorCode: normalized.code,
      errorMessage: normalized.message,
    });
  }

  private async processMedia(
    turnId: string,
    processorId: string,
    request: AgentMediaProcessingRequest,
    signal: AbortSignal,
  ): Promise<AgentMediaProcessingResult> {
    const processor = this.dependencies.mediaProcessors.get(processorId);
    if (!processor) throw new AgentRuntimeError("AGENT_MEDIA_PROCESSOR_NOT_FOUND", processorId);
    if (!processor.inputKinds.includes(request.kind)) {
      throw new AgentRuntimeError("AGENT_MEDIA_PROCESSOR_KIND_UNSUPPORTED", request.kind);
    }
    const result = await processor.process(request, {
      sessionId: this.dependencies.options.sessionId,
      turnId,
      signal,
    });
    const replayResult = normalizeReplayValue(result) as AgentMediaProcessingResult;
    await this.appendEvent(turnId, {
      type: "media.processed",
      processorId: processor.id,
      processorVersion: processor.version,
      result: replayResult,
    });
    return replayResult;
  }

  private recordDecision(turnId: string, decisionType: string, value: unknown): Promise<void> {
    if (!RUNTIME_ID_PATTERN.test(decisionType)) {
      throw new AgentRuntimeError("AGENT_DECISION_TYPE_INVALID");
    }
    return this.appendEvent(turnId, {
      type: "turn.decision",
      decisionType,
      value: normalizeReplayValue(value),
    });
  }

  private appendCancelled(turnId: string, reason: unknown): Promise<void> {
    return this.appendEvent(turnId, {
      type: "turn.cancelled",
      reason: normalizeError(reason).message,
    });
  }

  private appendEvent(
    turnId: string,
    event: AgentJournalEventPayload,
  ): Promise<void> {
    this.sequence += 1;
    return this.dependencies.journal.append({
      ...event,
      id: createId("evt"),
      sessionId: this.dependencies.options.sessionId,
      turnId,
      sequence: this.sequence,
      createdAt: Date.now(),
    } as AgentJournalEvent);
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

type AgentJournalEventPayload = AgentJournalEvent extends infer TEvent
  ? TEvent extends AgentJournalEvent
    ? Omit<TEvent, "id" | "sessionId" | "turnId" | "sequence" | "createdAt">
    : never
  : never;

function createRegistrationDisposer<TValue>(
  registry: Map<string, TValue>,
  id: string,
  definition: TValue,
): EffectDisposer {
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    if (registry.get(id) === definition) registry.delete(id);
  };
}

function sortById<TValue>(
  values: Iterable<TValue>,
  getId: (value: TValue) => string,
): TValue[] {
  return Array.from(values).sort((left, right) => getId(left).localeCompare(getId(right)));
}

function assertRuntimeId(id: string, code: string): void {
  if (!RUNTIME_ID_PATTERN.test(id)) throw new AgentRuntimeError(code, id);
}

function assertVersion(version: string, code: string): void {
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(version)) {
    throw new AgentRuntimeError(code, version);
  }
}

function createId(prefix: "turn" | "evt"): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}

function normalizeReplayValue(value: unknown): unknown {
  try {
    const serialized = JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === "bigint" || typeof item === "function" || typeof item === "symbol") {
        throw new AgentRuntimeError("AGENT_REPLAY_VALUE_INVALID");
      }
      return item;
    });
    if (serialized === undefined) return null;
    return JSON.parse(serialized) as unknown;
  } catch (error: unknown) {
    if (error instanceof AgentRuntimeError) throw error;
    throw new AgentRuntimeError("AGENT_REPLAY_VALUE_INVALID", normalizeError(error).message);
  }
}

function deepFreeze<TValue>(value: TValue): TValue {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeError(error: unknown): { code: string; message: string } {
  if (error instanceof AgentRuntimeError) return { code: error.code, message: error.message };
  if (error instanceof DOMException) return { code: error.name || "DOM_EXCEPTION", message: error.message };
  if (error instanceof Error) return { code: error.name || "ERROR", message: error.message };
  return { code: "UNKNOWN_ERROR", message: String(error) };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function raceWithAbort<TValue>(promise: Promise<TValue>, signal: AbortSignal): Promise<TValue> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<TValue>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
