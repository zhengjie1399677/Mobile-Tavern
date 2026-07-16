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
  kernel?: IKernel
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
    playerName
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

(() => {
  if (typeof window !== "undefined") {
    (window as any).reportZodValidationError = reportZodValidationError;
  }
})();
