/**
 * MCP Connector driver。
 *
 * 这是唯一允许 import `@modelcontextprotocol/*` 的目录（由架构守卫强制）。
 * 只使用 Streamable HTTP：该包的 stdio 子路径会引入 `cross-spawn` 与
 * `node:process`/`node:stream`，与 `PLATFORM-MOBILE` 冲突，永久禁止。
 */
import {
  Client,
  LATEST_PROTOCOL_VERSION,
  StreamableHTTPClientTransport,
  isInputRequiredResult,
} from "@modelcontextprotocol/client";
import type {
  ConnectedSource,
  ConnectorCallContext,
  ConnectorDeps,
  ConnectorDriver,
  ExternalCapabilitySnapshot,
  ExternalCapabilitySource,
  ExternalPromptDescriptor,
  ExternalProtocolEra,
  ExternalResourceContent,
  ExternalResourceDescriptor,
  ExternalToolCallResult,
  ExternalToolDescriptor,
} from "../../../domain/externalSources/contracts";
import { externalSourceError } from "../../../domain/externalSources/registry";
import {
  assessExternalJsonSchema,
  projectModelVisibleJsonSchema,
} from "../../../domain/externalSources/schemaBounds";

export const MCP_SOURCE_KIND = "mcp";
export const MCP_STREAMABLE_HTTP_TRANSPORT = "streamable-http";

const DEFAULT_CLIENT_INFO = Object.freeze({ name: "mobile-tavern", version: "1.0.0" });
const PROBE_TIMEOUT_MS = 3_000;
const MAX_LIST_PAGES = 20;
const MAX_TOOLS = 500;
const MAX_RESOURCES = 500;
const MAX_PROMPTS = 200;
const MAX_DESCRIPTION_LENGTH = 1_024;
const MAX_WARNINGS = 32;

const PROJECTED_CAPABILITY_KEYS = new Set(["tools", "resources", "prompts"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 外部文本一律按不可信内容处理：去掉控制字符、压平空白并限长。 */
function sanitizeExternalText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  let printable = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const isControl =
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f;
    printable += isControl ? " " : character;
  }
  const flattened = printable.replace(/\s+/g, " ").trim();
  return flattened.length > maxLength ? `${flattened.slice(0, maxLength)}…` : flattened;
}

function pushWarning(warnings: string[], warning: string): void {
  if (warnings.length < MAX_WARNINGS) warnings.push(warning);
}

function versionNegotiationFor(era: ExternalProtocolEra) {
  switch (era) {
    case "legacy":
      return { mode: "legacy" as const };
    case "modern":
      return { mode: { pin: LATEST_PROTOCOL_VERSION } };
    default:
      return { mode: "auto" as const, probe: { timeoutMs: PROBE_TIMEOUT_MS } };
  }
}

function listUnsupportedCapabilities(capabilities: unknown): string[] {
  if (!isRecord(capabilities)) return [];
  const unsupported: string[] = [];
  for (const [key, value] of Object.entries(capabilities)) {
    if (PROJECTED_CAPABILITY_KEYS.has(key)) continue;
    unsupported.push(key);
    if ((key === "extensions" || key === "experimental") && isRecord(value)) {
      for (const id of Object.keys(value)) unsupported.push(`${key}:${id}`);
    }
  }
  return unsupported;
}

function readSchema(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) return Object.freeze({ type: "object" });
  return projectModelVisibleJsonSchema(value);
}

function projectToolHints(value: unknown): Readonly<Record<string, boolean>> | undefined {
  if (!isRecord(value)) return undefined;
  const hints: Record<string, boolean> = {};
  for (const [key, hint] of Object.entries(value)) {
    if (typeof hint === "boolean") hints[key] = hint;
  }
  return Object.keys(hints).length > 0 ? Object.freeze(hints) : undefined;
}

async function withAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  onAbort: () => void | Promise<void>,
  detail: string,
): Promise<T> {
  if (signal.aborted) {
    await onAbort();
    throw externalSourceError("EXTERNAL_SOURCE_ABORTED", detail);
  }
  let onAbortHandler: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbortHandler = () => {
      void onAbort();
      reject(externalSourceError("EXTERNAL_SOURCE_ABORTED", detail));
    };
    signal.addEventListener("abort", onAbortHandler, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    if (onAbortHandler) signal.removeEventListener("abort", onAbortHandler);
  }
}

function createMcpConnectedSource(
  client: Client,
  source: ExternalCapabilitySource,
  snapshot: ExternalCapabilitySnapshot,
): ConnectedSource {
  let disposed = false;
  return {
    snapshot,

    async callTool(localName: string, input: unknown, context: ConnectorCallContext) {
      if (!isRecord(input)) {
        throw externalSourceError("EXTERNAL_SOURCE_TOOL_INPUT_INVALID", localName);
      }
      const result = await client.callTool(
        { name: localName, arguments: input },
        { timeout: context.timeoutMs },
      );
      if (isInputRequiredResult(result)) {
        throw externalSourceError("EXTERNAL_SOURCE_INPUT_REQUIRED", localName);
      }
      const projected: ExternalToolCallResult = {
        content: Array.isArray(result.content) ? result.content : [],
        structuredContent: result.structuredContent,
        isError: result.isError === true,
      };
      return projected;
    },

    async readResource(uri: string, context: ConnectorCallContext) {
      const result = await client.readResource({ uri }, { timeout: context.timeoutMs });
      const first: unknown = result.contents?.[0];
      if (!isRecord(first)) return { uri };
      const projected: ExternalResourceContent = {
        uri,
        mimeType: typeof first.mimeType === "string" ? first.mimeType : undefined,
        text: typeof first.text === "string" ? first.text : undefined,
      };
      return projected;
    },

    async dispose() {
      if (disposed) return;
      disposed = true;
      await client.close();
    },
  };
}

async function buildSnapshot(
  client: Client,
  source: ExternalCapabilitySource,
  context: ConnectorCallContext,
): Promise<ExternalCapabilitySnapshot> {
  const capabilities = client.getServerCapabilities();
  const serverVersion = client.getServerVersion();
  const warnings: string[] = [];
  const unsupportedCapabilities = listUnsupportedCapabilities(capabilities);

  const tools: ExternalToolDescriptor[] = [];
  if (isRecord(capabilities) && capabilities.tools) {
    try {
      let cursor: string | undefined;
      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const result = await client.listTools(
          cursor ? { cursor } : undefined,
          { timeout: context.timeoutMs },
        );
        for (const tool of result.tools) {
          if (tools.length >= MAX_TOOLS) break;
          const name = sanitizeExternalText(tool.name, 128);
          if (!name) continue;
          const schema = readSchema(tool.inputSchema);
          const assessment = assessExternalJsonSchema(schema);
          if (!assessment.supported) {
            const reasons = [...assessment.unsupportedKeywords, ...assessment.degradationReasons];
            pushWarning(warnings, `schema-downgraded:${name}:${reasons.slice(0, 8).join(",")}`);
          }
          tools.push(
            Object.freeze({
              sourceId: source.id,
              qualifiedName: `${source.kind}.${source.id}.${name}`,
              localName: name,
              description: sanitizeExternalText(tool.description, MAX_DESCRIPTION_LENGTH),
              inputSchema: schema,
              outputSchema: isRecord(tool.outputSchema)
                ? projectModelVisibleJsonSchema(tool.outputSchema)
                : undefined,
              hints: projectToolHints(tool.annotations),
            }),
          );
        }
        cursor = result.nextCursor;
        if (!cursor) break;
      }
    } catch (error) {
      pushWarning(warnings, `tools-list-failed:${error instanceof Error ? error.name : "unknown"}`);
    }
  }

  const resources: ExternalResourceDescriptor[] = [];
  if (isRecord(capabilities) && capabilities.resources) {
    try {
      const result = await client.listResources(undefined, { timeout: context.timeoutMs });
      for (const resource of result.resources.slice(0, MAX_RESOURCES)) {
        resources.push(
          Object.freeze({
            sourceId: source.id,
            uri: sanitizeExternalText(resource.uri, 2_048),
            name: sanitizeExternalText(resource.name, 128),
            description: sanitizeExternalText(resource.description, MAX_DESCRIPTION_LENGTH),
            mimeType: typeof resource.mimeType === "string" ? resource.mimeType : undefined,
          }),
        );
      }
    } catch (error) {
      pushWarning(warnings, `resources-list-failed:${error instanceof Error ? error.name : "unknown"}`);
    }
  }

  const prompts: ExternalPromptDescriptor[] = [];
  if (isRecord(capabilities) && capabilities.prompts) {
    try {
      const result = await client.listPrompts(undefined, { timeout: context.timeoutMs });
      for (const prompt of result.prompts.slice(0, MAX_PROMPTS)) {
        prompts.push(
          Object.freeze({
            sourceId: source.id,
            name: sanitizeExternalText(prompt.name, 128),
            description: sanitizeExternalText(prompt.description, MAX_DESCRIPTION_LENGTH),
            arguments: Array.isArray(prompt.arguments)
              ? prompt.arguments.map((argument) =>
                  Object.freeze({
                    name: sanitizeExternalText(argument.name, 128),
                    description: sanitizeExternalText(argument.description, MAX_DESCRIPTION_LENGTH),
                    required: argument.required === true,
                  }),
                )
              : undefined,
          }),
        );
      }
    } catch (error) {
      pushWarning(warnings, `prompts-list-failed:${error instanceof Error ? error.name : "unknown"}`);
    }
  }

  return Object.freeze({
    sourceId: source.id,
    serverName: sanitizeExternalText(serverVersion?.name, 128) || undefined,
    serverVersion: sanitizeExternalText(serverVersion?.version, 64) || undefined,
    instructions: sanitizeExternalText(client.getInstructions(), MAX_DESCRIPTION_LENGTH) || undefined,
    negotiatedProtocolVersion: client.getNegotiatedProtocolVersion(),
    tools: Object.freeze(tools),
    resources: Object.freeze(resources),
    prompts: Object.freeze(prompts),
    unsupportedCapabilities: Object.freeze(unsupportedCapabilities),
    warnings: Object.freeze(warnings),
  });
}

export function createMcpConnectorDriver(): ConnectorDriver {
  return {
    kind: MCP_SOURCE_KIND,
    transports: Object.freeze([MCP_STREAMABLE_HTTP_TRANSPORT]),

    async connect(
      source: ExternalCapabilitySource,
      context: ConnectorCallContext,
      deps: ConnectorDeps,
    ): Promise<ConnectedSource> {
      // 凭据只在这里注入到传输层；driver 不解析秘密来源，只消费已解析的请求头。
      const transport = new StreamableHTTPClientTransport(new URL(source.endpoint), {
        ...(deps.authHeaders ? { requestInit: { headers: { ...deps.authHeaders } } } : {}),
      });
      const client = new Client(deps.clientInfo ?? DEFAULT_CLIENT_INFO, {
        versionNegotiation: versionNegotiationFor(source.era),
      });
      await withAbort(
        client.connect(transport),
        context.signal,
        () => client.close(),
        `connect:${source.id}`,
      );
      try {
        const snapshot = await withAbort(
          buildSnapshot(client, source, context),
          context.signal,
          () => client.close(),
          `discover:${source.id}`,
        );
        return createMcpConnectedSource(client, source, snapshot);
      } catch (error) {
        await client.close().catch(() => undefined);
        throw error;
      }
    },
  };
}
