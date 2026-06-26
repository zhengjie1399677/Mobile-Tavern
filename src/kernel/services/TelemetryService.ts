import { ITelemetryService, IKernel } from "../types";
import { invoke } from '@tauri-apps/api/core';

let sessionStartTime = Date.now();

export class TelemetryService implements ITelemetryService {
  name = "telemetry";
  private kernel!: IKernel;
  // P1-1/P1-2: 服务级 AbortController
  private abortController: AbortController | null = null;

  init(kernel: IKernel, signal?: AbortSignal): void {
    this.kernel = kernel;
    // P1-2 (D-1): 重置 sessionStartTime，确保 HMR 后统计正确
    sessionStartTime = Date.now();
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener("abort", () => this.abortController?.abort());
    }
  }

  // P1-2: 销毁时清理 abort 控制器
  destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  generateDeviceId(): string {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return (
      "dev_" +
      Math.random().toString(36).substring(2) +
      Date.now().toString(36)
    );
  }

  getDeviceId(): string {
    const DEVICE_ID_KEY = "anon_device_id";
    if (typeof localStorage === "undefined") return "Unknown";
    let deviceId = localStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = this.generateDeviceId();
      try {
        localStorage.setItem(DEVICE_ID_KEY, deviceId);
      } catch (e) {
        console.warn("localStorage write failed:", e);
      }
    }
    return deviceId;
  }

  getDeviceInfo() {
    return {
      deviceId: this.getDeviceId(),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "Unknown",
      language: typeof navigator !== "undefined" ? navigator.language : "zh-CN",
      platform: typeof navigator !== "undefined" ? navigator.platform : "Unknown",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  private buildLog(action: string, extraData: Record<string, any> = {}) {
    const deviceInfo = this.getDeviceInfo();
    const eventDurMs = Math.max(0, Date.now() - sessionStartTime);
    
    return {
      action: action,
      device_id: deviceInfo.deviceId,
      player_name: String(extraData.playerName || "未知"),
      character_name: String(extraData.characterName || "未知"),
      model: String(extraData.modelName || extraData.model || ""),
      tokens_used: String(extraData.totalTokens || extraData.tokens_used || "0"),
      generation_time_ms: String(Math.round(extraData.generationTime || extraData.generation_time_ms || 0)),
      detail: String(extraData.detail || ""),
      session_id: String(extraData.sessionId || "无"),
      session_start_time: new Date(sessionStartTime).toLocaleString(),
      session_duration_sec: String(Math.round(eventDurMs / 1000)),
      platform: "Tauri",
      user_agent: deviceInfo.userAgent,
      language: deviceInfo.language,
      timezone: deviceInfo.timeZone
    };
  }

  private async sendTelemetryToRust(log: any) {
    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
    if (isTauri) {
      try {
        await invoke('report_telemetry', { log });
      } catch (err) {
        console.warn("[TelemetryService] Failed to invoke report_telemetry command:", err);
      }
    } else {
      console.log("[TelemetryService] [Mock Dev Send]:", log);
    }
  }

  incrementUsageCount(): void {
    // usage count dummy
  }

  reportUsage(action: string = "app_launch", extraData: Record<string, any> = {}): void {
    const log = this.buildLog(action, extraData);
    this.sendTelemetryToRust(log);
  }

  async reportColdStartReady(): Promise<void> {
    const duration = Date.now() - sessionStartTime;
    try {
      await this.reportImmediate("app_instant_launch", { detail: "应用启动，立刻上报瞬时遥测，绕过离线缓存" });
    } catch (e) {
      console.warn("Failed to send app_instant_launch telemetry:", e);
    }
    this.reportUsage("performance_cold_start", {
      detail: "App cold start ready",
      generationTime: duration,
    });
  }

  reportChatLoadTime(durationMs: number): void {
    this.reportUsage("performance_chat_load", {
      detail: "Chat session load completed",
      generationTime: durationMs,
    });
  }

  reportLlmPerformance(
    sessionId: string,
    modelName: string,
    ttftMs: number,
    totalTokens: number,
    durationMs: number,
    promptTokens: number,
    completionTokens: number
  ): void {
    this.reportUsage("llm_performance", {
      sessionId,
      modelName,
      totalTokens,
      generationTime: durationMs,
      detail: `TTFT: ${ttftMs}ms, Duration: ${durationMs}ms, PromptTokens: ${promptTokens}, CompletionTokens: ${completionTokens}`
    });
  }

  reportDbQueueTimeout(queueDelayMs: number, queueLength: number): void {
    this.reportUsage("db_queue_timeout", {
      detail: `DB WriteQueue delayed. Delay: ${queueDelayMs}ms, Queue Length: ${queueLength}`,
      generationTime: queueDelayMs,
    });
  }

  reportZodValidationError(errorDetail: string, path: string, inputVal: any): void {
    this.reportUsage("mvu_zod_validation_error", {
      detail: `Zod Error: ${errorDetail} at path: ${path}, input: ${JSON.stringify(inputVal)}`
    });
  }

  async reportImmediate(action: string, extraData: Record<string, any> = {}): Promise<void> {
    const log = this.buildLog(action, extraData);
    await this.sendTelemetryToRust(log);
  }
}
