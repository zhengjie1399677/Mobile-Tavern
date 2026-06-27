import { ILLMService, IKernel } from "../types";
import { getTrialKey } from "../../utils/keyManager";
import { cleanRequestPayload, cleanLLMResponse } from "../utils/requestSchema";
import { ModelCapabilityRegistry } from "./memory/ModelCapabilityRegistry";

declare const IS_MOBILE_NATIVE: boolean;

let tauriFetch: typeof fetch | null = null;
let tauriFetchPromise: Promise<typeof fetch | null> | null = null;

if (typeof window !== "undefined") {
  const isTauri =
    window.location.protocol.startsWith("tauri") ||
    window.location.protocol === "file:" ||
    window.location.hostname === "tauri.localhost" ||
    !!(window as any).__TAURI_INTERNALS__ ||
    !!(window as any).__TAURI_IPC__;

  if (isTauri) {
    tauriFetchPromise = import("@tauri-apps/plugin-http")
      .then((mod) => {
        tauriFetch = mod.fetch;
        console.log("[LLMService] Successfully loaded Tauri native HTTP plugin.");
        return mod.fetch;
      })
      .catch((err) => {
        console.warn("[LLMService] Failed to load Tauri native HTTP plugin, fallback to window.fetch:", err);
        return null;
      });
  }
}

export const FALLBACK_MODEL = "gpt-3.5-turbo";

export class LLMService implements ILLMService {
  name = "llm";
  private kernel!: IKernel;
  // P1-1/P1-2: 服务级 AbortController，用于 destroy 时中止挂起的 fetch
  private abortController: AbortController | null = null;

  init(kernel: IKernel, signal?: AbortSignal): void {
    this.kernel = kernel;
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener("abort", () => this.abortController?.abort());
    }
  }

  // P1-2: 销毁时清理模块级单例与 abort 控制器
  destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
    // 清理 Tauri fetch 模块级单例，允许 HMR 后重新加载
    tauriFetchPromise = null;
    tauriFetch = null;
  }

  isClientMode(): boolean {
    if (typeof window === "undefined") return false;
    return (
      window.location.protocol.startsWith("tauri") ||
      window.location.protocol === "file:" ||
      window.location.hostname === "tauri.localhost" ||
      !!(window as any).__TAURI_INTERNALS__ ||
      !!(window as any).__TAURI_IPC__
    );
  }

  private validateBaseUrl(raw: string | undefined): string {
    // 剥离所有末尾斜杠，避免拼接后出现 // 双斜杠导致部分严格服务器 404
    const trimmed = (typeof raw === "string" ? raw.trim() : "").replace(/\/+$/, "");
    if (!trimmed || (!trimmed.startsWith("http://") && !trimmed.startsWith("https://"))) {
      throw new Error(
        "Invalid or missing baseUrl — only http:// and https:// protocols are supported."
      );
    }
    return trimmed;
  }

  private buildHeaders(apiKey?: string): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey && apiKey.trim()) {
      headers["Authorization"] = `Bearer ${apiKey.trim()}`;
    }
    return headers;
  }

  // P0-3: cleanRequestPayload 已下沉到 src/kernel/utils/requestSchema.ts，
  // 实现请求体字段白名单清洗，剥离非标参数与原型污染键名。

  async universalFetch(
    endpoint: string,
    proxyPayload: any,
    customSignal?: AbortSignal
  ): Promise<Response> {
    let cleanedReqBody = cleanRequestPayload(proxyPayload.baseUrl, proxyPayload.reqBody as Record<string, any>);
    const modelId = proxyPayload.reqBody?.model || "";
    if (modelId) {
      cleanedReqBody = ModelCapabilityRegistry.cleanLLMParams(modelId, cleanedReqBody);
    }
    
    let actualApiKey = proxyPayload.apiKey;
    let isTrial = false;
    if (!actualApiKey || actualApiKey.trim() === "" || actualApiKey === "TRIAL_KEY_PLACEHOLDER") {
      isTrial = true;
      try {
        actualApiKey = await getTrialKey();
      } catch (err) {
        console.error("[LLMService] Failed to dynamically fetch trial key:", err);
      }
    }

    const safePayload = {
      ...proxyPayload,
      apiKey: actualApiKey,
      reqBody: cleanedReqBody,
    };
    const isTauri = this.isClientMode();

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

    try {
      if (typeof IS_MOBILE_NATIVE !== "undefined" && IS_MOBILE_NATIVE) {
        // direct
      } else {
        if (!isTauri && !safePayload.bypassProxy) {
          const proxyRes = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(safePayload),
            signal,
          });
          return proxyRes;
        }
      }

      const { baseUrl, apiKey, reqBody, modelName, chatPath, modelsPath } = safePayload;
      const targetBase = this.validateBaseUrl(baseUrl);
      const headers = this.buildHeaders(apiKey);

      // 使用 ?? 替代 ||，允许 chatPath/modelsPath 显式传空字符串（""）以让 baseUrl 自带完整端点路径
      const chatRoute = chatPath ?? "/chat/completions";
      const modelsRoute = modelsPath ?? "/models";

      let fetchFn = tauriFetch || fetch;
      if (!tauriFetch && tauriFetchPromise) {
        const resolvedFetch = await tauriFetchPromise;
        fetchFn = resolvedFetch || fetch;
      }

      if (endpoint === "/api/test-connection") {
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
          } catch {}
          return new Response(
            JSON.stringify({
              success: true,
              message: "Connected successfully!",
              data: responseData,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        } else {
          let debugBody = "";
          try {
            debugBody = await res.text();
          } catch {}
          return new Response(
            JSON.stringify({
              success: false,
              error: `HTTP ${res.status}：请求被拒绝，请检查 API Key 与 Base URL 配置是否正确。`,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
      }

      if (endpoint === "/api/proxy/models") {
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

        let modelsArray: any[] = [];
        if (Array.isArray(data)) {
          modelsArray = data;
        } else if (data && typeof data === "object") {
          const obj = data as Record<string, unknown>;
          if (Array.isArray(obj.data)) {
            modelsArray = obj.data;
          } else if (Array.isArray(obj.models)) {
            modelsArray = obj.models;
          } else {
            modelsArray = Object.values(obj).filter(
              (v): v is any =>
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

      if (endpoint === "/api/proxy/openai") {
        const openAiRes = await fetchFn(`${targetBase}${chatRoute}`, {
          method: "POST",
          headers,
          body: JSON.stringify(reqBody),
          signal,
        });

        // 运行时自愈拦截：遇到 400 等错误时，克隆并判定是否为参数不支持引发，是则自动关闭该模型对应 capability 缓存
        if (!openAiRes.ok) {
          try {
            const clonedRes = openAiRes.clone();
            const errText = await clonedRes.text();
            const unsupported = ModelCapabilityRegistry.isUnsupportedParamError(errText);
            if (unsupported && modelId) {
              ModelCapabilityRegistry.updateCapabilities(modelId, { [unsupported.param]: false });
              console.warn(`[LLMService] Auto-healing: Disabled unsupported capability "${unsupported.param}" for model: ${modelId}`);
            }
          } catch (e) {
            console.warn("[LLMService] Failed to analyze api error for self-healing:", e);
          }
        }
        // P1-9: 对非流式响应做字段白名单清洗，剥离中转站注入的非标字段
        // （如 extra_data / debug_info / prompt_hash），
        // 防止脏数据渗透到 sessions 表与消息渲染管线。
        // 流式响应（stream: true）由 streamReader 逐 chunk 处理，仅提取
        // choices[].delta.content / reasoning_content，无需清洗。
        if (reqBody?.stream !== true && openAiRes.ok) {
          try {
            const data = await openAiRes.json();
            const cleaned = cleanLLMResponse(data);
            return new Response(JSON.stringify(cleaned), {
              status: openAiRes.status,
              statusText: openAiRes.statusText,
              headers: { "Content-Type": "application/json" },
            });
          } catch {
            return new Response(
              JSON.stringify({ error: "Invalid JSON response from upstream" }),
              { status: 502, headers: { "Content-Type": "application/json" } }
            );
          }
        }
        return openAiRes;
      }

      throw new Error(`Unknown fetch endpoint: "${endpoint}"`);
    } finally {
      if (isTrial) {
        actualApiKey = "";
        safePayload.apiKey = "";
      }
    }
  }

  async sendCatbotRequest(
    content: string,
    history: any[],
    clientContext?: any
  ): Promise<{ reply: string; expression: string }> {
    const isTauri = this.isClientMode();
    let fetchFn = tauriFetch || fetch;
    if (!tauriFetch && tauriFetchPromise) {
      const resolvedFetch = await tauriFetchPromise;
      fetchFn = resolvedFetch || fetch;
    }
    
    const targetUrl = isTauri 
      ? "https://catbot-gmkodirnhh.cn-hangzhou.fcapp.run/api/catbot" 
      : "/api/catbot";
    
    const res = await fetchFn(targetUrl, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "X-Device-Id": clientContext?.deviceId || ""
      },
      body: JSON.stringify({ 
        content, 
        history, 
        clientContext: {
          ...clientContext,
          device_id: clientContext?.deviceId
        } 
      }),
    });
    
    if (!res.ok) {
      let errText = "";
      try {
        errText = await res.text();
      } catch (e) {}
      throw new Error(`HTTP error ${res.status}: ${errText}`);
    }
    
    return res.json();
  }
}
