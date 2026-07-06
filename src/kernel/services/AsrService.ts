import { IKernel, IKernelService, IAsrService, AsrConfig } from "../types";

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

export class AsrService implements IAsrService {
  name = "asr";
  isCritical = false;
  dependencies = [] as const;

  private isListeningState = false;
  private activeRecognition: any = null; // webkitSpeechRecognition instance
  private activeMediaRecorder: MediaRecorder | null = null;
  private activeStream: MediaStream | null = null;
  private abortController: AbortController | null = null;

  async init(kernel: IKernel, signal?: AbortSignal): Promise<void> {
    console.log("[AsrService] Initializing...");
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener("abort", () => this.abortController?.abort());
    }
    if (tauriFetchPromise) {
      try {
        await tauriFetchPromise;
      } catch (e) {
        console.warn("[AsrService] Failed to pre-resolve Tauri fetch:", e);
      }
    }
  }

  async destroy(kernel: IKernel, signal?: AbortSignal): Promise<void> {
    this.cancelListening();
    this.abortController?.abort();
    this.abortController = null;
    console.log("[AsrService] Destroyed.");
  }

  isListening(): boolean {
    return this.isListeningState;
  }

  async startListening(
    config: AsrConfig,
    onResult: (text: string, isFinal: boolean) => void,
    onError: (err: any) => void,
    onEnd?: () => void
  ): Promise<void> {
    if (this.isListeningState) {
      this.cancelListening();
    }

    this.isListeningState = true;

    if (config.provider === "web-speech") {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (!SpeechRecognition) {
        this.isListeningState = false;
        throw new Error("Speech recognition is not supported in this browser.");
      }

      try {
        const recognition = new SpeechRecognition();
        this.activeRecognition = recognition;
        recognition.lang = config.language || "zh-CN";
        recognition.interimResults = true;
        recognition.continuous = true;

        recognition.onresult = (event: any) => {
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

        recognition.onerror = (event: any) => {
          console.error("[AsrService] WebSpeech error:", event.error);
          onError(new Error(`Speech recognition error: ${event.error}`));
          this.cleanupWebSpeech();
          onEnd?.();
        };

        recognition.onend = () => {
          this.cleanupWebSpeech();
          onEnd?.();
        };

        recognition.start();
      } catch (err: any) {
        this.isListeningState = false;
        this.activeRecognition = null;
        throw err;
      }
    } else if (config.provider === "openai") {
      if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.isListeningState = false;
        throw new Error("Microphone recording is not supported in this environment.");
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.activeStream = stream;

        // 尝试检测支持的 MIME 类型，优先使用 webm
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

        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            chunks.push(e.data);
          }
        };

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
            const resultText = await this.uploadToWhisper(audioBlob, extension, config);
            onResult(resultText, true);
          } catch (err: any) {
            console.error("[AsrService] OpenAI Whisper upload error:", err);
            onError(err);
          } finally {
            onEnd?.();
          }
        };

        mediaRecorder.start();
      } catch (err: any) {
        this.cleanupMediaRecorder();
        this.isListeningState = false;
        throw err;
      }
    }
  }

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

  private cleanupWebSpeech() {
    this.isListeningState = false;
    this.activeRecognition = null;
  }

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

  private cleanupMediaRecorder() {
    this.isListeningState = false;
    if (this.activeMediaRecorder && this.activeMediaRecorder.state !== "inactive") {
      try {
        this.activeMediaRecorder.stop();
      } catch {}
    }
    this.cleanupMediaRecorderOnly();
  }

  private async uploadToWhisper(blob: Blob, extension: string, config: AsrConfig): Promise<string> {
    let fetchFn = tauriFetch || fetch;
    if (!tauriFetch && tauriFetchPromise) {
      const resolvedFetch = await tauriFetchPromise;
      fetchFn = resolvedFetch || fetch;
    }

    let baseUrl = config.openaiBaseUrl ? config.openaiBaseUrl.trim().replace(/\/+$/, "") : "https://api.openai.com/v1";
    const url = `${baseUrl}/audio/transcriptions`;

    const formData = new FormData();
    formData.append("file", blob, `audio.${extension}`);
    formData.append("model", config.openaiModel || "whisper-1");
    if (config.language) {
      formData.append("language", config.language);
    }

    const headers: Record<string, string> = {};
    if (config.openaiApiKey) {
      headers["Authorization"] = `Bearer ${config.openaiApiKey}`;
    }

    const isBrowserEnv = typeof window !== "undefined" &&
                         !(window as any).__TAURI_INTERNALS__ &&
                         (typeof process === "undefined" || process.env.NODE_ENV !== "test");
    const isRemoteUrl = url.startsWith("https://") || (url.startsWith("http://") && !url.includes("127.0.0.1") && !url.includes("localhost"));

    let finalUrl = url;
    let finalHeaders = headers;
    let finalBody: any = formData;

    // 如果在非 Tauri 浏览器环境请求外部 HTTPS 资源，为避免跨域，我们将使用与图片生成、TTS 类似的机制，
    // 但由于 FormData 序列化的复杂性，在代理端通常需要多端匹配或直接通过 nativeWebView。
    // 在 WebView 运行环境中通常都是直连。在此我们支持标准代理，如果代理不支持 file 上传则抛出提示。
    if (isBrowserEnv && isRemoteUrl) {
      // 浏览器环境由于 CORS 限制，优先检测如果有 native WebView 桥接可以考虑桥接，或者直连。
      // 这里直接发起 fetch 请求，因为很多中转端或 OpenAI API 开启了 CORS。若确实失败，由用户配置解决。
    }

    const response = await fetchFn(finalUrl, {
      method: "POST",
      headers: finalHeaders,
      body: finalBody,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "Unknown error");
      throw new Error(`OpenAI Whisper request failed with status ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return data.text || "";
  }
}
