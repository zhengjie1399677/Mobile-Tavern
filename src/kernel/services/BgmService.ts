import { IKernel, IKernelService } from "../types";

export class BgmService implements IKernelService {
  name = "bgm";
  isCritical = false;
  dependencies = [] as const;

  private audio: HTMLAudioElement | null = null;
  private currentUrl: string = "";
  private isMuted: boolean = false;
  private defaultVolume: number = 0.5;

  async init(kernel: IKernel, signal?: AbortSignal): Promise<void> {
    this.audio = new Audio();
    this.audio.loop = true;
    
    // 捕获加载中的网络错误，防止系统崩溃
    this.audio.addEventListener("error", (e) => {
      console.warn("[BgmService] Audio loading error:", e);
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

    if (this.currentUrl === url && !this.audio.paused) {
      this.audio.volume = this.isMuted ? 0 : volume;
      return;
    }

    this.currentUrl = url;
    this.audio.src = url;
    this.audio.volume = this.isMuted ? 0 : volume;
    
    this.audio.play().catch((err) => {
      // 捕获自动播放限制
      console.warn("[BgmService] Autoplay blocked or failed:", err.message);
    });
  }

  stop() {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
    }
    this.currentUrl = "";
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
