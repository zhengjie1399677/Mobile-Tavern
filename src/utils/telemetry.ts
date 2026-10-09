import type { IKernel } from "@/src/application/serviceContracts";
import { getRuntimeKernel } from "../kernel/runtimeKernel";
import { TelemetryService } from "../application/services/TelemetryService";
import { getErrorMessage, getErrorDetail } from "./errorUtils";
import { recordRuntimeError } from "./runtimeErrorLog";

let fallbackTelemetry: TelemetryService | null = null;
function getTelemetryService(kernel?: IKernel) {
  const k = kernel ?? getRuntimeKernel();
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
      const msg = event.message || (event.error ? getErrorMessage(event.error) : "unknown error");
      const file = (event.filename ?? "").slice(0, 500);
      const line = event.lineno ?? 0;
      const col = event.colno ?? 0;
      const stack = (event.error?.stack ?? "").slice(0, 4000);
      const loc = file ? ` (${file}:${line}:${col})` : "";
      const detail = `${msg}${loc}${stack ? `\nStack: ${stack}` : ""}`;

      // 同一捕获点同时喂给现场黑匣子：遥测关闭或不可达时，系统报告仍能看到最近错误。
      recordRuntimeError({
        kind: "error",
        message: msg,
        ...(file ? { source: `${file}:${line}` } : {}),
        at: Date.now(),
      });

      reportImmediate("window_uncaught_error", {
        detail,
        message: msg,
        filename: file,
        lineno: line,
        colno: col,
        stack,
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
      const detail = getErrorDetail(reason).slice(0, 4000);
      const msg = getErrorMessage(reason);
      const stack = (reason instanceof Error ? reason.stack : (reason && typeof reason === "object" && "stack" in reason ? String((reason as Record<string, unknown>).stack) : ""))?.slice(0, 4000) || "";

      recordRuntimeError({ kind: "unhandledrejection", message: msg, at: Date.now() });

      reportImmediate("window_unhandled_rejection", {
        detail,
        reason: msg,
        stack,
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
