import { useEffect, useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "../../components/ui/card";
import { Activity } from "lucide-react";

const STORAGE_KEY = "aita_usage_metrics";

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
      return JSON.parse(data);
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

export function useUsageTracking() {
  useEffect(() => {
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(metrics));

    let sessionSeconds = 0;

    // Setup interval to increment usage time every 10 seconds (saving I/O)
    const interval = setInterval(() => {
      sessionSeconds += 10;
      const currentMetrics = getUsageTracker();
      currentMetrics.totalUsageSeconds += 10;

      const currentTodayStr = new Date().toISOString().split("T")[0];
      let currentTodayRecord = currentMetrics.history.find(
        (h) => h.date === currentTodayStr,
      );
      if (!currentTodayRecord) {
        currentTodayRecord = { date: currentTodayStr, seconds: 0 };
        currentMetrics.history.push(currentTodayRecord);
      }
      currentTodayRecord.seconds += 10;

      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentMetrics));
    }, 10000);

    return () => clearInterval(interval);
  }, []);
}

export function UsageDisplay() {
  const [metrics, setMetrics] = useState<UsageMetrics | null>(null);

  useEffect(() => {
    setMetrics(getUsageTracker());
    const i = setInterval(() => setMetrics(getUsageTracker()), 10000);
    return () => clearInterval(i);
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
