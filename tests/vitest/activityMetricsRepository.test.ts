/**
 * 工作台活动只读仓库测试（真实 IndexedDB 实现，使用 fake-indexeddb）。
 *
 * 覆盖：版本信号读取、`createdAt` 索引 + IDBKeyRange 的窗口收窄、
 * 空库降级与「记录不离开仓库」的聚合口径。
 */

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readActivityRevision,
  scanActivityMessages,
} from "../../src/infrastructure/storage/repositories/activityMetricsRepository";
import { appendMessage } from "../../src/infrastructure/storage/indexedDbMemoryStore";
import { __resetDBInstanceForTesting } from "../../src/utils/localDB";
import { DB_NAME } from "../../src/infrastructure/storage/dbSchema";
import { startOfLocalDay } from "../../src/domain/analytics/activityAggregation";

const NOW = new Date(2026, 4, 17, 22, 0, 0).getTime();

function deleteDatabase(): Promise<void> {
  __resetDBInstanceForTesting();
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("测试数据库删除被阻塞"));
  });
}

async function seedMessage(
  id: string,
  createdAt: number,
  extra: { role?: string; tokenCount?: number; generationTime?: number; sessionId?: string } = {},
): Promise<void> {
  await appendMessage({
    id,
    sessionId: extra.sessionId ?? "s-1",
    role: extra.role ?? "user",
    createdAt,
    content: `内容-${id}`,
    tokenCount: extra.tokenCount,
    generationTime: extra.generationTime,
  });
}

describe("工作台活动只读仓库", () => {
  beforeEach(deleteDatabase);
  afterEach(deleteDatabase);

  it("空库返回零值版本信号与空聚合", async () => {
    expect(await readActivityRevision()).toEqual({ messageCount: 0, latestCreatedAt: 0 });

    const windowStart = startOfLocalDay(NOW);
    const result = await scanActivityMessages({ windowStart, todayStart: windowStart });
    expect(result.scannedMessages).toBe(0);
    expect(result.dailyCounts.size).toBe(0);
    expect(result.todayCount).toBe(0);
    expect(result.generation.samples).toEqual([]);
  });

  it("版本信号读取条数与最新消息时间戳", async () => {
    await seedMessage("m-1", new Date(2026, 4, 17, 9, 0, 0).getTime());
    await seedMessage("m-2", new Date(2026, 4, 17, 18, 0, 0).getTime());

    const revision = await readActivityRevision();
    expect(revision.messageCount).toBe(2);
    expect(revision.latestCreatedAt).toBe(new Date(2026, 4, 17, 18, 0, 0).getTime());
  });

  it("只聚合窗口内的消息：更早的历史不进入计数", async () => {
    // 窗口内（今日）
    await seedMessage("today-1", new Date(2026, 4, 17, 9, 0, 0).getTime(), { sessionId: "s-1" });
    await seedMessage("today-2", new Date(2026, 4, 17, 9, 30, 0).getTime(), { sessionId: "s-2" });
    // 窗口内（前一天）
    await seedMessage("yesterday-1", new Date(2026, 4, 16, 20, 0, 0).getTime(), { sessionId: "s-1" });
    // 窗口外（远早于 7 日窗口下界）
    await seedMessage("old-1", new Date(2026, 3, 1, 12, 0, 0).getTime(), { sessionId: "s-9" });

    const windowStart = new Date(2026, 4, 11, 0, 0, 0, 0).getTime();
    const todayStart = startOfLocalDay(NOW);
    const result = await scanActivityMessages({ windowStart, todayStart });

    expect(result.scannedMessages).toBe(3);
    expect(result.dailyCounts.get("2026-05-17")).toBe(2);
    expect(result.dailyCounts.get("2026-05-16")).toBe(1);
    expect(result.dailyCounts.has("2026-04-01")).toBe(false);
    expect(result.todayCount).toBe(2);
    expect(result.todaySessionCount).toBe(2);
    // 小时分布只描述今天：昨天的 20 点不会混进来
    expect(result.hourlyCounts[9]).toBe(2);
    expect(result.hourlyCounts[20]).toBe(0);
  });

  it("生成用量来自助手消息自身的持久化字段，用户消息不参与", async () => {
    await seedMessage("user-1", new Date(2026, 4, 17, 8, 0, 0).getTime(), {
      role: "user",
      tokenCount: 999,
      generationTime: 99,
    });
    await seedMessage("assistant-1", new Date(2026, 4, 17, 8, 1, 0).getTime(), {
      role: "assistant",
      tokenCount: 200,
      generationTime: 10,
    });

    const windowStart = startOfLocalDay(NOW);
    const result = await scanActivityMessages({ windowStart, todayStart: windowStart });

    expect(result.generation.samples).toEqual([{ id: "assistant-1", tokens: 200, seconds: 10, speed: 20 }]);
    expect(result.generation.totalTokens).toBe(200);
    expect(result.generation.totalSeconds).toBe(10);
    expect(result.generation.averageSpeed).toBe(20);
  });

  it("重复读取是只读的：不改变版本信号", async () => {
    await seedMessage("m-1", new Date(2026, 4, 17, 9, 0, 0).getTime());
    const before = await readActivityRevision();
    await scanActivityMessages({ windowStart: startOfLocalDay(NOW), todayStart: startOfLocalDay(NOW) });
    await scanActivityMessages({ windowStart: startOfLocalDay(NOW), todayStart: startOfLocalDay(NOW) });
    expect(await readActivityRevision()).toEqual(before);
  });
});
