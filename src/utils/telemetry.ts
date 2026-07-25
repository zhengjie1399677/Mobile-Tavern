import { globalKernel } from "../kernel/Kernel";
import type { IKernel } from "../kernel/types";
import { TelemetryService } from "../kernel/services/TelemetryService";

let fallbackTelemetry: TelemetryService | null = null;
// TODO-2: 接收可选 kernel 参数，默认回退 globalKernel 单例。
// 如此测试环境可传入隔离的 Mock 实例，实现物理隔离测试。
function getTelemetryService(kernel?: IKernel) {
  const k = kernel || globalKernel;
  if (k && k.hasService("telemetry")) {
    return k.getService<any>("telemetry");
  }
  if (!fallbackTelemetry) {
    fallbackTelemetry = new TelemetryService();
  }
  return fallbackTelemetry;
}

export function generateDeviceId(kernel?: IKernel): string {
  return getTelemetryService(kernel).generateDeviceId();
}

export function getDeviceId(kernel?: IKernel): string {
  return getTelemetryService(kernel).getDeviceId();
}

export function getDeviceInfo(kernel?: IKernel) {
  return getTelemetryService(kernel).getDeviceInfo();
}

export function incrementUsageCount(kernel?: IKernel) {
  getTelemetryService(kernel).incrementUsageCount();
}

export function reportUsage(action: string = "app_launch", extraData: Record<string, any> = {}, kernel?: IKernel) {
  getTelemetryService(kernel).reportUsage(action, extraData);
}

export async function reportColdStartReady(kernel?: IKernel) {
  await getTelemetryService(kernel).reportColdStartReady();
}

export function reportChatLoadTime(durationMs: number, kernel?: IKernel) {
  getTelemetryService(kernel).reportChatLoadTime(durationMs);
}

export function reportLlmPerformance(
  sessionId: string,
  modelName: string,
  ttftMs: number,
  totalTokens: number,
  durationMs: number,
  promptTokens: number,
  completionTokens: number,
  characterName?: string,
  playerName?: string,
  kernel?: IKernel,
  traceId?: string
) {
  getTelemetryService(kernel).reportLlmPerformance(
    sessionId,
    modelName,
    ttftMs,
    totalTokens,
    durationMs,
    promptTokens,
    completionTokens,
    characterName,
    playerName,
    traceId
  );
}

export function reportDbQueueTimeout(queueDelayMs: number, queueLength: number, kernel?: IKernel) {
  getTelemetryService(kernel).reportDbQueueTimeout(queueDelayMs, queueLength);
}

export function reportZodValidationError(errorDetail: string, path: string, inputVal: any, kernel?: IKernel) {
  getTelemetryService(kernel).reportZodValidationError(errorDetail, path, inputVal);
}

export async function reportImmediate(action: string, extraData: Record<string, any> = {}, kernel?: IKernel) {
  await getTelemetryService(kernel).reportImmediate(action, extraData);
}

/**
 * 安装主应用级全局错误兜底：捕获 window.onerror 与 unhandledrejection，
 * 上报遥测后再次抛出/打印以保留浏览器默认诊断行为。
 *
 * 此前仅在 MVU iframe 沙盒内有 window.onerror（见 scriptIframe.ts），
 * 主应用层的未捕获同步异常与 Promise rejection 长期是可观测性盲区。
 *
 * 幂等：重复调用不会叠加监听器。
 * 失败兜底：遥测管道异常不得阻塞默认错误传播。
 */
let globalErrorHandlersInstalled = false;
export function installGlobalErrorHandlers(): void {
  if (globalErrorHandlersInstalled || typeof window === "undefined") return;
  globalErrorHandlersInstalled = true;

  window.addEventListener("error", (event) => {
    try {
      reportImmediate("window_uncaught_error", {
        message: event.message ?? "unknown",
        filename: (event.filename ?? "").slice(0, 500),
        lineno: event.lineno ?? 0,
        colno: event.colno ?? 0,
        stack: (event.error?.stack ?? "").slice(0, 4000),
      }).catch(() => {
        // 静默：遥测不可用时不影响默认错误处理
      });
    } catch {
      // 同步异常兜底
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    try {
      const reason = event.reason;
      reportImmediate("window_unhandled_rejection", {
        reason: reason instanceof Error ? reason.message : String(reason ?? "unknown"),
        stack: reason instanceof Error ? (reason.stack ?? "").slice(0, 4000) : "",
      }).catch(() => {
        // 静默
      });
    } catch {
      // 同步异常兜底
    }
  });
}

/** 暴露到 window 供 iframe 沙盒内 zod 校验失败上报的回调类型收口。 */
interface WindowWithTelemetryCallback extends Window {
  reportZodValidationError?: typeof reportZodValidationError;
}

(() => {
  if (typeof window !== "undefined") {
    (window as WindowWithTelemetryCallback).reportZodValidationError = reportZodValidationError;
  }
})();
