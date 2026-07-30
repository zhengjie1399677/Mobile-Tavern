export interface UsageMetrics {
  totalOpens: number;
  totalUsageSeconds: number;
  firstOpenedAt: number | null;
  lastOpenedAt: number | null;
  history: Array<{ date: string; seconds: number }>;
}

export interface UsageMetricsPort {
  getUsageMetrics(): Promise<UsageMetrics | null>;
  saveUsageMetrics(metrics: UsageMetrics): Promise<void>;
}
