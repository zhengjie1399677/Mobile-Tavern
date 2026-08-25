import { IKernel, IAsrService, AsrConfig } from "../serviceContracts";
import { Logger } from "../../utils/logger";

const logger = Logger.create("AsrService");

/** Tauri WebView 注入的内部接口声明（与 src/utils/keyManager.ts、LLMService.ts 对齐）。 */
interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
}

/** Web Speech API 最小类型声明（lib.dom 暂未内置）。 */
interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike;
}

interface WindowSpeechRecognition extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
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
 * 实现了 IAsrService 接口，支持 Web Speech API 和 OpenAI Whisper API 两种提供商
 */
export class AsrService implements IAsrService {
  name = "asr";
  isCritical = false;
  dependencies = [] as const;

  private isListeningState = false; // 是否处于正在倾听/录音状态
  private activeRecognition: SpeechRecognitionLike | null = null; // webkitSpeechRecognition 实例 (用于 Web Speech API)
  private activeMediaRecorder: MediaRecorder | null = null; // MediaRecorder 实例 (用于录制音频发送给 Whisper)
  private activeStream: MediaStream | null = null; // 麦克风音频流实例
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
   * 销毁服务
   * 取消当前倾听状态并释放资源
   */
  async destroy(kernel: IKernel, signal?: AbortSignal): Promise<void> {
    this.cancelListening();
    this.abortController?.abort();
    this.abortController = null;
    logger.info("Destroyed");
  }

  /**
   * 获取当前是否正在倾听
   */
  isListening(): boolean {
    return this.isListeningState;
  }

  /**
   * 开始语音识别/录音
   * @param config ASR 配置参数
   * @param onResult 识别结果回调。参数：text (识别出的文本), isFinal (是否为最终识别结果)
   * @param onError 错误回调
   * @param onEnd 结束回调
   */
  async startListening(
    config: AsrConfig,
    onResult: (text: string, isFinal: boolean) => void,
    onError: (err: unknown) => void,
    onEnd?: () => void
  ): Promise<void> {
    // 如果已经在倾听，先取消上一次的倾听
    if (this.isListeningState) {
      this.cancelListening();
    }

    this.isListeningState = true;

    // 模式 1: 使用浏览器原生 Web Speech API
    if (config.provider === "web-speech") {
      const SpeechRecognition =
        (window as WindowSpeechRecognition).SpeechRecognition || (window as WindowSpeechRecognition).webkitSpeechRecognition;

      if (!SpeechRecognition) {
        this.isListeningState = false;
        throw new Error("Speech recognition is not supported in this browser.");
      }

      try {
        const recognition = new SpeechRecognition();
        this.activeRecognition = recognition;
        recognition.lang = config.language || "zh-CN";
        recognition.interimResults = true; // 是否输出临时结果
        recognition.continuous = true; // 是否持续识别而不断开

        // 监听识别结果事件
        recognition.onresult = (event: SpeechRecognitionEvent) => {
          let interimTranscript = "";
          let finalTranscript = "";

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            } else {
              interimTranscript += event.results[i][0].transcript;
            }
          }

          const transcript = finalTranscript || interimTranscript;
          if (transcript) {
            onResult(transcript, !!finalTranscript);
          }
        };

        // 监听错误事件
        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
          logger.error("WebSpeech error", undefined, { error: event.error });
          onError(new Error(`Speech recognition error: ${event.error}`));
          this.cleanupWebSpeech();
          onEnd?.();
        };

        // 监听识别自然结束事件
        recognition.onend = () => {
          this.cleanupWebSpeech();
          onEnd?.();
        };

        recognition.start();
      } catch (err: unknown) {
        this.isListeningState = false;
        this.activeRecognition = null;
        throw err;
      }
    // 模式 2: 使用 OpenAI Whisper API 录音并上传
    } else if (config.provider === "openai") {
      if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.isListeningState = false;
        throw new Error("Microphone recording is not supported in this environment.");
      }

      try {
        // 请求麦克风权限，获取音频流
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.activeStream = stream;

        // 尝试检测支持的音频编码格式，优先使用 webm
        let options = {};
        if (typeof MediaRecorder.isTypeSupported === "function") {
          if (MediaRecorder.isTypeSupported("audio/webm")) {
            options = { mimeType: "audio/webm" };
          } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
            options = { mimeType: "audio/mp4" };
          }
        }

        const mediaRecorder = new MediaRecorder(stream, options);
        this.activeMediaRecorder = mediaRecorder;
        const chunks: Blob[] = [];

        // 录音数据块可用时存入临时数组
        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            chunks.push(e.data);
          }
        };

        // 录音停止后的回调：合并数据块并上传至 Whisper
        mediaRecorder.onstop = async () => {
          this.cleanupMediaRecorderOnly();
          if (chunks.length === 0) {
            onError(new Error("No audio chunks recorded."));
            onEnd?.();
            return;
          }

          try {
            const extension = mediaRecorder.mimeType.includes("mp4") ? "mp4" : "webm";
            const audioBlob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
            // 调用接口将录音文件上传至 Whisper 服务进行识别
            const resultText = await this.uploadToWhisper(
              audioBlob,
              `audio.${extension}`,
              config,
              this.abortController?.signal,
            );
            onResult(resultText, true);
          } catch (err: unknown) {
            logger.error("OpenAI Whisper upload error", err);
            onError(err);
          } finally {
            onEnd?.();
          }
        };

        mediaRecorder.start();
      } catch (err: unknown) {
        this.cleanupMediaRecorder();
        this.isListeningState = false;
        throw err;
      }
    }
  }

  /**
   * 停止当前识别/录音（对于录音而言，停止会触发上传并识别）
   */
  stopListening(): void {
    if (!this.isListeningState) return;

    if (this.activeRecognition) {
      try {
        this.activeRecognition.stop();
      } catch {}
    }

    if (this.activeMediaRecorder && this.activeMediaRecorder.state !== "inactive") {
      try {
        this.activeMediaRecorder.stop();
      } catch {}
    }
  }

  /**
   * 取消当前识别/录音（直接丢弃音频数据，不进行识别/上传）
   */
  cancelListening(): void {
    this.isListeningState = false;

    if (this.activeRecognition) {
      try {
        this.activeRecognition.abort();
      } catch {}
      this.cleanupWebSpeech();
    }

    this.cleanupMediaRecorder();
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
    const normalizedName = fileName.trim().replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_").slice(0, 120)
      || "audio.bin";
    const linked = linkAbortSignals([signal, this.abortController?.signal]);
    try {
      return await this.uploadToWhisper(blob, normalizedName, config, linked.signal);
    } finally {
      linked.dispose();
    }
  }

  /**
   * 清理 WebSpeech 状态
   */
  private cleanupWebSpeech() {
    this.isListeningState = false;
    this.activeRecognition = null;
  }

  /**
   * 仅清理录音机与音频流（不触发录音机 stop 事件）
   */
  private cleanupMediaRecorderOnly() {
    this.isListeningState = false;
    this.activeMediaRecorder = null;
    if (this.activeStream) {
      this.activeStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      this.activeStream = null;
    }
  }

  /**
   * 停止并清理录音机及所有相关资源
   */
  private cleanupMediaRecorder() {
    this.isListeningState = false;
    if (this.activeMediaRecorder && this.activeMediaRecorder.state !== "inactive") {
      try {
        this.activeMediaRecorder.stop();
      } catch {}
    }
    this.cleanupMediaRecorderOnly();
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
