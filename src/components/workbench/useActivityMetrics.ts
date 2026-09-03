import { useMemo } from "react";
import { useUnifiedApp } from "../../UnifiedAppContext";

export interface DayMetric {
  dateStr: string; // YYYY-MM-DD
  dayLabel: string; // "周一", "09/03" 等
  count: number;
}

export interface ActivityMetricsResult {
  dailyHeatmap: Map<string, number>;
  todayCount: number;
  todaySessionCount: number;
  last7Days: DayMetric[];
  hourlyDistribution: number[]; // 0..23
  maxDailyCount: number;
}

const formatDateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export function useActivityMetrics(): ActivityMetricsResult {
  const { sessions } = useUnifiedApp((state) => ({
    sessions: state.sessions,
  }));

  return useMemo(() => {
    const dailyHeatmap = new Map<string, number>();
    const hourlyDistribution = new Array<number>(24).fill(0);
    const today = new Date();
    const todayKey = formatDateKey(today);
    let todayCount = 0;
    const todaySessionIds = new Set<string>();

    // 扫描所有会话中的消息时间戳
    for (const session of sessions) {
      if (Array.isArray(session.messages)) {
        for (const msg of session.messages) {
          if (typeof msg.timestamp === "number" && msg.timestamp > 0) {
            const date = new Date(msg.timestamp);
            const key = formatDateKey(date);
            const current = dailyHeatmap.get(key) ?? 0;
            dailyHeatmap.set(key, current + 1);

            const hour = date.getHours();
            if (hour >= 0 && hour < 24) {
              hourlyDistribution[hour] += 1;
            }

            if (key === todayKey) {
              todayCount += 1;
              todaySessionIds.add(session.id);
            }
          }
        }
      } else if (typeof session.updatedAt === "number") {
        // 兜底：若消息未水合，使用 updatedAt
        const date = new Date(session.updatedAt);
        const key = formatDateKey(date);
        dailyHeatmap.set(key, (dailyHeatmap.get(key) ?? 0) + 1);
        if (key === todayKey) {
          todaySessionIds.add(session.id);
        }
      }
    }

    let maxDailyCount = 1;
    for (const val of dailyHeatmap.values()) {
      if (val > maxDailyCount) maxDailyCount = val;
    }

    // 近 7 天趋势数据
    const last7Days: DayMetric[] = [];
    const weekLabels = ["日", "一", "二", "三", "四", "五", "六"];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      const key = formatDateKey(d);
      last7Days.push({
        dateStr: key,
        dayLabel: weekLabels[d.getDay()],
        count: dailyHeatmap.get(key) ?? 0,
      });
    }

    return {
      dailyHeatmap,
      todayCount,
      todaySessionCount: todaySessionIds.size,
      last7Days,
      hourlyDistribution,
      maxDailyCount,
    };
  }, [sessions]);
}
