/**
 * 工作台统一「当前本地日」时间基准测试。
 *
 * 此前各处各自 `new Date()`（其中今日键还被冻结在挂载时刻），跨过本地 0 点后
 * 「今日数字 / 日历高亮 / 罗盘写回日期」会互相错位。这里断言三者同源且自动翻转。
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLocalDayClock } from "../../src/hooks/useLocalDayClock";
import { formatLocalDayKey, msUntilNextLocalDay } from "../../src/domain/analytics/activityAggregation";

describe("useLocalDayClock（工作台统一本地日基准）", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("挂载时给出当前本地日键，且取时与日键同源", () => {
    vi.useFakeTimers();
    const now = new Date(2026, 4, 17, 8, 0, 0).getTime();
    vi.setSystemTime(now);

    const { result } = renderHook(() => useLocalDayClock(() => Date.now()));
    expect(result.current.dayKey).toBe("2026-05-17");

    const touched = result.current.touch();
    expect(touched).toBe(now);
    expect(formatLocalDayKey(touched)).toBe(result.current.dayKey);
  });

  it("跨过本地午夜后自动翻转日键（挂载后不再手动触发）", () => {
    vi.useFakeTimers();
    const beforeMidnight = new Date(2026, 4, 17, 23, 59, 30).getTime();
    vi.setSystemTime(beforeMidnight);

    const { result } = renderHook(() => useLocalDayClock(() => Date.now()));
    expect(result.current.dayKey).toBe("2026-05-17");

    act(() => {
      // 定时器延迟 = 到下一个当地 0 点的毫秒数 + 1s 边界守卫
      vi.advanceTimersByTime(msUntilNextLocalDay(beforeMidnight) + 1000);
    });

    expect(result.current.dayKey).toBe("2026-05-18");
    expect(formatLocalDayKey(result.current.touch())).toBe("2026-05-18");
  });

  it("定时器被冻结（WebView 后台）后回到前台按真实时钟自我纠正", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 17, 23, 0, 0).getTime());

    const { result } = renderHook(() => useLocalDayClock(() => Date.now()));
    expect(result.current.dayKey).toBe("2026-05-17");

    // 只推进系统时钟、不触发任何定时器，模拟被冻结的调度器
    vi.setSystemTime(new Date(2026, 4, 18, 8, 30, 0).getTime());
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current.dayKey).toBe("2026-05-18");
  });

  it("卸载后不再保留跨日定时器", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 17, 23, 59, 0).getTime());
    const clearSpy = vi.spyOn(window, "clearTimeout");

    const { unmount } = renderHook(() => useLocalDayClock(() => Date.now()));
    unmount();

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
