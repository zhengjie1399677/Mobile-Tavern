import { IKernel, IKernelService, ITtsService } from "../types";

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

export class TtsService implements ITtsService {
  name = "tts";
  isCritical = false;
  dependencies = [] as const;

  private abortController: AbortController | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private isSpeakingState = false;
  private onStopCallback: (() => void) | null = null;
  private speakingMessageId: string | null = null;

  async init(kernel: IKernel, signal?: AbortSignal): Promise<void> {
    console.log("[TtsService] Initializing...");
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener("abort", () => this.abortController?.abort());
    }
    if (tauriFetchPromise) {
      try {
        await tauriFetchPromise;
      } catch (e) {
        console.warn("[TtsService] Failed to pre-resolve Tauri fetch:", e);
      }
    }
  }

  async destroy(kernel: IKernel, signal?: AbortSignal): Promise<void> {
    this.stop();
    this.abortController?.abort();
    this.abortController = null;
    console.log("[TtsService] Destroyed.");
  }

  isSpeaking(): boolean {
    if (typeof window !== "undefined") {
      const bridge = (window as any).AndroidThemeBridge;
      if (bridge && typeof bridge.isSpeakingNative === "function") {
        try {
          return bridge.isSpeakingNative() || this.isSpeakingState;
        } catch {}
      }
    }
    return this.isSpeakingState;
  }

  getSpeakingMessageId(): string | null {
    return this.speakingMessageId;
  }

  setSpeakingMessageId(id: string | null): void {
    this.speakingMessageId = id;
  }

  async speak(text: string, config: any, signal?: AbortSignal): Promise<void> {
    this.stop(); // 启动新语音前，打断上一轮语音播放

    const activeSignal = signal || this.abortController?.signal;
    if (activeSignal?.aborted) {
      throw new Error("Speech aborted before request started");
    }

    // 清洗文本：移除朗读时可能被读出来的 Markdown 符号和引号，避免 TTS 读出“星号”或“引号”
    const cleanedText = (text || "")
      .replace(/\*\*+/g, "") // 移除粗体星号
      .replace(/\*/g, "")    // 移除单星号
      .replace(/_+/g, "")    // 移除斜体下划线
      .replace(/["“”'‘’`«»]/g, " ") // 将引号替换为空格以防朗读停顿问题
      .replace(/\s+/g, " ")  // 合并空格
      .trim();

    if (!cleanedText) {
      return; // 没有有效文本，安全退出
    }

    this.isSpeakingState = true;
    this.speakingMessageId = config.messageId || null;
    const provider = config.provider || "speech-synthesis";

    if (provider === "speech-synthesis") {
      // 移动端：强制走 Android 原生 TextToSpeech，不再回退 Web Speech API
      const bridge = typeof window !== "undefined" ? (window as any).AndroidThemeBridge : null;
      if (!bridge || typeof bridge.speakNative !== "function") {
        this.isSpeakingState = false;
        throw new Error("Android native TTS bridge is not available. Web Speech API fallback has been removed in favor of native TTS.");
      }

      const rate = config.rate ?? 1.0;
      const pitch = config.pitch ?? 1.0;
      const success = bridge.speakNative(cleanedText, rate, pitch);
      if (!success) {
        this.isSpeakingState = false;
        this.speakingMessageId = null;
        throw new Error("Failed to initialize Android Native TTS");
      }

      await new Promise<void>((resolve) => {
        let intervalId: any = null;
        const onAbort = () => {
          if (bridge && typeof bridge.stopNative === "function") {
            try {
              bridge.stopNative();
            } catch {}
          }
          cleanup();
          resolve();
        };

        const cleanup = () => {
          this.isSpeakingState = false;
          this.speakingMessageId = null;
          this.onStopCallback = null;
          if (intervalId) clearInterval(intervalId);
          activeSignal?.removeEventListener("abort", onAbort);
        };

        this.onStopCallback = onAbort;
        if (activeSignal) {
          activeSignal.addEventListener("abort", onAbort);
        }

        let hasStartedSpeaking = false;
        let silenceTicks = 0;
        intervalId = setInterval(() => {
          if (activeSignal?.aborted) {
            cleanup();
            resolve();
            return;
          }
          const speaking = bridge.isSpeakingNative();
          if (speaking) {
            hasStartedSpeaking = true;
            silenceTicks = 0;
          } else {
            if (hasStartedSpeaking) {
              cleanup();
              resolve();
            } else {
              silenceTicks++;
              if (silenceTicks > 30) {
                cleanup();
                resolve();
              }
            }
          }
        }, 100);
      });
      return;

    } else if (provider === "openai") {
      let fetchFn = tauriFetch || fetch;
      if (!tauriFetch && tauriFetchPromise) {
        const resolvedFetch = await tauriFetchPromise;
        fetchFn = resolvedFetch || fetch;
      }

      let baseUrl = config.openaiBaseUrl ? config.openaiBaseUrl.trim().replace(/\/+$/, "") : "https://api.openai.com/v1";
      const url = `${baseUrl}/audio/speech`;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (config.openaiApiKey) {
        headers["Authorization"] = `Bearer ${config.openaiApiKey}`;
      }

      const isBrowserEnv = typeof window !== "undefined" &&
                           !(window as any).__TAURI_INTERNALS__ &&
                           (typeof process === "undefined" || process.env.NODE_ENV !== "test");
      const isRemoteUrl = url.startsWith("https://") || (url.startsWith("http://") && !url.includes("127.0.0.1") && !url.includes("localhost"));

      let finalUrl = url;
      let finalHeaders = headers;
      let finalBody = JSON.stringify({
        model: config.openaiModel || "tts-1",
        input: cleanedText,
        voice: config.openaiVoice || "alloy",
        response_format: "mp3"
      });

      if (isBrowserEnv && isRemoteUrl) {
        finalUrl = "/api/proxy/image-gen"; // 重用通用代理服务避免浏览器开发跨域
        finalHeaders = {
          "Content-Type": "application/json",
        };
        finalBody = JSON.stringify({
          targetUrl: url,
          headers,
          bodyObj: {
            model: config.openaiModel || "tts-1",
            input: cleanedText,
            voice: config.openaiVoice || "alloy",
            response_format: "mp3"
          }
        });
      }

      const fetchController = new AbortController();
      const onAbort = () => {
        fetchController.abort();
        this.stop();
      };
      if (activeSignal) {
        activeSignal.addEventListener("abort", onAbort);
      }

      let response: Response;
      try {
        response = await fetchFn(finalUrl, {
          method: "POST",
          headers: finalHeaders,
          body: finalBody,
          signal: fetchController.signal
        });
      } catch (err: any) {
        this.isSpeakingState = false;
        this.speakingMessageId = null;
        if (activeSignal) {
          activeSignal.removeEventListener("abort", onAbort);
        }
        throw err;
      }

      if (!response.ok) {
        this.isSpeakingState = false;
        this.speakingMessageId = null;
        if (activeSignal) {
          activeSignal.removeEventListener("abort", onAbort);
        }
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(`OpenAI TTS request failed with status ${response.status}: ${errorText}`);
      }

      const buffer = await response.arrayBuffer();
      const blob = new Blob([buffer], { type: "audio/mpeg" });
      const audioUrl = URL.createObjectURL(blob);

      const audio = new Audio(audioUrl);
      this.currentAudio = audio;
      audio.volume = config.volume ?? 0.5;
      audio.playbackRate = config.rate ?? 1.0;

      await new Promise<void>((resolve, reject) => {
        const onEnded = () => {
          cleanup();
          resolve();
        };
        const onError = (e: any) => {
          cleanup();
          reject(new Error(`Audio element error: ${e.message || "Unknown audio error"}`));
        };
        const onAudioStop = () => {
          cleanup();
          resolve();
        };

        const cleanup = () => {
          this.isSpeakingState = false;
          this.speakingMessageId = null;
          this.currentAudio = null;
          this.onStopCallback = null;
          audio.removeEventListener("ended", onEnded);
          audio.removeEventListener("error", onError);
          activeSignal?.removeEventListener("abort", onAbort);
          try {
            audio.pause();
            audio.src = "";
          } catch {}
          URL.revokeObjectURL(audioUrl);
        };

        this.onStopCallback = onAudioStop;

        audio.addEventListener("ended", onEnded);
        audio.addEventListener("error", onError);

        audio.play().catch((err) => {
          cleanup();
          reject(new Error(`Audio play failed: ${err.message}`));
        });
      });

      if (activeSignal) {
        activeSignal.removeEventListener("abort", onAbort);
      }
    }
  }

  stop(): void {
    this.isSpeakingState = false;
    this.speakingMessageId = null;

    // 中止安卓原生 TTS 朗读
    if (typeof window !== "undefined") {
      const bridge = (window as any).AndroidThemeBridge;
      if (bridge && typeof bridge.stopNative === "function") {
        try {
          bridge.stopNative();
        } catch {}
      }
    }

    // 中止 HTML5 Audio 播放
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.src = "";
      } catch {}
      this.currentAudio = null;
    }

    // 唤醒 Promise
    if (this.onStopCallback) {
      this.onStopCallback();
      this.onStopCallback = null;
    }
  }

  pause(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
    } else if (typeof window !== "undefined") {
      const bridge = (window as any).AndroidThemeBridge;
      if (bridge && typeof bridge.stopNative === "function") {
        try {
          bridge.stopNative();
        } catch {}
      }
    }
  }

  resume(): void {
    if (this.currentAudio) {
      this.currentAudio.play().catch(() => {});
    }
    // Android 原生 TTS 暂停时已被 stop，无法从断点恢复
  }
}
