/**
 * 工作台活动数据的应用用例。
 *
 * 界面（工作台卡片）只拿「图表形状」的快照：本地日热力、近 7 天趋势、今日小时分布、
 * 总会话数与生成用量样本。用例本身不持有 React 状态、不渲染界面，也不直接访问 IndexedDB——
 * 物理扫描由 infrastructure 仓库完成，这里只做口径推导、形状收口与版本键缓存判断。
 *
 * 缓存策略：先用两个廉价请求读版本信号（消息条数 + 最新时间戳），
 * 版本键未变时直接复用上一次快照，因此流式渲染期间不会每次重渲染都全量扫描。
 */

import {
  ACTIVITY_WINDOW_DAYS,
  buildLast7Days,
  createEmptyHourlyCounts,
  findMaxDailyCount,
  formatLocalDayKey,
  resolveActivityWindow,
  type ActivityDayMetric,
  type ActivityGenerationStats,
  type ActivityScanResult,
} from "../../domain/analytics/activityAggregation";
import {
  readActivityRevision,
  scanActivityMessages,
  type ActivityRevision,
} from "../../infrastructure/storage/repositories/activityMetricsRepository";

/** 工作台活动快照：卡片直接消费的最终形状。 */
export interface WorkbenchActivitySnapshot {
  /** 完整版本键：扫描口径 + 目录总会话数。相同即表示可以整体复用。 */
  versionKey: string;
  /** 扫描口径版本键：不含总会话数，相同即表示无需重新扫描消息库。 */
  scanKey: string;
  /** 快照所属本地日（YYYY-MM-DD），跨午夜后与新基准不一致即触发重算。 */
  dayKey: string;
  /** 扫描窗口起点（本地日边界）。 */
  windowStart: number;
  windowDays: number;
  /** 生成该快照时读到的存储版本信号。 */
  revision: ActivityRevision;
  /** 窗口内已统计的消息条数（诊断用）。 */
  scannedMessages: number;
  /** 目录里的会话总数（来自会话统计，不是「已加载页」）。 */
  totalSessionCount: number;
  /** 本地日 → 消息数。 */
  dailyHeatmap: Map<string, number>;
  /** 今日各本地小时 → 消息数，长度 24。 */
  hourlyDistribution: number[];
  todayCount: number;
  todaySessionCount: number;
  last7Days: ActivityDayMetric[];
  maxDailyCount: number;
  generation: ActivityGenerationStats;
}

/** 用例依赖的读取端口；默认绑定真实仓库，测试可注入假实现。 */
export interface WorkbenchActivityReader {
  readRevision(): Promise<ActivityRevision>;
  scan(input: { windowStart: number; todayStart: number }): Promise<ActivityScanResult>;
}

export interface WorkbenchActivityLoadInput {
  /** 本次加载的统一时间基准：窗口、今日边界与 dayKey 都由它推导。 */
  now: number;
  totalSessionCount: number;
  previous?: WorkbenchActivitySnapshot | null;
}

export type WorkbenchActivityLoader = (
  input: WorkbenchActivityLoadInput,
) => Promise<WorkbenchActivitySnapshot>;

function buildScanKey(input: {
  revision: ActivityRevision;
  dayKey: string;
  windowStart: number;
  windowDays: number;
}): string {
  return [
    input.revision.messageCount,
    input.revision.latestCreatedAt,
    input.dayKey,
    input.windowStart,
    input.windowDays,
  ].join(":");
}

function buildVersionKey(scanKey: string, totalSessionCount: number): string {
  return `${scanKey}:${totalSessionCount}`;
}

/** 首次进入工作台、或消息库为空时的稳定空快照（近 7 天与 24 小时均为 0）。 */
export function createEmptyWorkbenchActivitySnapshot(
  now: number,
  totalSessionCount = 0,
  windowDays = ACTIVITY_WINDOW_DAYS,
): WorkbenchActivitySnapshot {
  const window = resolveActivityWindow(now, windowDays);
  const dayKey = formatLocalDayKey(now);
  const revision: ActivityRevision = { messageCount: 0, latestCreatedAt: 0 };
  const scanKey = buildScanKey({ revision, dayKey, windowStart: window.windowStart, windowDays: window.windowDays });
  return {
    versionKey: buildVersionKey(scanKey, totalSessionCount),
    scanKey,
    dayKey,
    windowStart: window.windowStart,
    windowDays: window.windowDays,
    revision,
    scannedMessages: 0,
    totalSessionCount,
    dailyHeatmap: new Map<string, number>(),
    hourlyDistribution: createEmptyHourlyCounts(),
    todayCount: 0,
    todaySessionCount: 0,
    last7Days: buildLast7Days(new Map<string, number>(), now),
    maxDailyCount: 1,
    generation: { totalTokens: 0, totalSeconds: 0, averageSpeed: 0, samples: [] },
  };
}

/** 纯收口：把仓库聚合结果 + 目录总数组装成图表形状。 */
export function shapeWorkbenchActivitySnapshot(input: {
  now: number;
  totalSessionCount: number;
  revision: ActivityRevision;
  scan: ActivityScanResult;
  windowDays?: number;
}): WorkbenchActivitySnapshot {
  const window = resolveActivityWindow(input.now, input.windowDays ?? ACTIVITY_WINDOW_DAYS);
  const dayKey = formatLocalDayKey(input.now);
  const scanKey = buildScanKey({
    revision: input.revision,
    dayKey,
    windowStart: window.windowStart,
    windowDays: window.windowDays,
  });
  return {
    versionKey: buildVersionKey(scanKey, input.totalSessionCount),
    scanKey,
    dayKey,
    windowStart: window.windowStart,
    windowDays: window.windowDays,
    revision: input.revision,
    scannedMessages: input.scan.scannedMessages,
    totalSessionCount: input.totalSessionCount,
    dailyHeatmap: input.scan.dailyCounts,
    hourlyDistribution: input.scan.hourlyCounts,
    todayCount: input.scan.todayCount,
    todaySessionCount: input.scan.todaySessionCount,
    last7Days: buildLast7Days(input.scan.dailyCounts, input.now),
    maxDailyCount: findMaxDailyCount(input.scan.dailyCounts),
    generation: input.scan.generation,
  };
}

/** 用注入的读取端口创建工作台活动加载器（缓存判断与收口逻辑集中在用例内）。 */
export function createWorkbenchActivityLoader(
  reader: WorkbenchActivityReader,
  windowDays = ACTIVITY_WINDOW_DAYS,
): WorkbenchActivityLoader {
  return async function loadWorkbenchActivitySnapshot(input) {
    const revision = await reader.readRevision();
    const window = resolveActivityWindow(input.now, windowDays);
    const dayKey = formatLocalDayKey(input.now);
    const scanKey = buildScanKey({
      revision,
      dayKey,
      windowStart: window.windowStart,
      windowDays: window.windowDays,
    });
    const previous = input.previous ?? null;

    if (previous && previous.scanKey === scanKey) {
      // 消息库与窗口口径都没变：只可能是指标里附带的总会话数变了，无需重新扫描。
      if (previous.totalSessionCount === input.totalSessionCount) return previous;
      return {
        ...previous,
        totalSessionCount: input.totalSessionCount,
        versionKey: buildVersionKey(scanKey, input.totalSessionCount),
      };
    }

    const scan = await reader.scan({
      windowStart: window.windowStart,
      todayStart: window.todayStart,
    });
    return shapeWorkbenchActivitySnapshot({
      now: input.now,
      totalSessionCount: input.totalSessionCount,
      revision,
      scan,
      windowDays,
    });
  };
}

/** 生产默认加载器：读取端口绑定真实只读仓库。 */
export const loadWorkbenchActivitySnapshot: WorkbenchActivityLoader = createWorkbenchActivityLoader({
  readRevision: readActivityRevision,
  scan: scanActivityMessages,
});
