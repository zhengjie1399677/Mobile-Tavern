import { ITelemetryService, IKernel } from "../types";
import { invoke } from '@tauri-apps/api/core';

let sessionStartTime = Date.now();

/**
 * 遥测与数据统计上报服务
 * 负责收集应用生命周期事件、接口响应性能、异常校验日志，并通过 Tauri IPC 桥接上报至 Rust 后端
 */
export class TelemetryService implements ITelemetryService {
  name = "telemetry";
  private kernel!: IKernel;
  // P1-1/P1-2: 服务级 AbortController
  private abortController: AbortController | null = null;

  /**
   * 初始化遥测服务
   */
  init(kernel: IKernel, signal?: AbortSignal): void {
    this.kernel = kernel;
    // P1-2 (D-1): 重置 sessionStartTime，确保 HMR（热更新）后统计时间正确
    sessionStartTime = Date.now();
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener("abort", () => this.abortController?.abort());
    }
  }

  /**
   * 销毁遥测服务，清理 abort 控制器
   */
  destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * 生成随机且唯一的匿名设备 ID
   */
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

  /**
   * 获取匿名设备 ID（从本地 LocalStorage 持久化获取，不存在则新建）
   */
  getDeviceId(): string {
    const DEVICE_ID_KEY = "anon_device_id";
    if (typeof localStorage === "undefined") return "Unknown";
    let deviceId = localStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = this.generateDeviceId();
      try {
        localStorage.setItem(DEVICE_ID_KEY, deviceId);
      } catch (e) {
        console.warn("[TelemetryService] LocalStorage 写入设备 ID 失败:", e);
      }
    }
    return deviceId;
  }

  /**
   * 收集当前客户端的设备环境信息
   */
  getDeviceInfo() {
    return {
      deviceId: this.getDeviceId(),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "Unknown",
      language: typeof navigator !== "undefined" ? navigator.language : "zh-CN",
      platform: typeof navigator !== "undefined" ? navigator.platform : "Unknown",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  /**
   * 构建标准的结构化遥测日志体
   */
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

  /**
   * 向 Rust 后端传输遥测日志，由后端异步上传 SLS 遥测集群
   */
  private async sendTelemetryToRust(log: any) {
    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
    if (isTauri) {
      try {
        await invoke('report_telemetry', { log });
      } catch (err) {
        console.warn("[TelemetryService] 桥接 Rust report_telemetry 命令调用失败:", err);
      }
    } else {
      console.log("[TelemetryService] [本地模拟开发发送日志]:", log);
    }
  }

  /**
   * 累加使用次数（占位逻辑）
   */
  incrementUsageCount(): void {
    // 占位计数逻辑
  }

  /**
   * 上报应用行为使用情况（进入队列缓存）
   */
  reportUsage(action: string = "app_launch", extraData: Record<string, any> = {}): void {
    const log = this.buildLog(action, extraData);
    this.sendTelemetryToRust(log);
  }

  /**
   * 上报冷启动性能就绪指标（绕过队列立刻直连上报）
   */
  async reportColdStartReady(): Promise<void> {
    const duration = Date.now() - sessionStartTime;
    try {
      await this.reportImmediate("app_instant_launch", { detail: "应用启动，立刻上报瞬时遥测，绕过离线缓存" });
    } catch (e) {
      console.warn("[TelemetryService] 发送 app_instant_launch 瞬时遥测失败:", e);
    }
    this.reportUsage("performance_cold_start", {
      detail: "应用冷启动完成就绪",
      generationTime: duration,
    });
  }

  /**
   * 上报会话聊天记录的加载耗时
   */
  reportChatLoadTime(durationMs: number): void {
    this.reportUsage("performance_chat_load", {
      detail: "聊天会话数据加载完成",
      generationTime: durationMs,
    });
  }

  /**
   * 上报 LLM 生成大模型接口性能指标
   */
  reportLlmPerformance(
    sessionId: string,
    modelName: string,
    ttftMs: number,
    totalTokens: number,
    durationMs: number,
    promptTokens: number,
    completionTokens: number,
    characterName?: string,
    playerName?: string
  ): void {
    this.reportUsage("llm_performance", {
      sessionId,
      modelName,
      totalTokens,
      generationTime: durationMs,
      characterName,
      playerName,
      detail: `首字延迟 TTFT: ${ttftMs}ms, 生成耗时 Duration: ${durationMs}ms, 输入 Token 数量 PromptTokens: ${promptTokens}, 输出 Token 数量 CompletionTokens: ${completionTokens}`
    });
  }

  /**
   * 上报 IndexedDB 写入队列超时延迟（用于检测数据库阻塞）
   */
  reportDbQueueTimeout(queueDelayMs: number, queueLength: number): void {
    this.reportUsage("db_queue_timeout", {
      detail: `数据库写入队列延迟. 耗时: ${queueDelayMs}ms, 队列当前深度: ${queueLength}`,
      generationTime: queueDelayMs,
    });
  }

  /**
   * 上报脚本运行时 Zod 数据校验失败异常
   */
  reportZodValidationError(errorDetail: string, path: string, inputVal: any): void {
    this.reportUsage("mvu_zod_validation_error", {
      detail: `Zod 校验报错: ${errorDetail} 字段路径: ${path}, 传入输入值: ${JSON.stringify(inputVal)}`
    });
  }

  /**
   * 绕过本地离线缓存文件落盘，立刻直接向 Rust 后端传输遥测日志
   */
  async reportImmediate(action: string, extraData: Record<string, any> = {}): Promise<void> {
    const log = this.buildLog(action, extraData);
    await this.sendTelemetryToRust(log);
  }
}
