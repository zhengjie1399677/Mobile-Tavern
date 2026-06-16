/**
 * API Client Utility
 * Provides cross-platform HTTP fetch capabilities, handling both Tauri native direct fetch
 * (for Android/Desktop client builds bypassing CORS) and local Express Proxy fetches (for Web browsers).
 */

declare const IS_MOBILE_NATIVE: boolean;

// 动态载入的 tauri http client 的 fetch
let tauriFetch: typeof fetch | null = null;
if (typeof window !== "undefined") {
  const isTauri =
    window.location.protocol.startsWith("tauri") ||
    window.location.protocol === "file:" ||
    window.location.hostname === "tauri.localhost" ||
    !!(window as any).__TAURI_INTERNALS__ ||
    !!(window as any).__TAURI_IPC__;

  if (isTauri) {
    import("@tauri-apps/plugin-http")
      .then((mod) => {
        tauriFetch = mod.fetch;
        console.log("[apiClient] Successfully loaded Tauri native HTTP plugin.");
      })
      .catch((err) => {
        console.warn("[apiClient] Failed to load Tauri native HTTP plugin, fallback to window.fetch:", err);
      });
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fallback model name used only when no model is configured (test-connection ping). */
export const FALLBACK_MODEL = "gpt-3.5-turbo";

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

/** Cached result of Tauri environment detection (computed once at module load). */
let _cachedIsClient: boolean | null = null;

/**
 * Returns true if running inside a Tauri WebView (Android / Desktop client).
 * Safe to call in SSR / Node test environments.
 */
export const isClientMode = (): boolean => {
  if (_cachedIsClient !== null) return _cachedIsClient;
  if (typeof window === "undefined") {
    _cachedIsClient = false;
    return false;
  }
  _cachedIsClient =
    window.location.protocol.startsWith("tauri") ||
    window.location.protocol === "file:" ||
    window.location.hostname === "tauri.localhost" ||
    !!(window as any).__TAURI_INTERNALS__ ||
    !!(window as any).__TAURI_IPC__;
  return _cachedIsClient;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UniversalFetchPayload {
  baseUrl: string;
  /** API key / Bearer token. Pass empty string for unauthenticated endpoints. */
  apiKey?: string;
  /** Request body for /api/proxy/openai calls */
  reqBody?: Record<string, unknown>;
  /** Model name used only in test-connection ping */
  modelName?: string;
  /** Custom path override for chat completions (default: /chat/completions) */
  chatPath?: string;
  /** Custom path override for model listing (default: /models) */
  modelsPath?: string;
  /** API type identifier forwarded to proxy in web mode */
  type?: string;
  /** Option to bypass the local Express server proxy in browser environments */
  bypassProxy?: boolean;
}

// ---------------------------------------------------------------------------
// Endpoint enum (replaces magic strings at call sites)
// ---------------------------------------------------------------------------

export const API_ENDPOINT = {
  TestConnection: "/api/test-connection",
  ProxyModels: "/api/proxy/models",
  ProxyOpenAI: "/api/proxy/openai",
} as const;

export type ApiEndpointValue = (typeof API_ENDPOINT)[keyof typeof API_ENDPOINT];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validates and normalises a baseUrl string.
 * Throws a descriptive Error if the URL is missing or uses an unsupported protocol.
 */
function validateBaseUrl(raw: string | undefined): string {
  const trimmed = (typeof raw === "string" ? raw : "").replace(/\/$/, "");
  if (!trimmed || (!trimmed.startsWith("http://") && !trimmed.startsWith("https://"))) {
    throw new Error(
      "Invalid or missing baseUrl — only http:// and https:// protocols are supported."
    );
  }
  return trimmed;
}

/**
 * Builds headers for direct Tauri fetch, adding Authorization only when
 * a non-empty apiKey is provided.
 */
function buildHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey && apiKey.trim()) {
    headers["Authorization"] = `Bearer ${apiKey.trim()}`;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Universal fetch wrapper that routes requests through:
 *  - Express server proxy  (standard web browser builds)
 *  - Direct HTTPS fetch    (Tauri Android / Desktop builds, bypassing CORS)
 *
 * @param endpoint      One of the API_ENDPOINT constants
 * @param proxyPayload  Request parameters
 * @param customSignal  Optional AbortSignal (e.g. from an AbortController)
 */
export const universalFetch = async (
  endpoint: string,
  proxyPayload: UniversalFetchPayload,
  customSignal?: AbortSignal
): Promise<Response> => {
  const isTauri = isClientMode();

  let signal: AbortSignal | undefined = customSignal;
  if ((AbortSignal as any).timeout) {
    const timeoutSignal = AbortSignal.timeout(120_000);
    if (customSignal) {
      if ((AbortSignal as any).any) {
        signal = (AbortSignal as any).any([customSignal, timeoutSignal]);
      }
    } else {
      signal = timeoutSignal;
    }
  }

  // ── Web browser path: delegate to Express proxy (unless bypassed) ────────
  if (typeof IS_MOBILE_NATIVE !== "undefined" && IS_MOBILE_NATIVE) {
    // In mobile native builds, bypass local Express proxy and always use direct fetch.
    // The else branch below will be completely tree-shaken in production builds.
  } else {
    if (!isTauri && !proxyPayload.bypassProxy) {
      return fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proxyPayload),
        signal,
      });
    }
  }

  // ── Tauri path: direct HTTPS fetch ───────────────────────────────────────
  const { baseUrl, apiKey, reqBody, modelName, chatPath, modelsPath } = proxyPayload;

  const targetBase = validateBaseUrl(baseUrl);
  const headers = buildHeaders(apiKey);

  const chatRoute = chatPath || "/chat/completions";
  const modelsRoute = modelsPath || "/models";

  const fetchFn = tauriFetch || fetch;

  // ── /api/test-connection ──────────────────────────────────────────────────
  if (endpoint === API_ENDPOINT.TestConnection) {
    let res: Response;
    try {
      res = await fetchFn(`${targetBase}${chatRoute}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: modelName || FALLBACK_MODEL,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 5,
        }),
        signal,
      });
    } catch (fetchErr: unknown) {
      // Network-level error (DNS failure, timeout, CORS in non-Tauri env, etc.)
      return new Response(
        JSON.stringify({
          success: false,
          error: "网络请求失败，请检查 Base URL 是否可达及网络连接状态。",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (res.ok) {
      let responseData: unknown = null;
      try {
        responseData = await res.json();
      } catch {
        // Response body may not be valid JSON for some providers — that's fine
      }
      return new Response(
        JSON.stringify({
          success: true,
          message: "Connected successfully!",
          data: responseData,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } else {
      // Read error body for internal debug only, never expose to UI directly
      let debugBody = "";
      try {
        debugBody = await res.text();
      } catch {
        /* ignore */
      }
      if (import.meta.env.DEV) {
        console.warn("[apiClient] test-connection error body:", debugBody);
      }
      return new Response(
        JSON.stringify({
          success: false,
          error: `HTTP ${res.status}：请求被拒绝，请检查 API Key 与 Base URL 配置是否正确。`,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // ── /api/proxy/models ─────────────────────────────────────────────────────
  if (endpoint === API_ENDPOINT.ProxyModels) {
    let res: Response;
    try {
      res = await fetchFn(`${targetBase}${modelsRoute}`, {
        method: "GET",
        headers,
        signal,
      });
    } catch (fetchErr: unknown) {
      return new Response(
        JSON.stringify({ success: false, error: "网络请求失败，请检查 Base URL 是否可达。" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!res.ok) {
      let debugBody = "";
      try {
        debugBody = await res.text();
      } catch {
        /* ignore */
      }
      if (import.meta.env.DEV) {
        console.warn("[apiClient] proxy/models error body:", debugBody);
      }
      return new Response(
        JSON.stringify({
          success: false,
          error: `HTTP ${res.status}：获取模型列表失败，请检查接口配置。`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "模型列表响应格式异常（非 JSON）。" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Normalise various provider response shapes → flat array with { id }
    let modelsArray: Array<{ id?: unknown; name?: unknown }> = [];

    if (Array.isArray(data)) {
      modelsArray = data as typeof modelsArray;
    } else if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;
      if (Array.isArray(obj.data)) {
        modelsArray = obj.data as typeof modelsArray;
      } else if (Array.isArray(obj.models)) {
        modelsArray = obj.models as typeof modelsArray;
      } else {
        // Last-resort: pull top-level object values that look like model entries
        modelsArray = Object.values(obj).filter(
          (v): v is { id?: string; name?: string } =>
            typeof v === "object" &&
            v !== null &&
            (typeof (v as any).id === "string" || typeof (v as any).name === "string")
        );
      }
    }

    const normalized = modelsArray
      .map((m) => {
        const id = typeof m.id === "string" ? m.id : typeof m.name === "string" ? m.name : null;
        return id ? { id } : null;
      })
      .filter((m): m is { id: string } => m !== null);

    return new Response(
      JSON.stringify({ success: true, models: normalized }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── /api/proxy/openai ─────────────────────────────────────────────────────
  if (endpoint === API_ENDPOINT.ProxyOpenAI) {
    return fetchFn(`${targetBase}${chatRoute}`, {
      method: "POST",
      headers,
      body: JSON.stringify(reqBody),
      signal,
    });
  }

  throw new Error(`Unknown fetch endpoint: "${endpoint}"`);
};

export const apiClient = {
  universalFetch,
  isClientMode,
  sendCatbotRequest: async (content: string, history: any[], clientContext?: any): Promise<{ reply: string; expression: string }> => {
    const isTauri = isClientMode();
    const targetUrl = isTauri ? "http://127.0.0.1:3000/api/catbot" : "/api/catbot";
    
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, history, clientContext }),
    });
    
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}`);
    }
    
    return res.json();
  }
};
