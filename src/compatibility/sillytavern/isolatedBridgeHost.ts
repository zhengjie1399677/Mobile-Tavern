interface RestrictedTavernHelperWindow extends Window {
  TavernHelper?: {
    _bind?: {
      _replaceVariables?: (variables: Record<string, unknown>, option: { type: "chat" }) => void;
    };
  };
}

interface IsolatedBridgeRequest {
  mtCompatIsolated: 1;
  requestId: string;
  method: "variables.replace" | "frame.resize";
  params: unknown;
}

let installed = false;

function findRegisteredFrame(source: MessageEventSource | null): HTMLIFrameElement | null {
  if (!source || typeof document === "undefined") return null;
  for (const frame of document.querySelectorAll<HTMLIFrameElement>("iframe[data-mt-compat-isolated='true']")) {
    if (frame.contentWindow === source && !frame.sandbox.contains("allow-same-origin")) return frame;
  }
  return null;
}

function parseRequest(value: unknown): IsolatedBridgeRequest | null {
  if (!value || typeof value !== "object") return null;
  const request = value as Partial<IsolatedBridgeRequest>;
  if (
    request.mtCompatIsolated !== 1
    || typeof request.requestId !== "string"
    || request.requestId.length > 128
  ) return null;
  if (request.method !== "variables.replace" && request.method !== "frame.resize") return null;
  return request as IsolatedBridgeRequest;
}

function sanitizeVariables(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ISOLATED_BRIDGE_PAYLOAD_INVALID");
  }
  const serialized = JSON.stringify(value);
  if (!serialized || serialized.length > 1_000_000) throw new Error("ISOLATED_BRIDGE_PAYLOAD_INVALID");
  return JSON.parse(serialized, (key, item: unknown) => {
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      throw new Error("ISOLATED_BRIDGE_KEY_FORBIDDEN");
    }
    return item;
  }) as Record<string, unknown>;
}

function handleMessage(event: MessageEvent<unknown>): void {
  if (event.origin !== "null") return;
  const frame = findRegisteredFrame(event.source);
  const request = parseRequest(event.data);
  if (!frame || !request) return;

  if (request.method === "frame.resize") {
    const height = Number((request.params as { height?: unknown } | null)?.height);
    if (Number.isFinite(height)) frame.style.height = `${Math.min(4096, Math.max(0, height))}px`;
    return;
  }

  const params = request.params as { variables?: unknown; option?: { type?: unknown } } | null;
  if (params?.option?.type !== undefined && params.option.type !== "chat") return;
  try {
    const variables = sanitizeVariables(params?.variables);
    const bridge = (window as RestrictedTavernHelperWindow).TavernHelper?._bind?._replaceVariables;
    if (typeof bridge === "function") bridge(variables, { type: "chat" });
  } catch {
    // 外部脚本输入不进入应用异常通道；无效请求直接丢弃。
  }
}

export function initIsolatedBridgeHost(): void {
  if (installed || typeof window === "undefined") return;
  window.addEventListener("message", handleMessage);
  installed = true;
}

export function cleanIsolatedBridgeHost(): void {
  if (!installed || typeof window === "undefined") return;
  window.removeEventListener("message", handleMessage);
  installed = false;
}
