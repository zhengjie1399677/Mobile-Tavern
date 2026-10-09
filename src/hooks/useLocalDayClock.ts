/**
 * 单一「当前本地日」时间基准。
 *
 * 工作台的今日统计、日历高亮与心相罗盘写回日期都必须取自这里：
 * 此前各处各自 `new Date()`（其中今日键还被 `useMemo(…, [])` 冻结在挂载时刻），
 * 跨过本地 0 点后会出现「今日数字停在昨天、日历高亮在昨天、罗盘却把记录写进昨天」的错位。
 *
 * 实现要点：
 *   - 定时器只在跨日时更新状态，平时不产生任何重渲染；
 *   - 定时器因系统休眠/后台被延迟后，回调会以真实时钟重新计算并自我纠正；
 *   - 回到前台时补一次检查，覆盖 WebView 暂停定时器的场景。
 *   - 渲染期不读写 ref：初值走 `useState` 惰性初始化，ref 只在回调/副作用里同步。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { formatLocalDayKey, msUntilNextLocalDay } from "../domain/analytics/activityAggregation";

export interface LocalDayClock {
  /** 当前本地日键（YYYY-MM-DD）。 */
  dayKey: string;
  /** 取一次真实时间并同步日键；返回同一时刻的时间戳，供窗口推导复用。 */
  touch: () => number;
}

/** 定时器触发后仍取整到边界前 1 秒，避免时钟微调导致整点判定落在前一日。 */
const DAY_BOUNDARY_GUARD_MS = 1000;

export function useLocalDayClock(now: () => number = Date.now): LocalDayClock {
  const [dayKey, setDayKey] = useState<string>(() => formatLocalDayKey(now()));
  const nowRef = useRef<number>(0);
  const dayKeyRef = useRef<string>("");

  const touch = useCallback((): number => {
    const current = now();
    nowRef.current = current;
    const nextKey = formatLocalDayKey(current);
    if (nextKey !== dayKeyRef.current) {
      dayKeyRef.current = nextKey;
      setDayKey(nextKey);
    }
    return current;
  }, [now]);

  useEffect(() => {
    // 挂载时对齐 ref：状态是日键的权威来源，渲染期不参与读写。
    dayKeyRef.current = dayKey;
    nowRef.current = now();
    if (typeof window === "undefined") return;

    let timer = 0;
    const schedule = () => {
      const delay = msUntilNextLocalDay(nowRef.current) + DAY_BOUNDARY_GUARD_MS;
      timer = window.setTimeout(() => {
        touch();
        schedule();
      }, delay);
    };
    schedule();

    const handleVisibilityChange = () => {
      // 移动端 WebView 冻结/节流定时器后返回前台：立即以真实时钟校正一次。
      if (typeof document === "undefined" || document.visibilityState === "visible") touch();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      window.clearTimeout(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
    // dayKey 由本次 effect 同步进 ref，不需要作为依赖触发重排定时器
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touch]);

  return { dayKey, touch };
}
