/**
 * 工作台活动聚合的纯领域规则。
 *
 * 只做「消息时间戳 → 本地日 / 本地小时分桶」与「生成用量汇总」的无 IO 计算：
 * 存储仓库负责扫描与按索引收窄，应用用例负责组装图表形状，React 只消费结果。
 *
 * 分桶口径必须保持本地时区语义（`getFullYear/getMonth/getDate/getHours`），
 * 不得改用 UTC——否则东八区等时区的用户会出现整块日期偏移一天。
 */

/** 工作台活动聚合默认回看窗口（本地日，含今天）。 */
export const ACTIVITY_WINDOW_DAYS = 120;

/** 生成性能样本的保留条数：与原 TokenPerformanceWidget 的“最近 40 条”一致。 */
export const GENERATION_SAMPLE_LIMIT = 40;

/** 近 7 天趋势的一个数据点。 */
export interface ActivityDayMetric {
  /** 本地日键：YYYY-MM-DD */
  dateStr: string;
  /** 星期的中文短标签："日"、"一" … */
  dayLabel: string;
  count: number;
}

/** 单条带用量字段的助手消息样本。 */
export interface ActivityGenerationSample {
  id: string;
  tokens: number;
  seconds: number;
  speed: number;
}

/** 生成性能汇总：口径与原 TokenPerformanceWidget 一致（speed 为逐条平均）。 */
export interface ActivityGenerationStats {
  totalTokens: number;
  totalSeconds: number;
  averageSpeed: number;
  samples: ActivityGenerationSample[];
}

/** 聚合窗口：全部边界都由同一个 `now` 推导，避免跨午夜时互相错位。 */
export interface ActivityWindow {
  /** 窗口起点（含）：windowDays 天前那一日的本地 00:00。 */
  windowStart: number;
  /** 今日本地 00:00（含）。 */
  todayStart: number;
  /** 推导窗口所用的时间戳。 */
  now: number;
  windowDays: number;
}

/** 仓库从 messages Store 收口出来的最小消息投影，不含正文。 */
export interface ActivityMessageRecord {
  id: string;
  sessionId: string;
  role: string;
  /** 消息时间戳（= 存储记录的 createdAt）。 */
  timestamp: number;
  tokenCount?: number;
  generationTime?: number;
}

/** 仓库聚合结果：只有图表需要的计数，不携带任何消息实体。 */
export interface ActivityScanResult {
  /** 落在窗口内的消息条数（诊断用）。 */
  scannedMessages: number;
  /** 本地日 → 消息数。 */
  dailyCounts: Map<string, number>;
  /** 今日各本地小时 → 消息数，长度 24（与今日统计同一时间基准）。 */
  hourlyCounts: number[];
  todayCount: number;
  todaySessionCount: number;
  generation: ActivityGenerationStats;
}

const WEEK_LABELS = ["日", "一", "二", "三", "四", "五", "六"] as const;

/** 本地日键（YYYY-MM-DD）。工作日历、心相记录与活动分桶共用同一格式。 */
export function formatLocalDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 时间戳所在本地日的 00:00。 */
export function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** 距离下一个本地日 00:00 还有多少毫秒；跨夏令时由 Date 的日历运算自行归一。 */
export function msUntilNextLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  const nextDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0);
  return Math.max(0, nextDay.getTime() - timestamp);
}

/** 由同一个 `now` 推导聚合窗口，保证“今日”“近 7 天”“扫描下界”同源。 */
export function resolveActivityWindow(now: number, windowDays = ACTIVITY_WINDOW_DAYS): ActivityWindow {
  const days = Number.isFinite(windowDays) ? Math.max(1, Math.floor(windowDays)) : ACTIVITY_WINDOW_DAYS;
  const todayStart = startOfLocalDay(now);
  const start = new Date(todayStart);
  start.setDate(start.getDate() - (days - 1));
  return { windowStart: start.getTime(), todayStart, now, windowDays: days };
}

/**
 * 流式累加器：扫描过程中只保留计数与有限样本，内存占用与消息条数无关。
 *
 * 越界（窗口外、时间戳非法）的记录在 `push` 内直接丢弃，因此无索引降级路径
 * 即使整表扫描也不会污染结果。
 */
export function createActivityAccumulator(window: Pick<ActivityWindow, "windowStart" | "todayStart">): {
  push: (record: ActivityMessageRecord) => void;
  finish: () => ActivityScanResult;
} {
  const dailyCounts = new Map<string, number>();
  const hourlyCounts = new Array<number>(24).fill(0);
  const todaySessionIds = new Set<string>();
  const samples: ActivityGenerationSample[] = [];
  let scannedMessages = 0;
  let todayCount = 0;
  let totalTokens = 0;
  let totalSeconds = 0;
  let speedSum = 0;
  let speedCount = 0;

  return {
    push(record: ActivityMessageRecord): void {
      const timestamp = record.timestamp;
      // 非有限值或早于窗口的记录一律丢弃：窗口语义在累加器内有唯一定义。
      if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp < window.windowStart) return;

      scannedMessages += 1;
      const date = new Date(timestamp);
      const dayKey = formatLocalDayKey(timestamp);
      dailyCounts.set(dayKey, (dailyCounts.get(dayKey) ?? 0) + 1);

      if (timestamp >= window.todayStart) {
        // 小时分布只统计今天：昼夜时相盘描述的是「今日」的时段活跃，
        // 与今日数字、日历高亮共用同一个本地日边界。
        const hour = date.getHours();
        if (hour >= 0 && hour < 24) hourlyCounts[hour] += 1;
        todayCount += 1;
        if (record.sessionId) todaySessionIds.add(record.sessionId);
      }

      if (record.role !== "assistant") return;
      const tokens = typeof record.tokenCount === "number" && record.tokenCount > 0 ? record.tokenCount : 0;
      const seconds = typeof record.generationTime === "number" && record.generationTime > 0
        ? record.generationTime
        : 0;
      if (tokens === 0 && seconds === 0) return;

      const speed = tokens > 0 && seconds > 0 ? tokens / seconds : 0;
      totalTokens += tokens;
      totalSeconds += seconds;
      if (speed > 0) {
        speedSum += speed;
        speedCount += 1;
      }
      samples.push({ id: record.id, tokens, seconds, speed });
      if (samples.length > GENERATION_SAMPLE_LIMIT) samples.shift();
    },

    finish(): ActivityScanResult {
      return {
        scannedMessages,
        dailyCounts,
        hourlyCounts,
        todayCount,
        todaySessionCount: todaySessionIds.size,
        generation: {
          totalTokens,
          totalSeconds,
          averageSpeed: speedCount > 0 ? speedSum / speedCount : 0,
          samples,
        },
      };
    },
  };
}

/** 近 7 天（含今日）趋势序列，缺数据的日期补 0。 */
export function buildLast7Days(dailyCounts: ReadonlyMap<string, number>, now: number): ActivityDayMetric[] {
  const metrics: ActivityDayMetric[] = [];
  const todayStart = startOfLocalDay(now);
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(todayStart);
    date.setDate(date.getDate() - offset);
    const dateStr = formatLocalDayKey(date.getTime());
    metrics.push({
      dateStr,
      dayLabel: WEEK_LABELS[date.getDay()],
      count: dailyCounts.get(dateStr) ?? 0,
    });
  }
  return metrics;
}

/** 全窗口单日最大消息数，最小为 1，供热力/进度条归一化使用。 */
export function findMaxDailyCount(dailyCounts: ReadonlyMap<string, number>): number {
  let max = 1;
  for (const value of dailyCounts.values()) {
    if (value > max) max = value;
  }
  return max;
}

/** 空小时分布（长度 24），供未加载或降级状态复用一个稳定引用。 */
export function createEmptyHourlyCounts(): number[] {
  return new Array<number>(24).fill(0);
}
