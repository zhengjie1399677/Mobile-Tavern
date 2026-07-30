import { useEffect, useState } from "react";
import { useTranslation } from "../contexts/LanguageContext";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "../../components/ui/card";
import { Activity } from "lucide-react";
import { reportColdStartReady } from "./telemetry";
import { useKernel } from "../contexts/KernelContext";
import {
  KernelServices,
  type ISettingsService,
} from "../application/serviceContracts";
import type { UserSettings } from "../types";
import type { UsageMetrics } from "../domain/usage/metrics";

const MAX_HISTORY_DAYS = 90;
const WRITE_INTERVAL_MS = 30000;

const DEFAULT_METRICS: UsageMetrics = {
  totalOpens: 0,
  totalUsageSeconds: 0,
  firstOpenedAt: null,
  lastOpenedAt: null,
  history: [],
};

/** 裁剪 history 数组，仅保留最近 MAX_HISTORY_DAYS 天的数据，防止无限增长 */
function trimHistory(metrics: UsageMetrics): void {
  if (!metrics.history || metrics.history.length <= MAX_HISTORY_DAYS) return;
  metrics.history = metrics.history
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_HISTORY_DAYS);
}

export function useUsageTracking() {
  const kernel = useKernel();
  const usageMetricsService = kernel.getService<ISettingsService<UserSettings, UsageMetrics>>(
    KernelServices.Settings,
  );

  useEffect(() => {
    // 上报应用就绪遥测
    try {
      reportColdStartReady();
    } catch (e) {
      console.warn("Failed to report cold start telemetry:", e);
    }

    let active = true;
    let interval: ReturnType<typeof setInterval> | null = null;

    const initAndTrack = async () => {
      try {
        const stored = await usageMetricsService.getUsageMetrics();
        if (!active) return;

        const metrics: UsageMetrics = stored
          ? { ...DEFAULT_METRICS, ...stored }
          : { ...DEFAULT_METRICS };

        if (metrics.firstOpenedAt === null) {
          const earliestHistoryTime = metrics.history
            .map((entry) => Date.parse(`${entry.date}T00:00:00`))
            .filter(Number.isFinite)
            .sort((left, right) => left - right)[0];
          metrics.firstOpenedAt =
            earliestHistoryTime ?? metrics.lastOpenedAt ?? Date.now();
        }
        metrics.totalOpens += 1;
        metrics.lastOpenedAt = Date.now();

        const todayStr = new Date().toISOString().split("T")[0];
        let todayRecord = metrics.history.find((h) => h.date === todayStr);
        if (!todayRecord) {
          todayRecord = { date: todayStr, seconds: 0 };
          metrics.history.push(todayRecord);
        }

        trimHistory(metrics);
        await usageMetricsService.saveUsageMetrics(metrics);

        // 每 30 秒异步写入一次
        interval = setInterval(async () => {
          try {
            const current = await usageMetricsService.getUsageMetrics();
            if (!active) return;

            const currentMetrics: UsageMetrics = current
              ? { ...DEFAULT_METRICS, ...current }
              : { ...DEFAULT_METRICS };

            currentMetrics.totalUsageSeconds += WRITE_INTERVAL_MS / 1000;

            const currentTodayStr = new Date().toISOString().split("T")[0];
            let currentTodayRecord = currentMetrics.history.find(
              (h) => h.date === currentTodayStr,
            );
            if (!currentTodayRecord) {
              currentTodayRecord = { date: currentTodayStr, seconds: 0 };
              currentMetrics.history.push(currentTodayRecord);
            }
            currentTodayRecord.seconds += WRITE_INTERVAL_MS / 1000;

            trimHistory(currentMetrics);
            await usageMetricsService.saveUsageMetrics(currentMetrics);
          } catch (err) {
            console.error("Failed to update usage metrics inside interval", err);
          }
        }, WRITE_INTERVAL_MS);

      } catch (err) {
        console.error("Failed to initialize usage tracking", err);
      }
    };

    initAndTrack();

    return () => {
      active = false;
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [usageMetricsService]);
}

export function UsageDisplay() {
  const { t } = useTranslation();
  const kernel = useKernel();
  const usageMetricsService = kernel.getService<ISettingsService<UserSettings, UsageMetrics>>(
    KernelServices.Settings,
  );
  const [metrics, setMetrics] = useState<UsageMetrics | null>(null);

  useEffect(() => {
    let active = true;

    const loadMetrics = async () => {
      try {
        const data = await usageMetricsService.getUsageMetrics();
        if (!active) return;
        setMetrics((data as UsageMetrics | null) || DEFAULT_METRICS);
      } catch (err) {
        console.error("Failed to load metrics in UsageDisplay", err);
      }
    };

    loadMetrics();

    const i = setInterval(loadMetrics, WRITE_INTERVAL_MS);

    // 页面不可见时暂停轮询，恢复时立即刷新并重启定时器
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadMetrics();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      active = false;
      clearInterval(i);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [usageMetricsService]);

  if (!metrics) return null;

  return (
    <Card className="bg-card border-border shadow-sm mt-4">
      <CardHeader className="pb-3 border-b border-border/50">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-500" /> {t("telemetrics.title")}
        </CardTitle>
        <CardDescription className="text-[11px]">
          {t("telemetrics.subtitle")}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4 flex flex-col gap-3">
        <div className="flex items-center justify-between bg-muted/30 p-2 rounded border border-border">
          <span className="text-xs font-semibold text-foreground">
            {t("telemetrics.total_opens")}
          </span>
          <span className="text-xs text-muted-foreground font-mono">
            {t("telemetrics.times", { count: String(metrics.totalOpens) })}
          </span>
        </div>
        <div className="flex items-center justify-between bg-muted/30 p-2 rounded border border-border">
          <span className="text-xs font-semibold text-foreground">
            {t("telemetrics.total_runtime")}
          </span>
          <span className="text-xs text-muted-foreground font-mono">
            {t("telemetrics.minutes", { count: String(Math.floor(metrics.totalUsageSeconds / 60)) })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
