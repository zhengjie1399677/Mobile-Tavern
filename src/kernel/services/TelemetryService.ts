import { ITelemetryService, IKernel } from "../types";
import { reportUsage, incrementUsageCount, reportLlmPerformance } from "../../utils/telemetry";

export class TelemetryService implements ITelemetryService {
  name = "telemetry";
  private kernel!: IKernel;

  init(kernel: IKernel): void {
    this.kernel = kernel;
  }

  reportUsage(action: string = "app_launch", extraData: Record<string, any> = {}): void {
    reportUsage(action, extraData);
  }

  incrementUsageCount(): void {
    incrementUsageCount();
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
    reportLlmPerformance(
      sessionId,
      modelName,
      ttftMs,
      totalTokens,
      durationMs,
      promptTokens,
      completionTokens
    );
  }
}
