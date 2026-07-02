import { IKernel, IKernelService, IImageGenerationService } from "../types";
import { ImageGenApiConfig } from "../../types";

let tauriFetch: typeof fetch | null = null;
let tauriFetchPromise: Promise<typeof fetch | null> | null = null;

if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
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
    const activeSignal = signal || this.abortController?.signal;

    if (activeSignal?.aborted) {
      throw new Error("Generation aborted before request started");
    }

    let fetchFn = tauriFetch || fetch;
    if (!tauriFetch && tauriFetchPromise) {
      const resolvedFetch = await tauriFetchPromise;
      fetchFn = resolvedFetch || fetch;
    }

    const apiType = config.type || "openai-dalle";
    let url = "";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    let bodyObj: any = {};

    const baseUrlClean = config.baseUrl ? config.baseUrl.replace(/\/+$/, "") : "";

    if (apiType === "openai-dalle") {
      let base = baseUrlClean || "https://api.openai.com/v1";
      if (!base.endsWith("/v1") && !base.includes("/v1/")) {
        base += "/v1";
      }
      url = `${base}/images/generations`;

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

    const response = await fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify(bodyObj),
      signal: activeSignal,
    });

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
        binary += String.fromCharCode.apply(null, chunk as any);
      }
      const base64 = btoa(binary);
      return `data:image/png;base64,${base64}`;
    }

    throw new Error("Invalid state");
  }
}
