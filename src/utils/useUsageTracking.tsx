import { useEffect, useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "../../components/ui/card";
import { Activity } from "lucide-react";
import { reportColdStartReady } from "./telemetry";

const STORAGE_KEY = "aita_usage_metrics";
const MAX_HISTORY_DAYS = 90;
const WRITE_INTERVAL_MS = 30000;

export interface UsageMetrics {
  totalOpens: number;
  totalUsageSeconds: number;
  lastOpenedAt: number | null;
  history: { date: string; seconds: number }[];
}

export function getUsageTracker(): UsageMetrics {
  const data = localStorage.getItem(STORAGE_KEY);
  if (data) {
    try {
      const parsed = JSON.parse(data);
      if (parsed && Array.isArray(parsed.history)) {
        trimHistory(parsed);
      }
      return parsed;
    } catch (e) {
      console.error("Failed to parse usage metrics", e);
    }
  }
  return {
    totalOpens: 0,
    totalUsageSeconds: 0,
    lastOpenedAt: null,
    history: [],
  };
}

/** 裁剪 history 数组，仅保留最近 MAX_HISTORY_DAYS 天的数据，防止无限增长 */
function trimHistory(metrics: UsageMetrics): void {
  if (!metrics.history || metrics.history.length <= MAX_HISTORY_DAYS) return;
  metrics.history = metrics.history
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_HISTORY_DAYS);
}

export function useUsageTracking() {
  useEffect(() => {
    // Report app ready telemetry
    try {
      reportColdStartReady();
    } catch (e) {
      console.warn("Failed to report cold start telemetry:", e);
    }

    // Component mounted (App opened)
    const metrics = getUsageTracker();
    metrics.totalOpens += 1;
    metrics.lastOpenedAt = Date.now();

    const todayStr = new Date().toISOString().split("T")[0];
    let todayRecord = metrics.history.find((h) => h.date === todayStr);
    if (!todayRecord) {
      todayRecord = { date: todayStr, seconds: 0 };
      metrics.history.push(todayRecord);
    }

    // Save open stats immediately
    trimHistory(metrics);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(metrics));

    let sessionSeconds = 0;

    // 降低写入频率至 30 秒，减少同步 I/O 对主线程的影响
    const interval = setInterval(() => {
      sessionSeconds += WRITE_INTERVAL_MS / 1000;
      const currentMetrics = getUsageTracker();
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentMetrics));
    }, WRITE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);
}

export function UsageDisplay() {
  const [metrics, setMetrics] = useState<UsageMetrics | null>(null);

  useEffect(() => {
    setMetrics(getUsageTracker());
    const i = setInterval(() => setMetrics(getUsageTracker()), WRITE_INTERVAL_MS);

    // 页面不可见时暂停轮询，恢复时立即刷新并重启定时器
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setMetrics(getUsageTracker());
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(i);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  if (!metrics) return null;

  return (
    <Card className="bg-card border-border shadow-sm mt-4">
      <CardHeader className="pb-3 border-b border-border/50">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-500" /> 使用统计
          (Telemetrics)
        </CardTitle>
        <CardDescription className="text-[11px]">
          基础运行信息（便于后续数据追踪打包需求）
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4 flex flex-col gap-3">
        <div className="flex items-center justify-between bg-muted/30 p-2 rounded border border-border">
          <span className="text-xs font-semibold text-foreground">
            累计打开次数
          </span>
          <span className="text-xs text-muted-foreground font-mono">
            {metrics.totalOpens} 次
          </span>
        </div>
        <div className="flex items-center justify-between bg-muted/30 p-2 rounded border border-border">
          <span className="text-xs font-semibold text-foreground">
            累计运行时间
          </span>
          <span className="text-xs text-muted-foreground font-mono">
            {Math.floor(metrics.totalUsageSeconds / 60)} 分钟
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
