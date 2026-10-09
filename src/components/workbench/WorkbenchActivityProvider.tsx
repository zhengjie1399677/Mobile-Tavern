import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useUnifiedApp } from "../../UnifiedAppContext";
import {
  createEmptyWorkbenchActivitySnapshot,
  loadWorkbenchActivitySnapshot,
  type WorkbenchActivitySnapshot,
} from "../../application/useCases/workbenchActivityUseCases";
import { useLocalDayClock } from "../../hooks/useLocalDayClock";
import { Logger } from "../../utils/logger";

const logger = Logger.create("WorkbenchActivityProvider");

/** 心相记录沿用旧键：升级不得丢失用户已定锚的历史。 */
const MOOD_STORAGE_KEY = "mobile_tavern_workbench_moods_v1";
/** 会话状态变化（流式渲染期间每 ~60ms 一次）合并到一次刷新，避免每拍重算全量图表。 */
const ACTIVITY_REFRESH_DEBOUNCE_MS = 600;
/** 心相落盘防抖：拖动期间只更新内存状态，停止拖动后才做一次 localStorage 写入。 */
const MOOD_PERSIST_DEBOUNCE_MS = 500;

export interface MoodPoint {
  /** -1（负向）.. 1（正向） */
  x: number;
  /** -1（低能）.. 1（高能） */
  y: number;
  updatedAt: number;
}

export interface WorkbenchActivityContextValue {
  activity: WorkbenchActivitySnapshot;
  /** 当前本地日键：日历高亮与心相写回日期的唯一来源。 */
  todayKey: string;
  dailyMoods: Map<string, MoodPoint>;
  saveMood: (point: { x: number; y: number }, dateKey?: string) => void;
}

function readStoredMoods(): Record<string, MoodPoint> {
  try {
    const raw = localStorage.getItem(MOOD_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, MoodPoint>) : {};
  } catch {
    return {};
  }
}

function persistMoods(records: Record<string, MoodPoint>): void {
  try {
    localStorage.setItem(MOOD_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // localStorage 不可用（隐私模式/配额）时静默降级：心相记录只是界面偏好。
  }
}

const WorkbenchActivityContext = createContext<WorkbenchActivityContextValue | null>(null);

/** 无 Provider（组件被单独渲染）时的降级值：只渲染空图表，不发起任何 IO。 */
const FALLBACK_CONTEXT: WorkbenchActivityContextValue = (() => {
  const activity = createEmptyWorkbenchActivitySnapshot(Date.now());
  return {
    activity,
    todayKey: activity.dayKey,
    dailyMoods: new Map<string, MoodPoint>(),
    saveMood: () => undefined,
  };
})();

export const WorkbenchActivityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { sessions, totalSessionCount, activeTab } = useUnifiedApp((state) => ({
    sessions: state.sessions,
    totalSessionCount: state.totalSessionCount,
    activeTab: state.activeTab,
  }));
  const { dayKey, touch } = useLocalDayClock();

  const [activity, setActivity] = useState<WorkbenchActivitySnapshot>(() =>
    createEmptyWorkbenchActivitySnapshot(Date.now()),
  );
  const [moodRecords, setMoodRecords] = useState<Record<string, MoodPoint>>(readStoredMoods);

  const activityRef = useRef(activity);
  const moodRecordsRef = useRef(moodRecords);
  const isMountedRef = useRef(true);
  /** 串行化加载：避免跨午夜翻转等并发触发同时发起两次扫描。 */
  const loadChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    moodRecordsRef.current = moodRecords;
  }, [moodRecords]);

  const directorySessionCount = typeof totalSessionCount === "number" && Number.isFinite(totalSessionCount)
    ? totalSessionCount
    : (Array.isArray(sessions) ? sessions.length : 0);

  const runLoad = useCallback((now: number) => {
    const task = loadChainRef.current.then(async () => {
      if (!isMountedRef.current) return;
      try {
        const next = await loadWorkbenchActivitySnapshot({
          now,
          totalSessionCount: directorySessionCount,
          previous: activityRef.current,
        });
        if (!isMountedRef.current || next === activityRef.current) return;
        activityRef.current = next;
        setActivity(next);
      } catch (error: unknown) {
        // 读取失败（存储不可用/事务中止）时保留上一次快照，工作台退化为旧数据而不是空白崩溃。
        logger.warn("工作台活动聚合读取失败，沿用上一次快照", { error });
      }
    });
    loadChainRef.current = task.catch(() => undefined);
    return task;
  }, [directorySessionCount]);

  useEffect(() => {
    // 主 Tab 是 Keep-Alive：隐藏页签不重算，重新激活时再由本 effect 补一次刷新。
    if (activeTab !== "workbench") return;
    const timer = window.setTimeout(() => {
      // 统一时间基准：窗口 / 今日边界 / dayKey 都由这一次取时推导。
      runLoad(touch());
    }, ACTIVITY_REFRESH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [activeTab, dayKey, sessions, directorySessionCount, runLoad, touch]);

  useEffect(() => {
    const timer = window.setTimeout(() => persistMoods(moodRecords), MOOD_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [moodRecords]);

  useEffect(() => () => persistMoods(moodRecordsRef.current), []);

  const dailyMoods = useMemo(() => new Map<string, MoodPoint>(Object.entries(moodRecords)), [moodRecords]);

  const saveMood = useCallback(
    (point: { x: number; y: number }, targetDateKey: string = dayKey) => {
      const updated: MoodPoint = {
        x: Math.max(-1, Math.min(1, Number(point.x.toFixed(2)))),
        y: Math.max(-1, Math.min(1, Number(point.y.toFixed(2)))),
        updatedAt: Date.now(),
      };
      setMoodRecords((previous) => ({ ...previous, [targetDateKey]: updated }));
    },
    [dayKey],
  );

  const value = useMemo<WorkbenchActivityContextValue>(
    () => ({ activity, todayKey: dayKey, dailyMoods, saveMood }),
    [activity, dayKey, dailyMoods, saveMood],
  );

  return (
    <WorkbenchActivityContext.Provider value={value}>{children}</WorkbenchActivityContext.Provider>
  );
};

/** 工作台卡片读取聚合数据的唯一入口；无 Provider 时返回稳定降级值。 */
export function useWorkbenchActivity(): WorkbenchActivityContextValue {
  return useContext(WorkbenchActivityContext) ?? FALLBACK_CONTEXT;
}
