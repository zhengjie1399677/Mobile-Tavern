import { useMemo } from "react";
import type { ActivityDayMetric, ActivityGenerationStats } from "../../domain/analytics/activityAggregation";
import {
  useWorkbenchActivity,
  type MoodPoint,
} from "./WorkbenchActivityProvider";

/** 近 7 天趋势数据点（保留旧导出名，卡片沿用同一类型）。 */
export type DayMetric = ActivityDayMetric;

export type { MoodPoint };

export interface ActivityMetricsResult {
  /** 本地日 → 消息数（近窗口全量历史，不依赖界面已水合的消息窗口）。 */
  dailyHeatmap: Map<string, number>;
  /** 本地日 → 心相定锚记录。 */
  dailyMoods: Map<string, MoodPoint>;
  todayCount: number;
  todaySessionCount: number;
  todayMood: MoodPoint | null;
  last7Days: DayMetric[];
  /** 今日各本地小时 → 消息数，长度 24。 */
  hourlyDistribution: number[];
  maxDailyCount: number;
  /** 当前本地日键：跨午夜由统一时间基准自动翻转。 */
  todayKey: string;
  /** 会话目录里的总会话数（不是「已加载页」条数）。 */
  totalSessionCount: number;
  /** 助手回复的用量与生成耗时汇总。 */
  generation: ActivityGenerationStats;
  saveMood: (point: { x: number; y: number }, dateKey?: string) => void;
}

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

/**
 * 工作台活动指标的只读视图。
 *
 * 数据来自 `WorkbenchActivityProvider` 里的唯一聚合快照：4 张活跃类卡片共享同一份结果，
 * 不再各自扫描 `sessions[].messages`（目录会话的消息恒为空，只会得到全 0）。
 */
export function useActivityMetrics(): ActivityMetricsResult {
  const { activity, todayKey, dailyMoods, saveMood } = useWorkbenchActivity();

  return useMemo<ActivityMetricsResult>(() => ({
    dailyHeatmap: activity.dailyHeatmap,
    dailyMoods,
    todayCount: activity.todayCount,
    todaySessionCount: activity.todaySessionCount,
    todayMood: dailyMoods.get(todayKey) ?? null,
    last7Days: activity.last7Days,
    hourlyDistribution: activity.hourlyDistribution,
    maxDailyCount: activity.maxDailyCount,
    todayKey,
    totalSessionCount: activity.totalSessionCount,
    generation: activity.generation,
    saveMood,
  }), [activity, dailyMoods, todayKey, saveMood]);
}
