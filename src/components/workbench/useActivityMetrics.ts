import { useMemo, useState, useCallback, useEffect } from "react";
import { useUnifiedApp } from "../../UnifiedAppContext";
import {
  readWorkbenchMoodRecords,
  saveWorkbenchMoodRecord,
  type WorkbenchMoodPoint,
} from "../../application/useCases/workbenchMoodRecords";

export interface DayMetric {
  dateStr: string; // YYYY-MM-DD
  dayLabel: string; // "周一", "09/03" 等
  count: number;
}

export type MoodPoint = WorkbenchMoodPoint;

export interface ActivityMetricsResult {
  dailyHeatmap: Map<string, number>;
  dailyMoods: Map<string, MoodPoint>;
  todayCount: number;
  todaySessionCount: number;
  todayMood: MoodPoint | null;
  last7Days: DayMetric[];
  hourlyDistribution: number[]; // 0..23
  maxDailyCount: number;
  saveMood: (point: { x: number; y: number }, dateKey?: string) => void;
}

const MOOD_CHANGED_EVENT = "mobileTavernWorkbenchMoodChanged";

const formatDateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export function getMoodColor(x: number, y: number): {
  primary: string;
  glow: string;
  label: string;
} {
  if (x >= 0 && y >= 0) {
    // 象限 1：高能 + 愉悦 (充沛 / 灵感)
    return {
      primary: "#f59e0b",
      glow: "rgba(245, 158, 11, 0.6)",
      label: "充沛 · 灵感",
    };
  }
  if (x >= 0 && y < 0) {
    // 象限 2：低能 + 愉悦 (宁静 / 自洽)
    return {
      primary: "#10b981",
      glow: "rgba(16, 185, 129, 0.6)",
      label: "宁静 · 自洽",
    };
  }
  if (x < 0 && y >= 0) {
    // 象限 3：高能 + 负向 (紧绷 / 焦灼)
    return {
      primary: "#a855f7",
      glow: "rgba(168, 85, 247, 0.6)",
      label: "紧绷 · 焦灼",
    };
  }
  // 象限 4：低能 + 负向 (疲惫 / 虚耗)
  return {
    primary: "#6366f1",
    glow: "rgba(99, 102, 241, 0.6)",
    label: "疲惫 · 虚耗",
  };
}

export function useActivityMetrics(): ActivityMetricsResult {
  const { sessions } = useUnifiedApp((state) => ({
    sessions: state.sessions,
  }));

  // 本地持久化心相记录
  const [moodRecords, setMoodRecords] = useState<Record<string, MoodPoint>>(readWorkbenchMoodRecords);

  useEffect(() => {
    const sync = () => setMoodRecords(readWorkbenchMoodRecords());
    window.addEventListener(MOOD_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(MOOD_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const dailyMoods = useMemo(() => {
    return new Map<string, MoodPoint>(Object.entries(moodRecords));
  }, [moodRecords]);

  const [todayKey, setTodayKey] = useState(() => formatDateKey(new Date()));
  useEffect(() => {
    const refreshDate = () => setTodayKey(formatDateKey(new Date()));
    const timer = window.setInterval(refreshDate, 60_000);
    window.addEventListener("mobileTavernNativeResume", refreshDate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("mobileTavernNativeResume", refreshDate);
    };
  }, []);
  const todayMood = dailyMoods.get(todayKey) ?? null;

  const saveMood = useCallback(
    (point: { x: number; y: number }, targetDateKey = todayKey) => {
      const next = saveWorkbenchMoodRecord(targetDateKey, point);
      setMoodRecords(next);
      window.dispatchEvent(new Event(MOOD_CHANGED_EVENT));
    },
    [todayKey]
  );

  return useMemo(() => {
    const dailyHeatmap = new Map<string, number>();
    const hourlyDistribution = new Array<number>(24).fill(0);
    const today = new Date();
    let todayCount = 0;
    const todaySessionIds = new Set<string>();

    for (const session of sessions) {
      if (Array.isArray(session.messages)) {
        for (const msg of session.messages) {
          if (typeof msg.timestamp === "number" && msg.timestamp > 0) {
            const date = new Date(msg.timestamp);
            const key = formatDateKey(date);
            dailyHeatmap.set(key, (dailyHeatmap.get(key) ?? 0) + 1);

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
      dailyMoods,
      todayCount,
      todaySessionCount: todaySessionIds.size,
      todayMood,
      last7Days,
      hourlyDistribution,
      maxDailyCount,
      saveMood,
    };
  }, [sessions, dailyMoods, todayKey, todayMood, saveMood]);
}
