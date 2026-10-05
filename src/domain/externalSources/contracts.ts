/**
 * 外部能力通道的中立契约。
 *
 * 本文件属于领域层，**不得出现任何协议专有概念**：MCP 只是第一个 Connector 实现，
 * 新增协议只能通过注册新的 ConnectorDriver 接入，不得修改这里的语义。
 * 设计依据见 `docs/agents/external_capability_channel_design.md`。
 */
import { z } from "zod";

/** 能力源种类 ID（当前唯一实现为 `mcp`）；由 ConnectorRegistry 校验，领域层不枚举协议。 */
export type ExternalSourceKind = string;

/** 传输方式 ID（当前唯一注册项为 `streamable-http`）；同样由注册表解析。 */
export type ExternalTransportId = string;

/** 协议世代偏好；非 MCP 协议可以忽略该字段。 */
export type ExternalProtocolEra = "auto" | "legacy" | "modern";

const KIND_PATTERN = /^[a-z][a-z0-9-]*$/;
const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** 用户配置的单个外部能力源。只保存凭据引用，绝不内联秘密。 */
export const externalCapabilitySourceSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(SOURCE_ID_PATTERN),
    kind: z.string().max(32).regex(KIND_PATTERN),
    displayName: z.string().trim().min(1).max(64),
    endpoint: z.url().max(2048),
    transport: z.string().max(32).regex(KIND_PATTERN),
    era: z.enum(["auto", "legacy", "modern"]).default("auto"),
    authRef: z.string().min(1).max(128).optional(),
    /** 凭据注入到哪个请求头；默认 Authorization。 */
    authHeader: z.string().max(64).regex(/^[A-Za-z0-9-]+$/).optional(),
    /** bearer 会拼成 `Bearer <secret>`，raw 直接原样写入请求头。 */
    authScheme: z.enum(["bearer", "raw"]).optional(),
    enabled: z.boolean(),
  })
  .strict();

export type ExternalCapabilitySource = z.infer<typeof externalCapabilitySourceSchema>;

/** 外部工具描述。description 属于外部不可信文本，消费前必须清洗与限长。 */
export interface ExternalToolDescriptor {
  readonly sourceId: string;
  /** 全局唯一名：`<kind>.<sourceId>.<localName>`，与既有 `ext.<pluginId>.<toolId>` 并列。 */
  readonly qualifiedName: string;
  readonly localName: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
  /** 来源声明的提示（只读、破坏性等）。仅用于展示，不得作为授权依据。 */
  readonly hints?: Readonly<Record<string, boolean>>;
}

export interface ExternalResourceDescriptor {
  readonly sourceId: string;
  readonly uri: string;
  readonly name: string;
  readonly description?: string;
  readonly mimeType?: string;
}

export interface ExternalPromptArgument {
  readonly name: string;
  readonly description?: string;
  readonly required?: boolean;
}

export interface ExternalPromptDescriptor {
  readonly sourceId: string;
  readonly name: string;
  readonly description?: string;
  readonly arguments?: readonly ExternalPromptArgument[];
}

/** 一次连接后得到的能力快照。未知能力与降级原因必须显式列出，不得静默丢弃。 */
export interface ExternalCapabilitySnapshot {
  readonly sourceId: string;
  readonly serverName?: string;
  readonly serverVersion?: string;
  readonly instructions?: string;
  readonly negotiatedProtocolVersion?: string;
  readonly tools: readonly ExternalToolDescriptor[];
  readonly resources: readonly ExternalResourceDescriptor[];
  readonly prompts: readonly ExternalPromptDescriptor[];
  /** 未被本版本投影的已知或未知能力标识（如 `tasks`、`extensions:io.example/foo`）。 */
  readonly unsupportedCapabilities: readonly string[];
  /** 可诊断的降级原因，例如某类能力列表拉取失败。 */
  readonly warnings: readonly string[];
  readonly ttlMs?: number;
  readonly cacheScope?: "public" | "private";
}

export interface ConnectorCallContext {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}

export interface ExternalToolCallResult {
  readonly content: readonly unknown[];
  readonly structuredContent?: unknown;
  readonly isError: boolean;
}

export interface ExternalResourceContent {
  readonly uri: string;
  readonly mimeType?: string;
  readonly text?: string;
}

export interface ConnectorClientInfo {
  readonly name: string;
  readonly version: string;
}

/** 连接期依赖。对象形式本身就是扩展点：认证、原生 fetch 等能力按阶段追加字段。 */
export interface ConnectorDeps {
  readonly clientInfo?: ConnectorClientInfo;
  /** 已解析好的请求头（含凭据明文）。只允许在内存中短暂存在，不得落盘或写日志。 */
  readonly authHeaders?: Readonly<Record<string, string>>;
}

/** 凭据在存储中的键：优先 authRef，缺省用来源 id。 */
export function externalSourceCredentialKey(
  source: Pick<ExternalCapabilitySource, "id" | "authRef">,
): string {
  return source.authRef ?? source.id;
}

/** 把静态凭据转换成注入用的请求头；无凭据时返回 undefined。 */
export function buildExternalSourceAuthHeaders(
  source: Pick<ExternalCapabilitySource, "authHeader" | "authScheme">,
  secret: string | null,
): Readonly<Record<string, string>> | undefined {
  if (!secret) return undefined;
  const header = source.authHeader ?? "Authorization";
  const value = (source.authScheme ?? "bearer") === "bearer" ? `Bearer ${secret}` : secret;
  return Object.freeze({ [header]: value });
}

export interface ConnectedSource {
  readonly snapshot: ExternalCapabilitySnapshot;
  callTool(
    localName: string,
    input: unknown,
    context: ConnectorCallContext,
  ): Promise<ExternalToolCallResult>;
  readResource(uri: string, context: ConnectorCallContext): Promise<ExternalResourceContent>;
  dispose(): Promise<void>;
}

/** 协议适配端口。新增协议 = 新增一个 driver + 注册，不改消费者。 */
export interface ConnectorDriver {
  readonly kind: ExternalSourceKind;
  readonly transports: readonly ExternalTransportId[];
  connect(
    source: ExternalCapabilitySource,
    context: ConnectorCallContext,
    deps: ConnectorDeps,
  ): Promise<ConnectedSource>;
}

export const DEFAULT_CONNECTOR_TIMEOUT_MS = 30_000;
export const DEFAULT_EXTERNAL_TOOL_TIMEOUT_MS = 60_000;

/** 运行时诊断：只暴露标识与失败原因，不含配置或凭据。 */
export interface ExternalSourceRuntimeDiagnostics {
  readonly connectedSources: readonly string[];
  readonly registeredTools: readonly string[];
  readonly failures: Readonly<Record<string, string>>;
}
