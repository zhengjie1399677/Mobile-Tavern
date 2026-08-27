import type { z } from "zod";
import type { MessageContentPart } from "../messages/messageContent";
import type { AttachmentKind } from "../attachments/types";

export type AgentInputModality = "text" | "image" | "audio" | "video" | "file";
export type AgentHandleStatus = "idle" | "running" | "disposed";
export type AgentTurnStatus = "completed" | "cancelled" | "failed";

/** 会话保存的不可变组合快照；不包含配置、凭据或其他秘密。 */
export interface AgentCompositionSnapshot {
  readonly profileId: string;
  readonly profileVersion: number;
  readonly pluginVersions: Readonly<Record<string, string>>;
  readonly providerBindings: Readonly<Record<string, string>>;
  readonly contributionOrder: Readonly<Record<string, readonly string[]>>;
  readonly capabilityDecisions: Readonly<Record<string, unknown>>;
}

export interface AgentTurnInput {
  readonly text: string;
  readonly attachmentIds: readonly string[];
  readonly attachmentParts?: readonly MessageContentPart[];
  readonly skipModel?: boolean;
  readonly continuation?: boolean;
}

export interface AgentProviderCapabilities {
  readonly inputModalities: readonly AgentInputModality[];
  readonly supportedMimeTypes?: readonly string[];
  readonly maxAttachmentBytes?: number;
  readonly maxAttachments?: number;
  readonly supportsStreaming: boolean;
  readonly supportsTools: boolean;
}

export interface AgentProviderDefinition {
  readonly id: string;
  readonly version: string;
  readonly capabilities: AgentProviderCapabilities;
  buildRequestBody(request: Readonly<Record<string, unknown>>): Record<string, unknown>;
}

export interface AgentToolCall {
  readonly callId: string;
  readonly name: string;
  readonly arguments: unknown;
}

export interface AgentToolExecutionContext {
  readonly sessionId: string;
  readonly turnId: string;
  readonly callId: string;
  readonly signal: AbortSignal;
}

export type AgentToolRiskLevel = "low" | "medium" | "high";
export type AgentToolSideEffect = "none" | "local-write" | "external" | "irreversible";
export type AgentToolExecutionScope = "turn" | "session" | "memory" | "character" | "external";
export type AgentToolPolicy = "allow" | "deny" | "ask";
export type AgentToolApprovalDecision = "allow" | "deny";
export type AgentToolApprovalReason =
  | "user"
  | "policy"
  | "cancelled"
  | "timeout"
  | "host-unavailable";

export interface AgentToolApprovalRequest {
  readonly id: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly callId: string;
  readonly toolName: string;
  readonly description: string;
  readonly arguments: unknown;
  readonly riskLevel: AgentToolRiskLevel;
  readonly sideEffect: AgentToolSideEffect;
  readonly executionScope: AgentToolExecutionScope;
  readonly expiresAt: number;
}

export interface AgentToolDefinition {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<unknown>;
  /** 发给 Provider 的公开 JSON Schema；不得包含权限或执行实现。 */
  readonly inputJsonSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: z.ZodType<unknown>;
  readonly permissions: readonly string[];
  readonly riskLevel: AgentToolRiskLevel;
  readonly sideEffect: AgentToolSideEffect;
  readonly executionScope: AgentToolExecutionScope;
  /** 未配置永久授权时的 fail-closed 策略；高风险 Tool 不得默认 allow。 */
  readonly policy: AgentToolPolicy;
  readonly timeoutMs: number;
  readonly approvalTimeoutMs?: number;
  execute(input: unknown, context: AgentToolExecutionContext): Promise<unknown>;
}

export interface AgentMediaProcessingRequest {
  readonly assetId: string;
  readonly kind: AttachmentKind;
  /** Processor 私有配置；不得直接写入 Journal。 */
  readonly options?: unknown;
}

export interface AgentMediaProcessingResult {
  readonly sourceAssetId: string;
  readonly projectionParts: readonly MessageContentPart[];
  readonly derivedAssetIds: readonly string[];
  readonly strategy: string;
}

export interface AgentMediaProcessingContext {
  readonly sessionId: string;
  readonly turnId: string;
  readonly signal: AbortSignal;
}

export interface AgentMediaProcessorDefinition {
  readonly id: string;
  readonly version: string;
  readonly inputKinds: readonly AttachmentKind[];
  process(
    request: AgentMediaProcessingRequest,
    context: AgentMediaProcessingContext,
  ): Promise<AgentMediaProcessingResult>;
}

export interface AgentTurnExecutionContext {
  readonly sessionId: string;
  readonly turnId: string;
  readonly driverId: string;
  readonly providerId: string;
  readonly input: AgentTurnInput;
  readonly signal: AbortSignal;
  readonly provider: AgentProviderDefinition;
  executeLegacy(): Promise<void>;
  executeTool(call: AgentToolCall): Promise<unknown>;
  processMedia(
    processorId: string,
    request: AgentMediaProcessingRequest,
  ): Promise<AgentMediaProcessingResult>;
  recordDecision(decisionType: string, value: unknown): Promise<void>;
}

export interface AgentDriverDefinition {
  readonly id: string;
  readonly version: string;
  run(context: AgentTurnExecutionContext): Promise<void>;
}

interface AgentJournalEventBase {
  readonly id: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly sequence: number;
  readonly createdAt: number;
}

export type AgentJournalEvent =
  | (AgentJournalEventBase & {
      readonly type: "turn.started";
      readonly driverId: string;
      readonly driverVersion: string;
      readonly providerId: string;
      readonly providerVersion: string;
      readonly input: AgentTurnInput;
    })
  | (AgentJournalEventBase & {
      readonly type: "turn.decision";
      readonly decisionType: string;
      readonly value: unknown;
    })
  | (AgentJournalEventBase & {
      readonly type: "tool.called";
      readonly callId: string;
      readonly toolName: string;
      readonly toolVersion: string;
      readonly arguments: unknown;
    })
  | (AgentJournalEventBase & {
      readonly type: "tool.result";
      readonly callId: string;
      readonly toolName: string;
      readonly result: unknown;
    })
  | (AgentJournalEventBase & {
      readonly type: "tool.failed";
      readonly callId: string;
      readonly toolName: string;
      readonly errorCode: string;
      readonly errorMessage: string;
    })
  | (AgentJournalEventBase & {
      readonly type: "tool.approval.requested";
      readonly approvalId: string;
      readonly callId: string;
      readonly toolName: string;
      readonly description: string;
      readonly arguments: unknown;
      readonly riskLevel: AgentToolRiskLevel;
      readonly sideEffect: AgentToolSideEffect;
      readonly executionScope: AgentToolExecutionScope;
      readonly expiresAt: number;
    })
  | (AgentJournalEventBase & {
      readonly type: "tool.approval.resolved";
      readonly approvalId: string;
      readonly callId: string;
      readonly toolName: string;
      readonly decision: AgentToolApprovalDecision;
      readonly reason: AgentToolApprovalReason;
    })
  | (AgentJournalEventBase & {
      readonly type: "media.processed";
      readonly processorId: string;
      readonly processorVersion: string;
      readonly result: AgentMediaProcessingResult;
    })
  | (AgentJournalEventBase & {
      readonly type: "turn.completed";
    })
  | (AgentJournalEventBase & {
      readonly type: "turn.cancelled";
      readonly reason: string;
    })
  | (AgentJournalEventBase & {
      readonly type: "turn.failed";
      readonly errorCode: string;
      readonly errorMessage: string;
    });

export interface AgentHandleSnapshot {
  readonly sessionId: string;
  readonly driverId: string;
  readonly providerId: string;
  readonly status: AgentHandleStatus;
  readonly activeTurnId: string | null;
}

export interface AgentTurnResult {
  readonly turnId: string;
  readonly status: AgentTurnStatus;
}

export interface AgentHandle {
  send(input: AgentTurnInput): Promise<AgentTurnResult>;
  stop(reason?: string): Promise<void>;
  dispose(): Promise<void>;
  getSnapshot(): AgentHandleSnapshot;
  subscribe(listener: (snapshot: AgentHandleSnapshot) => void): () => void;
}
