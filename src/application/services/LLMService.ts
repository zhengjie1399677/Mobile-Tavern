import type { ILLMService, IKernel, LLMProxyRequestConfig } from "../serviceContracts";
import { getTrialKey, TRIAL_KEY_SENTINEL } from "../../utils/keyManager";
import { cleanLLMResponse } from "./requestSchema";
import {
  ModelCapabilityRegistry,
  prepareProviderRequest,
  removeUnsupportedRequestFields,
} from "./llmCompatibility";
import { Logger } from "../../utils/logger";
import { CLOUD_ENDPOINTS } from "../../utils/cloudEndpoints";
import { FALLBACK_MODEL } from "../../utils/apiClient";
import { TrialKeyFetchError } from "../../utils/resolveApiCredentials";

import { getErrorMessage } from "../../utils/errorUtils";
const logger = Logger.create("LLMService");

declare const IS_MOBILE_NATIVE: boolean;

/** Tauri WebView 注入的内部接口声明（与 src/utils/keyManager.ts 对齐）。 */
interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
  __TAURI_IPC__?: unknown;
}

/**
 * AbortSignal 静态方法扩展声明：
 * - timeout: ES2022 标准，TS ES2022 lib 已内置类型。
 * - any: ES2024 提案，ES2022 lib 未提供类型，以可选静态方法形式补全。
 */
interface AbortSignalStaticExtensions {
  timeout?(ms: number): AbortSignal;
  any?(signals: AbortSignal[]): AbortSignal;
}

/** 模型列表条目的最小结构契约，用于在 unknown 对象上做 id/name 字段探测。 */
interface ModelLike {
  id?: unknown;
  name?: unknown;
}

let tauriFetch: typeof fetch | null = null;
let tauriFetchPromise: Promise<typeof fetch | null> | null = null;

if (typeof window !== "undefined") {
  const tauriWindow = window as TauriWindow;
  const isTauri =
    window.location.protocol.startsWith("tauri") ||
    window.location.protocol === "file:" ||
    window.location.hostname === "tauri.localhost" ||
    !!tauriWindow.__TAURI_INTERNALS__ ||
    !!tauriWindow.__TAURI_IPC__;

  if (isTauri) {
    tauriFetchPromise = import("@tauri-apps/plugin-http")
      .then((mod) => {
        tauriFetch = mod.fetch;
        logger.info("Successfully loaded Tauri native HTTP plugin");
        return mod.fetch;
      })
      .catch((err): null => {
        logger.warn("Failed to load Tauri native HTTP plugin, fallback to window.fetch", { error: err });
        return null;
      });
  }
}

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
    const tauriWindow = window as TauriWindow;
    return (
      window.location.protocol.startsWith("tauri") ||
      window.location.protocol === "file:" ||
      window.location.hostname === "tauri.localhost" ||
      !!tauriWindow.__TAURI_INTERNALS__ ||
      !!tauriWindow.__TAURI_IPC__
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

  // 请求白名单、能力裁剪与 Provider 方言由 llmCompatibility 统一处理。

  async universalFetch(
    endpoint: string,
    proxyPayload: LLMProxyRequestConfig,
    customSignal?: AbortSignal,
    traceId?: string
  ): Promise<Response> {
    const log = traceId ? logger.withTrace(traceId) : logger;
    const rawRequestBody = proxyPayload.reqBody ?? {};
    const modelId = typeof rawRequestBody.model === "string"
      ? rawRequestBody.model
      : proxyPayload.modelName ?? "";
    let cleanedReqBody = prepareProviderRequest({
      baseUrl: proxyPayload.baseUrl,
      modelId,
      request: rawRequestBody,
      disableReasoning: proxyPayload.disableReasoning,
      forceBasicParams: proxyPayload.forceBasicParams,
    });
    
    let actualApiKey = proxyPayload.apiKey;
    let isTrial = false;
    if (!actualApiKey || actualApiKey.trim() === "" || actualApiKey === TRIAL_KEY_SENTINEL) {
      isTrial = true;
      try {
        actualApiKey = await getTrialKey();
      } catch (err) {
        log.error("Failed to dynamically fetch trial key", err);
        // 不再静默继续：占位符若发给 OpenRouter 会得到 401 且无明确提示。
        // 抛出 TrialKeyFetchError 让 UI 层拦截并提示用户配置自己的 API Key。
        throw new TrialKeyFetchError(`试用 Key 拉取失败：${getErrorMessage(err)}`);
      }
    }

    const safePayload = {
      ...proxyPayload,
      apiKey: actualApiKey,
      reqBody: cleanedReqBody,
    };
    const isTauri = this.isClientMode();

    let signal: AbortSignal | undefined = customSignal;
    // AbortSignal.timeout/any 在 ES2022 lib 中部分缺失类型，使用局部扩展接口访问静态方法。
    const AbortSignalCtor = AbortSignal as unknown as AbortSignalStaticExtensions;
    if (AbortSignalCtor.timeout) {
      const timeoutSignal = AbortSignalCtor.timeout(300_000); // 放宽至 300 秒（5分钟），防止生成长文本时超时掐断
      if (customSignal) {
        if (AbortSignalCtor.any) {
          signal = AbortSignalCtor.any([customSignal, timeoutSignal]);
        } else {
          // P1-4: AbortSignal.any 兼容性回退。旧实现此处直接保留 customSignal，
          // 导致 timeoutSignal 被丢弃，请求在 customSignal 不 abort 时永久挂起。
          // 手动合并：用新 controller 监听两个 signal 的 abort，任一触发即转发。
          const merged = new AbortController();
          const onAbort = (reason: unknown) => {
            if (!merged.signal.aborted) {
              merged.abort(reason);
            }
          };
          if (customSignal.aborted) {
            onAbort(customSignal.reason);
          } else {
            customSignal.addEventListener("abort", () => onAbort(customSignal.reason), { once: true });
          }
          if (timeoutSignal.aborted) {
            onAbort(timeoutSignal.reason);
          } else {
            timeoutSignal.addEventListener("abort", () => onAbort(timeoutSignal.reason), { once: true });
          }
          signal = merged.signal;
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
        // 测试连接同样按模型能力清洗参数（如 GPT-5/o 系列须用 max_completion_tokens），
        // 避免"测试连接失败"误导用户以为网络/Key 有问题。
        const testModel = modelName || FALLBACK_MODEL;
        let testBody: Record<string, unknown> = {
          model: testModel,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 5,
        };
        if (modelName) {
          testBody = prepareProviderRequest({
            baseUrl,
            modelId: modelName,
            request: testBody,
          });
        }
        try {
          res = await fetchFn(`${targetBase}${chatRoute}`, {
            method: "POST",
            headers,
            body: JSON.stringify(testBody),
            signal,
          });
        } catch (fetchErr: unknown) {
          const errMsg = fetchErr instanceof Error ? getErrorMessage(fetchErr) : String(fetchErr);
          return new Response(
            JSON.stringify({
              success: false,
              error: `网络请求失败，请检查 Base URL 是否可达及网络连接状态。具体错误: ${errMsg}`,
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
          let errorDetails = "";
          try {
            const clonedRes = res.clone();
            const errorJson = await clonedRes.json();
            errorDetails = errorJson?.error?.message || errorJson?.error || JSON.stringify(errorJson);
          } catch {
            try {
              errorDetails = await res.text();
            } catch {}
          }
          const finalMsg = `HTTP ${res.status}：请求被拒绝。` + (errorDetails ? `中转站返回: ${errorDetails}` : "请检查 API Key 与 Base URL 配置是否正确。");
          return new Response(
            JSON.stringify({
              success: false,
              error: finalMsg,
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
          const errMsg = fetchErr instanceof Error ? getErrorMessage(fetchErr) : String(fetchErr);
          return new Response(
            JSON.stringify({ success: false, error: `网络请求失败，请检查 Base URL 是否可达。具体错误: ${errMsg}` }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }

        if (!res.ok) {
          let errorDetails = "";
          try {
            const clonedRes = res.clone();
            const errorJson = await clonedRes.json();
            errorDetails = errorJson?.error?.message || errorJson?.error || JSON.stringify(errorJson);
          } catch {
            try {
              errorDetails = await res.text();
            } catch {}
          }
          const finalMsg = `HTTP ${res.status}：获取模型列表失败。` + (errorDetails ? `中转站返回: ${errorDetails}` : "请检查接口配置。");
          return new Response(
            JSON.stringify({
              success: false,
              error: finalMsg,
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

        let modelsArray: unknown[] = [];
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
              (v): v is ModelLike =>
                typeof v === "object" &&
                v !== null &&
                (typeof (v as ModelLike).id === "string" || typeof (v as ModelLike).name === "string")
            );
          }
        }

        const normalized = modelsArray
          .map((value) => {
            const model = value as ModelLike;
            const id = typeof model.id === "string" ? model.id : typeof model.name === "string" ? model.name : null;
            return id ? { id } : null;
          })
          .filter((m): m is { id: string } => m !== null);

        return new Response(
          JSON.stringify({ success: true, models: normalized }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (endpoint === "/api/proxy/openai") {
        let openAiRes: Response | null = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          openAiRes = await fetchFn(`${targetBase}${chatRoute}`, {
            method: "POST",
            headers,
            body: JSON.stringify(cleanedReqBody),
            signal,
          });
          if (openAiRes.ok || attempt === 2) break;
          const errText = await openAiRes.clone().text();
          const unsupported = ModelCapabilityRegistry.isUnsupportedParamError(errText);
          if (!unsupported) break;
          if (unsupported.capability && modelId) {
            ModelCapabilityRegistry.updateCapabilities(
              modelId,
              { [unsupported.capability]: false },
              baseUrl,
            );
          }
          const nextBody = removeUnsupportedRequestFields(cleanedReqBody, unsupported.requestFields);
          if (JSON.stringify(nextBody) === JSON.stringify(cleanedReqBody)) break;
          cleanedReqBody = nextBody;
          log.warn("Auto-healing: removed unsupported provider parameters", {
            fields: unsupported.requestFields,
            modelId,
            attempt: attempt + 1,
          });
        }
        if (!openAiRes) throw new Error("LLM_REQUEST_NOT_SENT");

        // P1-9: 对非流式响应做字段白名单清洗，剥离中转站注入的非标字段
        // （如 extra_data / debug_info / prompt_hash），
        // 防止脏数据渗透到 sessions 表与消息渲染管线。
        // 流式响应（stream: true）由 streamReader 逐 chunk 处理，仅提取
        // choices[].delta.content / reasoning_content，无需清洗。
        if (cleanedReqBody.stream !== true && openAiRes.ok) {
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
    history: unknown[],
    clientContext?: unknown,
    traceId?: string
  ): Promise<{ reply: string; expression: string }> {
    const log = traceId ? logger.withTrace(traceId) : logger;
    void log; // 当前 sendCatbotRequest 无日志输出，保留 log 供未来错误追踪扩展
    const normalizedClientContext =
      clientContext && typeof clientContext === "object"
        ? (clientContext as Record<string, unknown>)
        : {};
    const deviceId =
      typeof normalizedClientContext.deviceId === "string"
        ? normalizedClientContext.deviceId
        : "";
    const isTauri = this.isClientMode();
    let fetchFn = tauriFetch || fetch;
    if (!tauriFetch && tauriFetchPromise) {
      const resolvedFetch = await tauriFetchPromise;
      fetchFn = resolvedFetch || fetch;
    }
    
    const targetUrl = isTauri
      ? CLOUD_ENDPOINTS.catbot
      : "/api/catbot";
    
    const res = await fetchFn(targetUrl, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "X-Device-Id": deviceId
      },
      body: JSON.stringify({ 
        content, 
        history, 
        clientContext: {
          ...normalizedClientContext,
          device_id: deviceId
        } 
      }),
    });
    
    if (!res.ok) {
      let errText = "";
      try {
        errText = await res.text();
      } catch {}
      throw new Error(`HTTP error ${res.status}: ${errText}`);
    }
    
    return res.json();
  }
}
