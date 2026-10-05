/**
 * 性能预算套件（P1-⑤）
 *
 * 目的：把「首字节延迟 / 切会话（500 条消息）/ 记忆召回 P95 / 20MB 导入耗时」
 * 从手动 `tests/stress/*` 变成 CI 可复现的回归警报，不再依赖人工跑压测。
 *
 * 定位（务必按此理解阈值）：
 *   - 这些数字是**回归警报**，不是 SLA 承诺。运行时环境（CI 容器 / 本地 Win11）
 *     差异很大，因此阈值取实测基线的 3~5 倍，只用来抓「数量级退化」。
 *   - 每次执行都会把实测值打印出来，便于人工比对历史基线。
 *   - 冷启动 / Tab 冷热切 / resize / 长会话堆增长等 UI 预算已在
 *     `tests/e2e/ui-performance.spec.ts` 与 `stress-long-session.spec.ts` 覆盖，
 *     本套件不重复实现，只补这四项纯数据路径的预算。
 *
 * 覆盖：
 *   - measureSessionSwitch500Messages：会话激活读取（元数据 + 500 条消息）中位数
 *   - measureBulkWrite20Mb：replaceCompleteSessions 写入 ≈20MB 负载耗时
 *   - measureRecallP95：MemoryRecall 冷路径（每次失效会话元缓存）P95
 *   - measureTimeToFirstChunk：SSE 上游首个 chunk 到达时间中位数
 *
 * 遵循 AGENTS.md `TEST-CONTROLLED`：使用仓库内 fake-indexeddb 与内联 http 服务，
 * 不依赖外部 CDN / 代理 / 固定端口。
 */

import "fake-indexeddb/auto";
import http from "node:http";
import { assert } from "./testUtils";
import { DB_NAME } from "../../src/infrastructure/storage/dbSchema";
import { __resetDBInstanceForTesting } from "../../src/utils/localDB";
import {
  replaceCompleteSessions,
} from "../../src/infrastructure/storage/repositories/sessionsWriteRepository";
import { getSessionById } from "../../src/infrastructure/storage/indexedDbSessionQueries";
import { getMessagesBySession } from "../../src/infrastructure/storage/indexedDbMemoryStore";
import type { ChatSession, Message } from "../../src/types";
import type { MemoryStorage } from "../../src/application/services/memory/MemoryStorage";

/**
 * 预算阈值（毫秒）。取实测基线的 3~5 倍，只抓数量级退化。
 * 修改这些数字时必须附实测证据，禁止为了过 CI 而放宽。
 */
export const PERFORMANCE_BUDGETS = {
  /** 切会话：读取 1 条会话元数据 + 500 条消息（中位数）。实测基线 ≈600ms */
  sessionSwitch500MessagesMs: 3000,
  /** 批量导入：replaceCompleteSessions 写入 ≈20MB 负载。实测基线 ≈9s（fake-indexeddb） */
  bulkWrite20MbMs: 45000,
  /** 记忆召回：5000 候选消息 + 2000 片段，冷路径 P95。实测基线 ≈2ms */
  recallP95Ms: 50,
  /** SSE 上游首字节到达（中位数，含本地 http 往返开销）。实测基线 ≈60~100ms */
  timeToFirstChunkMs: 1000,
} as const;

/** 统计辅助：中位数（不修改入参） */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** 统计辅助：P95（最近秩次法，小样本下偏保守） */
function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

/** 清空测试库，保证各测量互不污染（连接、写队列、DB 数据一起重置） */
async function resetPerfDatabase(): Promise<void> {
  __resetDBInstanceForTesting();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/** 构造一条消息（turnIndex 由存储层原子分配，测试不预置） */
function buildMessage(id: string, index: number, text: string): Message {
  return {
    id,
    sender: index % 2 === 0 ? "user" : "assistant",
    content: text,
    timestamp: 1_700_000_000_000 + index,
  };
}

function buildSession(id: string, characterId: string, messages: Message[]): ChatSession {
  return {
    id,
    characterId,
    title: `性能预算 ${id}`,
    createdAt: Date.now(),
    summaries: [],
    messages,
  };
}

/** 测量 1：切会话 = 读会话元数据 + 500 条消息（取 5 次中位数） */
async function measureSessionSwitch500Messages(): Promise<number> {
  const sessionId = "perf_session_switch";
  const messages = Array.from({ length: 500 }, (_, index) =>
    buildMessage(`${sessionId}_msg_${index}`, index, `第 ${index} 条消息正文，用于测量会话激活读取耗时。`),
  );
  await replaceCompleteSessions([buildSession(sessionId, "perf_character_switch", messages)]);

  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    const [loaded, records] = await Promise.all([
      getSessionById(sessionId),
      getMessagesBySession(sessionId),
    ]);
    samples.push(performance.now() - start);
    assert(loaded?.id === sessionId, "会话元数据应可读回");
    assert(records.length === 500, `应读回 500 条消息，实际 ${records.length}`);
  }
  return median(samples);
}

/** 测量 2：批量导入 ≈20MB（500 会话 × 100 条 × 400 字节 ASCII 正文） */
async function measureBulkWrite20Mb(): Promise<number> {
  const chunk = "bulk-import-payload-".repeat(20); // 400 字节 ASCII
  const sessions = Array.from({ length: 500 }, (_, sessionIndex) => {
    const sessionId = `perf_bulk_${sessionIndex}`;
    const messages = Array.from({ length: 100 }, (_, messageIndex) =>
      buildMessage(
        `${sessionId}_msg_${messageIndex}`,
        messageIndex,
        chunk,
      ),
    );
    return buildSession(sessionId, `perf_character_${sessionIndex % 20}`, messages);
  });

  const payloadMb = (sessions.length * 100 * chunk.length) / (1024 * 1024);
  const start = performance.now();
  await replaceCompleteSessions(sessions);
  const elapsed = performance.now() - start;
  console.log(`    [perf] 批量写入负载 ≈ ${payloadMb.toFixed(1)} MB，吞吐 ≈ ${(payloadMb / (elapsed / 1000)).toFixed(1)} MB/s`);
  return elapsed;
}

/** 构造召回测量用的大规模 mock storage（不落 IDB，测量算法本身的成本） */
function createRecallStorage(messageCount: number, fragmentCount: number, dictSize: number) {
  const messages = new Map<string, Record<string, unknown>>();
  const fragments = new Map<string, Record<string, unknown>>();
  const dict: Array<Record<string, unknown>> = [];
  const sessionId = "perf_recall_session";
  const hotTags = ["老张", "梅子酒"];

  for (let i = 0; i < messageCount; i++) {
    messages.set(`perf_msg_${i}`, {
      id: `perf_msg_${i}`,
      sessionId,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `候选消息 ${i}`,
      createdAt: 1_700_000_000_000 + i,
      turnIndex: i,
      tags: i % 3 === 0 ? [...hotTags] : [`散标签_${i}`],
      extractSource: "llm",
    });
  }
  for (let i = 0; i < fragmentCount; i++) {
    fragments.set(`perf_frag_${i}`, {
      id: `perf_frag_${i}`,
      sessionId,
      content: `历史片段 ${i} 的摘要正文`,
      participants: ["老张"],
      tags: i % 4 === 0 ? [...hotTags] : [`散标签_${i}`],
      sourceMessageIds: [`perf_msg_${i}`],
      sourceRole: "assistant",
      sourceTurnStart: i,
      sourceTurnEnd: i,
      status: "active",
      importance: 0.7,
      confidence: 0.8,
      createdAt: 1_700_000_000_000 + i,
      updatedAt: 1_700_000_000_000 + i,
    });
  }
  for (let i = 0; i < dictSize; i++) {
    dict.push({
      sessionId,
      entity: `实体_${i}`,
      type: "character",
      aliases: [],
      firstSeenMsgId: `perf_msg_${i}`,
      firstSeenTurn: i,
    });
  }
  dict[dict.length - 1] = {
    sessionId,
    entity: "老张",
    type: "character",
    aliases: ["梅子酒"],
    firstSeenMsgId: "perf_msg_0",
    firstSeenTurn: 0,
  };
  dict[dict.length - 2] = {
    sessionId,
    entity: "梅子酒",
    type: "item",
    aliases: [],
    firstSeenMsgId: "perf_msg_0",
    firstSeenTurn: 0,
  };

  return {
    sessionId,
    async getDictBySession(requested: string) {
      return requested === sessionId ? dict : [];
    },
    async getMessagesBySession(
      requested: string,
      options?: { limit?: number; descending?: boolean },
    ) {
      if (requested !== sessionId) return [];
      const sorted = Array.from(messages.values()).sort(
        (a, b) => (a.createdAt as number) - (b.createdAt as number),
      );
      const ordered = options?.descending ? sorted.reverse() : sorted;
      return options?.limit === undefined ? ordered : ordered.slice(0, options.limit);
    },
    async getMessagesByTag(requested: string, tags: string[], limit?: number) {
      if (requested !== sessionId) return [];
      const wanted = new Set(tags);
      let result = Array.from(messages.values()).filter((message) => {
        const messageTags = message.tags as string[] | undefined;
        return Boolean(messageTags?.some((tag) => wanted.has(tag)));
      });
      result = result.sort((a, b) => (b.createdAt as number) - (a.createdAt as number));
      return limit === undefined ? result : result.slice(0, limit);
    },
    async getFragmentsByTags(requested: string, tags: string[], limit?: number) {
      if (requested !== sessionId) return [];
      const wanted = new Set(tags);
      const result = Array.from(fragments.values()).filter((fragment) => {
        const fragmentTags = fragment.tags as string[] | undefined;
        return fragment.status === "active" && Boolean(fragmentTags?.some((tag) => wanted.has(tag)));
      });
      return limit === undefined ? result : result.slice(0, limit);
    },
    async getTemporalFactsByEntities() {
      return [];
    },
    async getMessageById(id: string) {
      return messages.get(id) ?? null;
    },
    async getFragmentById(id: string) {
      return fragments.get(id) ?? null;
    },
  };
}

/** 测量 3：记忆召回冷路径 P95（5000 候选消息 + 2000 片段，20 次采样） */
async function measureRecallP95(): Promise<number> {
  const { MemoryRecall } = await import("../../src/application/services/memory/MemoryRecall");
  const storage = createRecallStorage(5000, 2000, 200);
  const recall = new MemoryRecall(storage as unknown as MemoryStorage);

  const samples: number[] = [];
  for (let i = 0; i < 20; i++) {
    recall.invalidateCache();
    const start = performance.now();
    const result = await recall.recall(storage.sessionId, "老张把梅子酒拿出来了", {
      topK: 5,
      excludeRecentN: 5,
      currentTurnIndex: 10_000,
    });
    samples.push(performance.now() - start);
    assert(result.length > 0, "召回应命中词典标签对应候选");
  }
  return percentile95(samples);
}

/** 启动内联 SSE 上游（10 块 / 5ms 间隔），返回端口与关闭函数 */
async function startInlineSseServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }
    req.resume();
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    let index = 0;
    const timer = setInterval(() => {
      if (index >= 10) {
        clearInterval(timer);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      index += 1;
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `块${index}` } }] })}\n\n`);
    }, 5);
    // 注意：必须挂 res 的 close，不能挂 req。
    // Node 在请求体读完就会触发 req 的 'close'，若挂在那里会立刻清掉定时器，
    // 导致响应头永远不写出（undici 表现为 HeadersTimeoutError）。
    res.on("close", () => clearInterval(timer));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("无法获取内联 SSE 服务端口");
  }
  return {
    port: address.port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** 测量 4：SSE 首字节到达时间（5 次取中位数） */
async function measureTimeToFirstChunk(): Promise<number> {
  const { port, close } = await startInlineSseServer();
  const samples: number[] = [];
  try {
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stream: true, messages: [{ role: "user", content: "ping" }] }),
      });
      const reader = response.body?.getReader();
      if (!reader) throw new Error("SSE 响应缺少可读流");
      const first = await reader.read();
      samples.push(performance.now() - start);
      assert(first.done !== true && first.value.length > 0, "首块应有内容");
      // 读满剩余分块，避免中途 cancel 污染 keep-alive 连接池。
      let done = first.done === true;
      while (!done) {
        const next = await reader.read();
        done = next.done === true;
      }
    }
  } finally {
    await close();
  }
  return median(samples);
}

export async function testPerformanceBudgets() {
  console.log("\n--- Running Performance Budgets Verification ---");
  await resetPerfDatabase();

  const sessionSwitchMs = await measureSessionSwitch500Messages();
  console.log(`    [perf] 切会话（元数据 + 500 条消息）中位数 = ${sessionSwitchMs.toFixed(1)} ms`);
  assert(
    sessionSwitchMs < PERFORMANCE_BUDGETS.sessionSwitch500MessagesMs,
    `切会话读取 500 条消息超预算：${sessionSwitchMs.toFixed(1)} ms ≥ ${PERFORMANCE_BUDGETS.sessionSwitch500MessagesMs} ms`,
  );

  await resetPerfDatabase();
  const bulkWriteMs = await measureBulkWrite20Mb();
  console.log(`    [perf] 20MB 批量导入耗时 = ${bulkWriteMs.toFixed(1)} ms`);
  assert(
    bulkWriteMs < PERFORMANCE_BUDGETS.bulkWrite20MbMs,
    `20MB 批量导入超预算：${bulkWriteMs.toFixed(1)} ms ≥ ${PERFORMANCE_BUDGETS.bulkWrite20MbMs} ms`,
  );

  const recallMs = await measureRecallP95();
  console.log(`    [perf] 记忆召回 P95 = ${recallMs.toFixed(1)} ms`);
  assert(
    recallMs < PERFORMANCE_BUDGETS.recallP95Ms,
    `记忆召回 P95 超预算：${recallMs.toFixed(1)} ms ≥ ${PERFORMANCE_BUDGETS.recallP95Ms} ms`,
  );

  const ttftMs = await measureTimeToFirstChunk();
  console.log(`    [perf] SSE 首字节中位数 = ${ttftMs.toFixed(1)} ms`);
  assert(
    ttftMs < PERFORMANCE_BUDGETS.timeToFirstChunkMs,
    `SSE 首字节超预算：${ttftMs.toFixed(1)} ms ≥ ${PERFORMANCE_BUDGETS.timeToFirstChunkMs} ms`,
  );

  await resetPerfDatabase();
  console.log("✔ Performance budgets verified successfully!");
}
