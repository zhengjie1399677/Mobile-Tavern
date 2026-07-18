import { IBgmService, IKernel } from "../types";

export class BgmService implements IBgmService {
  name = "bgm";
  isCritical = false;
  dependencies = [] as const;

  private audio: HTMLAudioElement | null = null;
  private currentUrl: string = "";
  private isMuted: boolean = false;
  private defaultVolume: number = 0.5;
  private lastFailedUrl: string = "";

  async init(kernel: IKernel, signal?: AbortSignal): Promise<void> {
    this.audio = new Audio();
    this.audio.loop = true;
    
    // 捕获加载中的网络错误，防止系统崩溃与无限刷屏
    this.audio.addEventListener("error", (e) => {
      // 如果当前没有有效 src，或者是由于清除 src 引起的空事件，直接忽略
      if (!this.currentUrl || !this.audio?.src || this.audio.src === window.location.href) {
        return;
      }
      // 避免同一死链接无限重复打印 Warning 刷屏
      if (this.lastFailedUrl !== this.currentUrl) {
        this.lastFailedUrl = this.currentUrl;
        console.warn(`[BgmService] Audio loading error (${this.currentUrl}):`, e);
      }
    });

    if (signal) {
      signal.addEventListener("abort", () => this.stop());
    }
  }

  async destroy(kernel: IKernel, signal?: AbortSignal): Promise<void> {
    this.stop();
    this.audio = null;
  }

  play(url: string, volume: number = 0.5) {
    if (!this.audio) return;
    this.defaultVolume = volume;

    const trimmedUrl = (url || "").trim();
    if (!trimmedUrl) {
      this.stop();
      return;
    }

    // 若 URL 没变且在正常播放中，仅调节音量
    if (this.currentUrl === trimmedUrl && !this.audio.paused) {
      this.audio.volume = this.isMuted ? 0 : volume;
      return;
    }

    // 若当前 URL 之前已失败，防止无限重复触发重试
    if (this.currentUrl === trimmedUrl && this.lastFailedUrl === trimmedUrl) {
      return;
    }

    this.currentUrl = trimmedUrl;
    this.audio.src = trimmedUrl;
    this.audio.volume = this.isMuted ? 0 : volume;
    
    this.audio.play().catch((err) => {
      // 捕获自动播放限制或失败，去重日志
      if (this.lastFailedUrl !== trimmedUrl) {
        this.lastFailedUrl = trimmedUrl;
        console.warn("[BgmService] Autoplay blocked or failed:", err.message);
      }
    });
  }

  stop() {
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
    }
    this.currentUrl = "";
    this.lastFailedUrl = "";
  }

  mute() {
    this.isMuted = true;
    if (this.audio) {
      this.audio.volume = 0;
    }
  }

  unmute() {
    this.isMuted = false;
    if (this.audio) {
      this.audio.volume = this.defaultVolume;
    }
  }

  toggleMute(): boolean {
    if (this.isMuted) {
      this.unmute();
    } else {
      this.mute();
    }
    return this.isMuted;
  }

  getMuteState(): boolean {
    return this.isMuted;
  }

  getCurrentUrl(): string {
    return this.currentUrl;
  }
}
