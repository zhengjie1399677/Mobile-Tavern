/**
 * 工作台活动用例测试：缓存键判断、图表形状收口与失败传播。
 *
 * 用例不直接访问 IndexedDB，测试通过注入的假读取端口驱动，
 * 因此可以精确断言「流式渲染期间不重复扫描」这条性能约束。
 */

import { describe, expect, it, vi } from "vitest";
import {
  createEmptyWorkbenchActivitySnapshot,
  createWorkbenchActivityLoader,
  shapeWorkbenchActivitySnapshot,
  type WorkbenchActivityReader,
} from "../../src/application/useCases/workbenchActivityUseCases";
import {
  createActivityAccumulator,
  resolveActivityWindow,
  type ActivityMessageRecord,
  type ActivityScanResult,
} from "../../src/domain/analytics/activityAggregation";
import type { ActivityRevision } from "../../src/infrastructure/storage/repositories/activityMetricsRepository";

const NOW = new Date(2026, 4, 17, 22, 30, 0).getTime();

function message(overrides: Partial<ActivityMessageRecord> & { timestamp: number }): ActivityMessageRecord {
  return { id: `m-${overrides.timestamp}`, sessionId: "s-1", role: "user", ...overrides };
}

function scanOf(
  records: ActivityMessageRecord[],
  now: number = NOW,
): ActivityScanResult {
  const accumulator = createActivityAccumulator(resolveActivityWindow(now, 7));
  for (const record of records) accumulator.push(record);
  return accumulator.finish();
}

function createFakeReader(options: {
  revision: ActivityRevision;
  scan?: ActivityScanResult;
  scanRejects?: boolean;
}): WorkbenchActivityReader & { scanCalls: number; revisionCalls: number } {
  const reader = {
    scanCalls: 0,
    revisionCalls: 0,
    async readRevision(): Promise<ActivityRevision> {
      reader.revisionCalls += 1;
      return options.revision;
    },
    async scan(): Promise<ActivityScanResult> {
      reader.scanCalls += 1;
      if (options.scanRejects) throw new Error("事务中止");
      return options.scan ?? scanOf([]);
    },
  };
  return reader;
}

describe("工作台活动用例", () => {
  it("空快照始终具备完整图表形状（7 天 + 24 小时）", () => {
    const snapshot = createEmptyWorkbenchActivitySnapshot(NOW, 12);
    expect(snapshot.last7Days).toHaveLength(7);
    expect(snapshot.hourlyDistribution).toHaveLength(24);
    expect(snapshot.totalSessionCount).toBe(12);
    expect(snapshot.todayCount).toBe(0);
    expect(snapshot.dailyHeatmap.size).toBe(0);
    expect(snapshot.generation.samples).toEqual([]);
  });

  it("首次加载会扫描一次，并把仓库聚合收口成图表形状", async () => {
    const reader = createFakeReader({
      revision: { messageCount: 2, latestCreatedAt: NOW },
      scan: scanOf([
        message({ timestamp: new Date(2026, 4, 17, 9, 0, 0).getTime() }),
        message({ timestamp: new Date(2026, 4, 17, 10, 0, 0).getTime(), sessionId: "s-2" }),
      ]),
    });
    const load = createWorkbenchActivityLoader(reader, 7);

    const snapshot = await load({ now: NOW, totalSessionCount: 3 });

    expect(reader.scanCalls).toBe(1);
    expect(snapshot.todayCount).toBe(2);
    expect(snapshot.todaySessionCount).toBe(2);
    expect(snapshot.totalSessionCount).toBe(3);
    expect(snapshot.dailyHeatmap.get("2026-05-17")).toBe(2);
    expect(snapshot.last7Days.at(-1)?.dateStr).toBe("2026-05-17");
    expect(snapshot.last7Days.at(-1)?.count).toBe(2);
  });

  it("版本信号与窗口口径都没变时复用上一次快照，不再扫描", async () => {
    const reader = createFakeReader({
      revision: { messageCount: 2, latestCreatedAt: NOW },
      scan: scanOf([message({ timestamp: new Date(2026, 4, 17, 9, 0, 0).getTime() })]),
    });
    const load = createWorkbenchActivityLoader(reader, 7);

    const first = await load({ now: NOW, totalSessionCount: 3 });
    const second = await load({ now: NOW, totalSessionCount: 3, previous: first });

    expect(reader.scanCalls).toBe(1);
    // 完全一致时直接返回同一引用，React 侧可以据此跳过 setState
    expect(second).toBe(first);
  });

  it("只有总会话数变化时只改计数，不触发扫描", async () => {
    const reader = createFakeReader({
      revision: { messageCount: 2, latestCreatedAt: NOW },
      scan: scanOf([message({ timestamp: new Date(2026, 4, 17, 9, 0, 0).getTime() })]),
    });
    const load = createWorkbenchActivityLoader(reader, 7);

    const first = await load({ now: NOW, totalSessionCount: 3 });
    const second = await load({ now: NOW, totalSessionCount: 48, previous: first });

    expect(reader.scanCalls).toBe(1); // 会话目录分页加载不会带来消息库全量重扫
    expect(second.totalSessionCount).toBe(48);
    expect(second.versionKey).not.toBe(first.versionKey);
    expect(second.scanKey).toBe(first.scanKey);
    expect(second.dailyHeatmap).toBe(first.dailyHeatmap);
  });

  it("消息库版本变化时重新扫描", async () => {
    let revision: ActivityRevision = { messageCount: 1, latestCreatedAt: NOW };
    const reader: WorkbenchActivityReader & { scanCalls: number } = {
      scanCalls: 0,
      async readRevision() {
        return revision;
      },
      async scan() {
        reader.scanCalls += 1;
        return scanOf([message({ timestamp: new Date(2026, 4, 17, 9, 0, 0).getTime() })]);
      },
    };
    const load = createWorkbenchActivityLoader(reader, 7);

    const first = await load({ now: NOW, totalSessionCount: 3 });
    revision = { messageCount: 2, latestCreatedAt: NOW + 1000 };
    const second = await load({ now: NOW, totalSessionCount: 3, previous: first });

    expect(reader.scanCalls).toBe(2);
    expect(second).not.toBe(first);
  });

  it("跨过本地午夜后，即使消息库没变也必须重算（今日与 7 日窗口已变）", async () => {
    const reader = createFakeReader({
      revision: { messageCount: 1, latestCreatedAt: NOW },
      scan: scanOf([message({ timestamp: new Date(2026, 4, 17, 9, 0, 0).getTime() })]),
    });
    const load = createWorkbenchActivityLoader(reader, 7);

    const first = await load({ now: NOW, totalSessionCount: 3 });
    const nextDay = new Date(2026, 4, 18, 0, 5, 0).getTime();
    const second = await load({ now: nextDay, totalSessionCount: 3, previous: first });

    expect(reader.scanCalls).toBe(2);
    expect(first.dayKey).toBe("2026-05-17");
    expect(second.dayKey).toBe("2026-05-18");
    expect(second.last7Days.at(-1)?.dateStr).toBe("2026-05-18");
    expect(second.last7Days[5].dateStr).toBe("2026-05-17");
  });

  it("读取失败向上抛错，由调用方决定沿用旧快照", async () => {
    const reader = createFakeReader({
      revision: { messageCount: 1, latestCreatedAt: NOW },
      scanRejects: true,
    });
    const load = createWorkbenchActivityLoader(reader, 7);
    await expect(load({ now: NOW, totalSessionCount: 1 })).rejects.toThrow("事务中止");
  });

  it("shapeWorkbenchActivitySnapshot 是纯函数：同一输入产出同一口径", () => {
    const scan = scanOf([message({ timestamp: new Date(2026, 4, 16, 8, 0, 0).getTime() })]);
    const input = {
      now: NOW,
      totalSessionCount: 7,
      revision: { messageCount: 1, latestCreatedAt: NOW },
      scan,
      windowDays: 7,
    };
    const first = shapeWorkbenchActivitySnapshot(input);
    const second = shapeWorkbenchActivitySnapshot(input);
    expect(first.scanKey).toBe(second.scanKey);
    expect(first.versionKey).toBe(second.versionKey);
    expect(first.last7Days.map((d) => d.count)).toEqual([0, 0, 0, 0, 0, 1, 0]);
    expect(first.maxDailyCount).toBe(1);
  });

  it("用例不依赖真实存储：注入端口未提供 scan 结果时也不会触碰 IndexedDB", async () => {
    const reader = createFakeReader({ revision: { messageCount: 0, latestCreatedAt: 0 } });
    const spy = vi.spyOn(reader, "scan");
    const load = createWorkbenchActivityLoader(reader, 7);
    const snapshot = await load({ now: NOW, totalSessionCount: 0 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(snapshot.revision).toEqual({ messageCount: 0, latestCreatedAt: 0 });
  });
});
