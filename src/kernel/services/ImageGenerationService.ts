import { IKernel, IKernelService, IImageGenerationService } from "../types";
import { ImageGenApiConfig } from "../../types";

/**
 * Tauri 运行时注入到 window 的内部桥接对象。
 * 仅用于检测当前是否处于 Tauri 容器环境（区分浏览器 / Tauri / Node 测试环境）。
 */
interface WindowWithTauriInternals extends Window {
  __TAURI_INTERNALS__?: unknown;
}

let tauriFetch: typeof fetch | null = null;
let tauriFetchPromise: Promise<typeof fetch | null> | null = null;

if (typeof window !== "undefined" && (window as WindowWithTauriInternals).__TAURI_INTERNALS__) {
  tauriFetchPromise = import("@tauri-apps/plugin-http")
    .then((mod) => {
      tauriFetch = mod.fetch;
      return mod.fetch;
    })
    .catch(() => null);
}

export class ImageGenerationService implements IImageGenerationService {
  name = "imageGen";
  isCritical = false;
  dependencies = [] as const;

  private abortController: AbortController | null = null;

  async init(kernel: IKernel, signal?: AbortSignal): Promise<void> {
    console.log("[ImageGenerationService] Initializing...");
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener("abort", () => this.abortController?.abort());
    }

    // Proactively resolve tauriFetch in init
    if (tauriFetchPromise) {
      try {
        await tauriFetchPromise;
      } catch (e) {
        console.warn("[ImageGenerationService] Failed to pre-resolve Tauri fetch:", e);
      }
    }
  }

  async destroy(kernel: IKernel, signal?: AbortSignal): Promise<void> {
    this.abortController?.abort();
    this.abortController = null;
    console.log("[ImageGenerationService] Destroyed.");
  }

  async generateImage(prompt: string, config: ImageGenApiConfig, signal?: AbortSignal): Promise<string> {
    if (!config || !config.enabled || !config.baseUrl?.trim()) {
      throw new Error("未配置api");
    }

    const activeSignal = signal || this.abortController?.signal;

    if (activeSignal?.aborted) {
      throw new Error("Generation aborted before request started");
    }

    let fetchFn = tauriFetch || fetch;
    if (!tauriFetch && tauriFetchPromise) {
      const resolvedFetch = await tauriFetchPromise;
      fetchFn = resolvedFetch || fetch;
    }

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      timeoutController.abort(new Error("Image generation request timed out after 60 seconds"));
    }, 60000);

    if (activeSignal) {
      if (activeSignal.aborted) {
        timeoutController.abort(activeSignal.reason || new Error("Generation aborted"));
        clearTimeout(timeoutId);
      } else {
        activeSignal.addEventListener("abort", () => {
          timeoutController.abort(activeSignal.reason || new Error("Generation aborted"));
        });
      }
    }

    let baseUrlClean = config.baseUrl ? config.baseUrl.trim().replace(/\/+$/, "") : "";
    if (baseUrlClean) {
      if (baseUrlClean.endsWith("/images/generations")) {
        baseUrlClean = baseUrlClean.substring(0, baseUrlClean.length - "/images/generations".length);
      } else if (baseUrlClean.endsWith("/images")) {
        baseUrlClean = baseUrlClean.substring(0, baseUrlClean.length - "/images".length);
      }
      baseUrlClean = baseUrlClean.replace(/\/+$/, "");
    }

    let apiType = config.type || "openai-dalle";
    if (!config.forceProtocol) {
      const urlLower = baseUrlClean.toLowerCase();
      if (urlLower.includes("novelai")) {
        apiType = "novelai";
      } else if (urlLower.includes("7860") || urlLower.includes("sdapi") || urlLower.includes("sd-webui")) {
        apiType = "sd-webui";
      } else {
        apiType = "openai-dalle";
      }
    }
    let url = "";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    let bodyObj: any = {};

    if (apiType === "openai-dalle") {
      let base = baseUrlClean || "https://api.openai.com/v1";
      if (!base.endsWith("/v1") && !base.includes("/v1/")) {
        base += "/v1";
      }
      const isOpenRouter = base.toLowerCase().includes("openrouter.ai");
      url = isOpenRouter ? `${base}/images` : `${base}/images/generations`;

      if (config.apiKey) {
        headers["Authorization"] = `Bearer ${config.apiKey}`;
      }

      bodyObj = {
        model: config.modelName || "dall-e-3",
        prompt: `${config.promptPrefix || ""}${prompt}`,
        n: 1,
        size: `${config.width || 1024}x${config.height || 1024}`,
        response_format: "b64_json",
      };
    } else if (apiType === "sd-webui") {
      const base = baseUrlClean || "http://127.0.0.1:7860";
      url = `${base}/sdapi/v1/txt2img`;

      if (config.apiKey) {
        headers["Authorization"] = `Bearer ${config.apiKey}`;
      }

      bodyObj = {
        prompt: `${config.promptPrefix || ""}${prompt}`,
        negative_prompt: config.negativePrompt || "",
        steps: config.steps || 20,
        cfg_scale: config.cfgScale || 7.0,
        width: config.width || 512,
        height: config.height || 512,
        sampler_name: config.sampler || "Euler a",
      };
      if (config.modelName) {
        bodyObj.override_settings = {
          sd_model_checkpoint: config.modelName,
        };
      }
    } else if (apiType === "novelai") {
      const base = baseUrlClean || "https://image.novelai.net";
      url = `${base}/ai/generate-image`;

      if (config.apiKey) {
        headers["Authorization"] = `Bearer ${config.apiKey}`;
      }

      bodyObj = {
        input: `${config.promptPrefix || ""}${prompt}`,
        model: config.modelName || "safe-diffusion",
        action: "generate",
        parameters: {
          width: config.width || 512,
          height: config.height || 768,
          scale: config.cfgScale || 7.0,
          sampler: config.sampler || "k_euler",
          steps: config.steps || 28,
          n_samples: 1,
          negative_prompt: config.negativePrompt || "",
        },
      };
    } else {
      throw new Error(`Unsupported API type: ${apiType}`);
    }

    const isBrowserEnv = typeof window !== "undefined" &&
                         !(window as WindowWithTauriInternals).__TAURI_INTERNALS__ &&
                         (typeof process === "undefined" || process.env.NODE_ENV !== "test");
    const isRemoteUrl = url.startsWith("https://") || (url.startsWith("http://") && !url.includes("127.0.0.1") && !url.includes("localhost"));

    let finalUrl = url;
    let finalHeaders = headers;
    let finalBody = JSON.stringify(bodyObj);

    if (isBrowserEnv && isRemoteUrl) {
      finalUrl = "/api/proxy/image-gen";
      finalHeaders = {
        "Content-Type": "application/json",
      };
      finalBody = JSON.stringify({
        targetUrl: url,
        headers,
        bodyObj,
      });
    }

    let response: Response;
    try {
      response = await fetchFn(finalUrl, {
        method: "POST",
        headers: finalHeaders,
        body: finalBody,
        signal: timeoutController.signal,
      });
    } catch (err: any) {
      if (err.name === "AbortError" && timeoutController.signal.aborted) {
        throw new Error("Image generation request timed out after 60 seconds");
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Image generation request failed with status ${response.status}: ${errorText}`);
    }

    if (apiType === "openai-dalle") {
      const json = await response.json();
      if (json.data && json.data[0]) {
        if (json.data[0].b64_json) {
          return `data:image/png;base64,${json.data[0].b64_json}`;
        } else if (json.data[0].url) {
          return json.data[0].url;
        }
      }
      throw new Error("No image data found in OpenAI DALL-E response");
    } else if (apiType === "sd-webui") {
      const json = await response.json();
      if (json.images && json.images[0]) {
        return `data:image/png;base64,${json.images[0]}`;
      }
      throw new Error("No image data found in SD WebUI response");
    } else if (apiType === "novelai") {
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      
      let binary = "";
      const len = bytes.byteLength;
      const chunkSize = 8192;
      for (let i = 0; i < len; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        // String.fromCharCode.apply 的第二参数期望 number[]；Uint8Array 在运行时
        // 可被 apply 视为数组对象，此处仅做类型层适配，不改变运行时行为。
        binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
      }
      const base64 = btoa(binary);
      return `data:image/png;base64,${base64}`;
    }

    throw new Error("Invalid state");
  }
}
