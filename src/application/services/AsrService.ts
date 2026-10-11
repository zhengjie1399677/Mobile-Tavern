import { IKernel, IAsrService, AsrConfig } from "../serviceContracts";
import { Logger } from "../../utils/logger";

const logger = Logger.create("AsrService");

/** Tauri WebView 注入的内部接口声明（与 src/utils/keyManager.ts、LLMService.ts 对齐）。 */
interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
}

// tauriFetch 用于在 Tauri 移动端/桌面端环境下发起跨域请求
let tauriFetch: typeof fetch | null = null;
let tauriFetchPromise: Promise<typeof fetch | null> | null = null;

// 如果当前处于 Web 视图环境中，且检测到 Tauri 环境，则动态导入 Tauri HTTP 插件中的 fetch
if (typeof window !== "undefined" && (window as TauriWindow).__TAURI_INTERNALS__) {
  tauriFetchPromise = import("@tauri-apps/plugin-http")
    .then((mod) => {
      tauriFetch = mod.fetch;
      return mod.fetch;
    })
    .catch((): null => null);
}

/**
 * 语音识别服务 (ASR Service)
 *
 * 只提供 **文件转写**（OpenAI Whisper）能力：实时听写（Web Speech）已下线，
 * 麦克风采集统一由 VoiceCaptureService 负责。
 */
export class AsrService implements IAsrService {
  name = "asr";
  isCritical = false;
  dependencies = [] as const;

  private abortController: AbortController | null = null; // 用于取消异步任务的控制器

  /**
   * 初始化服务
   * @param kernel 内核实例
   * @param signal 外部传入的取消信号，用于配合服务销毁
   */
  async init(kernel: IKernel, signal?: AbortSignal): Promise<void> {
    logger.info("Initializing");
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener("abort", () => this.abortController?.abort());
    }
    // 提前解析 Tauri fetch 插件，避免录音结束上传时临时加载造成延迟
    if (tauriFetchPromise) {
      try {
        await tauriFetchPromise;
      } catch (e) {
        logger.warn("Failed to pre-resolve Tauri fetch", { error: e });
      }
    }
  }

  /**
   * 销毁服务：中断在途请求
   */
  async destroy(kernel: IKernel, signal?: AbortSignal): Promise<void> {
    this.abortController?.abort();
    this.abortController = null;
    logger.info("Destroyed");
  }

  async transcribeFile(
    blob: Blob,
    fileName: string,
    config: AsrConfig,
    signal?: AbortSignal,
  ): Promise<string> {
    if (config.provider !== "openai") {
      throw new Error("ASR_FILE_PROVIDER_UNSUPPORTED");
    }
    if (blob.size <= 0 || !blob.type.startsWith("audio/")) {
      throw new Error("ASR_FILE_INVALID");
    }
    // 文件名清洗：控制字符（含 C1）与文件系统保留字符统一替换为下划线。
    const normalizedName = fileName.trim().replace(/[\p{Cc}\\\/:*?"<>|]/gu, "_").slice(0, 120)
      || "audio.bin";
    const linked = linkAbortSignals([signal, this.abortController?.signal]);
    try {
      return await this.uploadToWhisper(blob, normalizedName, config, linked.signal);
    } finally {
      linked.dispose();
    }
  }

  /**
   * 将录音 Blob 数据上传至 Whisper 接口进行语音转文字
   * @param blob 音频文件 Blob
   * @param fileName 上传时使用的安全文件名
   * @param config ASR 配置参数
   */
  private async uploadToWhisper(
    blob: Blob,
    fileName: string,
    config: AsrConfig,
    signal?: AbortSignal,
  ): Promise<string> {
    let fetchFn = tauriFetch || fetch;
    // 如果 Tauri fetch 尚未解析完毕，在此等待解析
    if (!tauriFetch && tauriFetchPromise) {
      const resolvedFetch = await tauriFetchPromise;
      fetchFn = resolvedFetch || fetch;
    }

    const baseUrl = config.openaiBaseUrl ? config.openaiBaseUrl.trim().replace(/\/+$/, "") : "https://api.openai.com/v1";
    const url = `${baseUrl}/audio/transcriptions`;

    // 构建 Whisper API 标准的 FormData 参数
    const formData = new FormData();
    formData.append("file", blob, fileName);
    formData.append("model", config.openaiModel || "whisper-1");
    if (config.language) {
      formData.append("language", config.language);
    }

    const headers: Record<string, string> = {};
    if (config.openaiApiKey) {
      headers["Authorization"] = `Bearer ${config.openaiApiKey}`;
    }

    const response = await fetchFn(url, {
      method: "POST",
      headers,
      body: formData,
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "Unknown error");
      throw new Error(`OpenAI Whisper request failed with status ${response.status}: ${errText}`);
    }

    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || typeof (data as { text?: unknown }).text !== "string") {
      throw new Error("ASR_RESPONSE_INVALID");
    }
    return (data as { text: string }).text;
  }
}

function linkAbortSignals(signals: ReadonlyArray<AbortSignal | undefined>): {
  signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const listener = () => controller.abort(signal.reason);
    signal.addEventListener("abort", listener, { once: true });
    listeners.push({ signal, listener });
  }
  return {
    signal: controller.signal,
    dispose() {
      for (const item of listeners) item.signal.removeEventListener("abort", item.listener);
    },
  };
}
