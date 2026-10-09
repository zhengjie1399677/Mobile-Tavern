/**
 * 工作台活动聚合的领域规则测试。
 *
 * 关注点：本地日 / 本地小时分桶语义（不得退化为 UTC）、窗口边界、
 * 累加器对越界与非法记录的丢弃、生成样本上限，以及跨午夜时「今天」的一致性。
 */

import { describe, expect, it } from "vitest";
import {
  GENERATION_SAMPLE_LIMIT,
  buildLast7Days,
  createActivityAccumulator,
  findMaxDailyCount,
  formatLocalDayKey,
  msUntilNextLocalDay,
  resolveActivityWindow,
  startOfLocalDay,
  type ActivityMessageRecord,
} from "../../src/domain/analytics/activityAggregation";

function message(overrides: Partial<ActivityMessageRecord> & { timestamp: number }): ActivityMessageRecord {
  return {
    id: `m-${overrides.timestamp}`,
    sessionId: "s-1",
    role: "user",
    ...overrides,
  };
}

describe("工作台活动聚合领域规则", () => {
  describe("本地日基准", () => {
    it("按本地日历取日键，不做 UTC 偏移", () => {
      // 本地时间 23:30 必须仍属于当天（若误用 UTC，东八区会跨到次日）
      expect(formatLocalDayKey(new Date(2026, 4, 17, 23, 30, 0).getTime())).toBe("2026-05-17");
      expect(formatLocalDayKey(new Date(2026, 0, 1, 0, 0, 0).getTime())).toBe("2026-01-01");
    });

    it("startOfLocalDay 归零到当地 0 点", () => {
      const noon = new Date(2026, 4, 17, 13, 45, 30, 123).getTime();
      expect(startOfLocalDay(noon)).toBe(new Date(2026, 4, 17, 0, 0, 0, 0).getTime());
    });

    it("窗口起点为 windowDays-1 天前的当地 0 点，且窗口内所有边界同源", () => {
      const now = new Date(2026, 4, 17, 9, 0, 0).getTime();
      const window = resolveActivityWindow(now, 7);
      expect(window.windowStart).toBe(new Date(2026, 4, 11, 0, 0, 0, 0).getTime());
      expect(window.todayStart).toBe(new Date(2026, 4, 17, 0, 0, 0, 0).getTime());
      expect(window.windowDays).toBe(7);
    });

    it("msUntilNextLocalDay 指向下一个当地 0 点", () => {
      const beforeMidnight = new Date(2026, 4, 17, 23, 59, 0, 0).getTime();
      expect(msUntilNextLocalDay(beforeMidnight)).toBe(60_000);
      const midnight = new Date(2026, 4, 17, 0, 0, 0, 0).getTime();
      const nextMidnight = new Date(2026, 4, 18, 0, 0, 0, 0).getTime();
      expect(msUntilNextLocalDay(midnight)).toBe(nextMidnight - midnight);
    });
  });

  describe("累加器", () => {
    it("空数据返回稳定的空形状", () => {
      const window = resolveActivityWindow(new Date(2026, 4, 17, 10, 0, 0).getTime(), 7);
      const result = createActivityAccumulator(window).finish();
      expect(result.scannedMessages).toBe(0);
      expect(result.dailyCounts.size).toBe(0);
      expect(result.hourlyCounts).toHaveLength(24);
      expect(result.hourlyCounts.every((count) => count === 0)).toBe(true);
      expect(result.todayCount).toBe(0);
      expect(result.todaySessionCount).toBe(0);
      expect(result.generation).toEqual({ totalTokens: 0, totalSeconds: 0, averageSpeed: 0, samples: [] });
    });

    it("按本地日与本地小时分桶，并统计今日活跃会话数", () => {
      const now = new Date(2026, 4, 17, 22, 0, 0).getTime();
      const window = resolveActivityWindow(now, 7);
      const accumulator = createActivityAccumulator(window);

      accumulator.push(message({ timestamp: new Date(2026, 4, 17, 9, 5, 0).getTime(), sessionId: "s-1" }));
      accumulator.push(message({ timestamp: new Date(2026, 4, 17, 9, 55, 0).getTime(), sessionId: "s-1" }));
      accumulator.push(message({ timestamp: new Date(2026, 4, 17, 15, 1, 0).getTime(), sessionId: "s-2" }));
      // 窗口外的旧消息：即使来自同一会话也必须丢弃
      accumulator.push(message({ timestamp: new Date(2026, 4, 1, 12, 0, 0).getTime(), sessionId: "s-3" }));

      const result = accumulator.finish();
      expect(result.scannedMessages).toBe(3);
      expect(result.dailyCounts.get("2026-05-17")).toBe(3);
      expect(result.hourlyCounts[9]).toBe(2);
      expect(result.hourlyCounts[15]).toBe(1);
      expect(result.todayCount).toBe(3);
      expect(result.todaySessionCount).toBe(2);
    });

    it("丢弃时间戳非法或非正的记录", () => {
      const window = resolveActivityWindow(new Date(2026, 4, 17, 10, 0, 0).getTime(), 7);
      const accumulator = createActivityAccumulator(window);
      accumulator.push(message({ timestamp: 0 }));
      accumulator.push(message({ timestamp: -1 }));
      accumulator.push(message({ timestamp: Number.NaN }));
      accumulator.push(message({ timestamp: Number.POSITIVE_INFINITY }));
      expect(accumulator.finish().scannedMessages).toBe(0);
    });

    it("生成样本只保留最近 40 条，速度按逐条样本平均", () => {
      const now = new Date(2026, 4, 17, 23, 0, 0).getTime();
      const window = resolveActivityWindow(now, 7);
      const accumulator = createActivityAccumulator(window);
      const base = new Date(2026, 4, 17, 1, 0, 0).getTime();

      for (let i = 0; i < GENERATION_SAMPLE_LIMIT + 5; i += 1) {
        accumulator.push(
          message({
            id: `a-${i}`,
            role: "assistant",
            timestamp: base + i * 60_000,
            tokenCount: 100,
            generationTime: 10,
          }),
        );
      }
      // 只有耗时没有 token 的回复也计入耗时统计，但不产生速度样本
      accumulator.push(message({ id: "a-zero", role: "assistant", timestamp: base + 60 * 60_000, generationTime: 4 }));

      const result = accumulator.finish();
      expect(result.generation.samples).toHaveLength(GENERATION_SAMPLE_LIMIT);
      // 队首是第 7 条（最旧的 6 条被挤出）
      expect(result.generation.samples[0].id).toBe("a-6");
      expect(result.generation.totalTokens).toBe((GENERATION_SAMPLE_LIMIT + 5) * 100);
      expect(result.generation.totalSeconds).toBeCloseTo((GENERATION_SAMPLE_LIMIT + 5) * 10 + 4, 5);
      expect(result.generation.averageSpeed).toBeCloseTo(10, 5);
    });

    it("普通用户消息不进入生成样本", () => {
      const window = resolveActivityWindow(new Date(2026, 4, 17, 12, 0, 0).getTime(), 7);
      const accumulator = createActivityAccumulator(window);
      accumulator.push(
        message({ role: "user", timestamp: new Date(2026, 4, 17, 11, 0, 0).getTime(), tokenCount: 50, generationTime: 5 }),
      );
      expect(accumulator.finish().generation.samples).toHaveLength(0);
    });
  });

  describe("近 7 天序列", () => {
    it("始终返回 7 个点、缺失日期补 0、顺序由旧到新且末位是今天", () => {
      const now = new Date(2026, 4, 17, 8, 30, 0).getTime();
      const series = buildLast7Days(new Map([["2026-05-17", 4], ["2026-05-11", 2]]), now);

      expect(series).toHaveLength(7);
      expect(series[0].dateStr).toBe("2026-05-11");
      expect(series[0].count).toBe(2);
      expect(series[6].dateStr).toBe("2026-05-17");
      expect(series[6].count).toBe(4);
      expect(series[6].dateStr).toBe(formatLocalDayKey(now));
      // 中间的缺失日期补 0，而不是被跳过
      expect(series.slice(1, 6).map((point) => point.count)).toEqual([0, 0, 0, 0, 0]);
      // 星期标签与本地日历一致
      expect(series[6].dayLabel).toBe(["日", "一", "二", "三", "四", "五", "六"][new Date(now).getDay()]);
    });

    it("跨过本地午夜后，末位立即翻到新的一天", () => {
      const beforeMidnight = new Date(2026, 4, 17, 23, 59, 30).getTime();
      const afterMidnight = new Date(2026, 4, 18, 0, 0, 30).getTime();
      const counts = new Map([
        ["2026-05-17", 9],
        ["2026-05-18", 0],
      ]);

      expect(buildLast7Days(counts, beforeMidnight)[6].dateStr).toBe("2026-05-17");
      const nextDaySeries = buildLast7Days(counts, afterMidnight);
      expect(nextDaySeries[6].dateStr).toBe("2026-05-18");
      // 昨天不会消失，只是退到倒数第二位
      expect(nextDaySeries[5].dateStr).toBe("2026-05-17");
      expect(nextDaySeries[5].count).toBe(9);
    });

    it("窗口下界与 7 日序列一致：7 天前的消息不计入今日", () => {
      const now = new Date(2026, 4, 17, 0, 10, 0).getTime();
      const window = resolveActivityWindow(now, 7);
      const accumulator = createActivityAccumulator(window);
      // 昨天 23:50：属于「昨天」，绝不能被算成今天（跨午夜错位的核心断言）
      accumulator.push(message({ timestamp: new Date(2026, 4, 16, 23, 50, 0).getTime(), sessionId: "s-1" }));
      accumulator.push(message({ timestamp: new Date(2026, 4, 17, 0, 5, 0).getTime(), sessionId: "s-2" }));

      const result = accumulator.finish();
      expect(result.todayCount).toBe(1);
      expect(result.todaySessionCount).toBe(1);
      expect(result.dailyCounts.get("2026-05-16")).toBe(1);
      expect(result.dailyCounts.get("2026-05-17")).toBe(1);
      // 小时分布与「今日」同边界：昨天 23 点的消息不进入今日时段盘
      expect(result.hourlyCounts[23]).toBe(0);
      expect(result.hourlyCounts[0]).toBe(1);
    });

    it("findMaxDailyCount 至少为 1，供归一化使用", () => {
      expect(findMaxDailyCount(new Map())).toBe(1);
      expect(findMaxDailyCount(new Map([["2026-05-17", 0]]))).toBe(1);
      expect(findMaxDailyCount(new Map([["2026-05-17", 3], ["2026-05-16", 12]]))).toBe(12);
    });
  });
});
