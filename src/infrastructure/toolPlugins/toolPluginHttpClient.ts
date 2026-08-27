import type {
  ToolPluginHttpPort,
  ToolPluginNetworkContext,
  ToolPluginNetworkRequest,
  ToolPluginNetworkResponse,
} from "../../application/toolPlugins/executionContracts";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ToolPluginHttpClient implements ToolPluginHttpPort {
  constructor(private readonly fetchImpl: FetchLike = defaultFetch) {}

  async request(
    request: ToolPluginNetworkRequest,
    context: ToolPluginNetworkContext,
  ): Promise<ToolPluginNetworkResponse> {
    if (!context.policy.allowedMethods.includes(request.method)) throw new Error("TOOL_PLUGIN_NETWORK_METHOD_DENIED");
    const url = new URL(request.url);
    if (url.protocol !== "https:" || !context.policy.allowedOrigins.includes(url.origin)) {
      throw new Error("TOOL_PLUGIN_NETWORK_ORIGIN_DENIED");
    }
    const headers = new Headers(request.headers);
    for (const [name, value] of headers) {
      if (/\r|\n/.test(name) || /\r|\n/.test(value)) throw new Error("TOOL_PLUGIN_NETWORK_HEADER_INVALID");
      if (/^(?:cookie|proxy-authorization)$/i.test(name)) throw new Error("TOOL_PLUGIN_NETWORK_HEADER_DENIED");
    }
    for (const credentialId of request.credentialIds ?? []) {
      const declaration = context.credentials.find((item) => item.id === credentialId);
      if (!declaration) throw new Error("TOOL_PLUGIN_CREDENTIAL_NOT_DECLARED");
      const secret = `${declaration.injection.prefix ?? ""}${await context.resolveCredential(credentialId)}`;
      if (declaration.injection.location === "header") headers.set(declaration.injection.name, secret);
      else url.searchParams.set(declaration.injection.name, secret);
    }
    const body = encodeBody(request.body, headers);
    const requestBytes = body ? new TextEncoder().encode(body).byteLength : 0;
    if (requestBytes > context.policy.maxRequestBytes) throw new Error("TOOL_PLUGIN_NETWORK_REQUEST_TOO_LARGE");
    const response = await this.fetchImpl(url, {
      method: request.method,
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: "manual",
      credentials: "omit",
      signal: context.signal,
    });
    if (response.status >= 300 && response.status < 400) throw new Error("TOOL_PLUGIN_NETWORK_REDIRECT_DENIED");
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > context.policy.maxResponseBytes) {
      throw new Error("TOOL_PLUGIN_NETWORK_RESPONSE_TOO_LARGE");
    }
    const bytes = await readLimited(response, context.policy.maxResponseBytes, context.signal);
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "application/octet-stream";
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    let responseBody: unknown = text;
    if (contentType === "application/json" || contentType.endsWith("+json")) {
      try { responseBody = text ? JSON.parse(text) : null; }
      catch { throw new Error("TOOL_PLUGIN_NETWORK_RESPONSE_INVALID_JSON"); }
    }
    return { status: response.status, contentType, body: responseBody };
  }
}

async function readLimited(response: Response, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) throw new Error("TOOL_PLUGIN_NETWORK_RESPONSE_TOO_LARGE");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw signal.reason ?? new Error("TOOL_PLUGIN_NETWORK_ABORTED");
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("TOOL_PLUGIN_NETWORK_RESPONSE_TOO_LARGE");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function encodeBody(body: unknown, headers: Headers): string | undefined {
  if (body === undefined || body === null) return body === null ? "null" : undefined;
  if (typeof body === "string") return body;
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return JSON.stringify(body);
}

async function defaultFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { fetch } = await import("@tauri-apps/plugin-http");
    return fetch(input, init);
  }
  return globalThis.fetch(input, init);
}
