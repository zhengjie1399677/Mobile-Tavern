import { globalKernel } from "../kernel/Kernel";
import { TelemetryService } from "../kernel/services/TelemetryService";

let fallbackTelemetry: TelemetryService | null = null;
function getTelemetryService() {
  if (globalKernel && globalKernel.hasService("telemetry")) {
    return globalKernel.getService<any>("telemetry");
  }
  if (!fallbackTelemetry) {
    fallbackTelemetry = new TelemetryService();
  }
  return fallbackTelemetry;
}

export function generateDeviceId(): string {
  return getTelemetryService().generateDeviceId();
}

export function getDeviceId(): string {
  return getTelemetryService().getDeviceId();
}

export function getDeviceInfo() {
  return getTelemetryService().getDeviceInfo();
}

export function incrementUsageCount() {
  getTelemetryService().incrementUsageCount();
}

export function reportUsage(action: string = "app_launch", extraData: Record<string, any> = {}) {
  getTelemetryService().reportUsage(action, extraData);
}

export async function reportColdStartReady() {
  await getTelemetryService().reportColdStartReady();
}

export function reportChatLoadTime(durationMs: number) {
  getTelemetryService().reportChatLoadTime(durationMs);
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
  playerName?: string
) {
  getTelemetryService().reportLlmPerformance(
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

export function reportDbQueueTimeout(queueDelayMs: number, queueLength: number) {
  getTelemetryService().reportDbQueueTimeout(queueDelayMs, queueLength);
}

export function reportZodValidationError(errorDetail: string, path: string, inputVal: any) {
  getTelemetryService().reportZodValidationError(errorDetail, path, inputVal);
}

export async function reportImmediate(action: string, extraData: Record<string, any> = {}) {
  await getTelemetryService().reportImmediate(action, extraData);
}

(() => {
  if (typeof window !== "undefined") {
    (window as any).reportZodValidationError = reportZodValidationError;
  }
})();