/**
 * API Client Utility
 * Provides cross-platform HTTP fetch capabilities, handling both Tauri native direct fetch
 * (for Android/Desktop client builds bypassing CORS) and local Express Proxy fetches (for Web browsers).
 */

export const isClientMode = (): boolean => {
  return (
    window.location.protocol.startsWith("tauri") ||
    window.location.protocol === "file:" ||
    window.location.hostname === "tauri.localhost" ||
    !!(window as any).__TAURI_INTERNALS__ ||
    !!(window as any).__TAURI_IPC__
  );
};

export interface UniversalFetchPayload {
  baseUrl: string;
  apiKey: string;
  reqBody?: any;
  modelName?: string;
  [key: string]: any;
}

export const universalFetch = async (
  endpoint: string,
  proxyPayload: UniversalFetchPayload
): Promise<Response> => {
  const isTauri = isClientMode();
  const signal = (AbortSignal as any).timeout ? AbortSignal.timeout(35000) : undefined;

  // If running in a standard web browser, routing goes through our Express server backend proxy
  if (!isTauri) {
    return fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(proxyPayload),
      signal,
    });
  }

  // --- DIRECT FETCH FALLBACK (Tauri Mobile/Desktop) ---
  // Tauri mobile applications bypass standard browser CORS, so we can make direct HTTPS fetches
  const { baseUrl, apiKey, reqBody, modelName } = proxyPayload;
  const targetBase = typeof baseUrl === "string" ? baseUrl.replace(/\/$/, "") : "";
  const headers: any = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  if (endpoint === "/api/test-connection") {
    const res = await fetch(`${targetBase}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelName || "gpt-3.5-turbo",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 5,
      }),
      signal,
    });

    if (res.ok) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Connected successfully!",
          data: await res.json(),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } else {
      return new Response(
        JSON.stringify({
          success: false,
          error: `HTTP ${res.status}: ${await res.text()}`,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  if (endpoint === "/api/proxy/models") {
    const res = await fetch(`${targetBase}/models`, {
      method: "GET",
      headers,
      signal,
    });

    if (!res.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `HTTP ${res.status}: ${await res.text()}`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = await res.json();
    let modelsArray: any[] = [];
    if (Array.isArray(data)) {
      modelsArray = data;
    } else if (data.data && Array.isArray(data.data)) {
      modelsArray = data.data;
    } else if (data.models && Array.isArray(data.models)) {
      modelsArray = data.models;
    } else if (typeof data === "object") {
      modelsArray = Object.values(data).filter(
        (v: any) => v && (v.id || v.name)
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        models: modelsArray.map((m: any) => ({ id: m.id || m.name })),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  if (endpoint === "/api/proxy/openai") {
    return fetch(`${targetBase}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(reqBody),
      signal,
    });
  }

  throw new Error("Unknown fetch endpoint: " + endpoint);
};
