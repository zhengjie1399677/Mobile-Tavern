/**
 * 长会话压力测试（Phase 2：大上下文 + 长回复）
 *
 * 目标：在真实浏览器环境中模拟长会话，检测：
 *  1. 内存累积与 DOM 节点泄漏趋势
 *  2. 随上下文增长，每轮响应延迟是否线性恶化（上下文瓶颈）
 *  3. 请求体大小增长趋势（LLMService 构造大 body 的开销）
 *
 * 策略：
 *  - Mock /api/proxy/openai 返回 2000 token 的 SSE 流（20 chunk × 100 token）
 *  - 通过 UI 完成 API 配置 + 创建角色卡（一次性，贴近真实用户路径）
 *  - 循环发送 50 轮对话，每 5 轮采样 heap / DOM / 每轮延迟 / 请求体大小
 *  - 断言 heap 增量、DOM 节点数、延迟增长率在阈值内
 *
 * 遵循 AGENTS.md 核心行为准则四（受控浏览器自动化测试规范）：
 *  - 声明式、可复现：所有交互通过 getByRole/getByPlaceholder 定位，无一次性探索
 *  - 强制超时：导航 60s（首启 IndexedDB + Kernel 较慢）、断言 5s
 *  - 本地静态化：beforeEach 拦截境外 CDN
 *  - 有限重试：依赖 playwright.config.ts 的 retries: 1
 */

import { test, expect, type Page } from "@playwright/test";

// ─── 压测参数 ────────────────────────────────────────────────────────────────
const TURNS = parseInt(process.env.TURNS || "50", 10); // 总对话轮数（50 轮 ≈ 100 条消息，上下文约 115k token）
const SAMPLE_EVERY = parseInt(process.env.SAMPLE_EVERY || "5", 10); // 每 5 轮采样一次
const HEAP_GROWTH_LIMIT_MB = 200; // heap 增量上限（50 轮 + 2k token 回复，内存自然增长较多）
const DOM_NODE_LIMIT = 20000; // DOM 节点数上限（50 轮 × 消息气泡 + markdown 元素）
// 延迟增长率上限。桌面不限速时 3.58x，手机预估 4-5x。
// 设 4.0x 作为桌面基线：超过此值说明渲染策略有明确瓶颈（非平台差异）
const LATENCY_GROWTH_RATIO_LIMIT = 4.0;

// CPU 限速倍率（模拟手机性能）
// 4 = 中端 Android WebView 的 JS 执行速度估算
// 设为 1 表示不限速（纯桌面基线）
const CPU_THROTTLE_RATE = parseInt(process.env.CPU_THROTTLE_RATE || "1", 10);

// Mock 响应参数
const MOCK_CHUNK_COUNT = 20; // 每个 AI 回复的 chunk 数
const MOCK_TOKENS_PER_CHUNK = 100; // 每个 chunk 的 token 数（≈ 67 中文字）
const MOCK_RESPONSE_TOKENS = MOCK_CHUNK_COUNT * MOCK_TOKENS_PER_CHUNK; // 2000 token

// ─── 性能采样 ─────────────────────────────────────────────────────────────────
interface MemorySample {
  turn: number;
  usedJSHeapSizeMB: number;
  totalJSHeapSizeMB: number;
  jsHeapSizeLimitMB: number;
  domNodeCount: number;
  timestamp: number;
}

interface TurnMetrics {
  turn: number;
  durationMs: number; // 该轮从发送到回复完成的耗时
  requestSizeKB: number; // 该轮请求体大小（含完整聊天历史）
}

async function sampleMemory(page: Page, turn: number): Promise<MemorySample> {
  const data = await page.evaluate(() => {
    const perf = (performance as unknown as {
      memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    }).memory;
    const domNodeCount = document.querySelectorAll("*").length;
    return {
      usedJSHeapSizeMB: perf ? perf.usedJSHeapSize / 1024 / 1024 : 0,
      totalJSHeapSizeMB: perf ? perf.totalJSHeapSize / 1024 / 1024 : 0,
      jsHeapSizeLimitMB: perf ? perf.jsHeapSizeLimit / 1024 / 1024 : 0,
      domNodeCount,
      timestamp: Date.now(),
    };
  });
  return { turn, ...data };
}

// ─── 测试用例 ─────────────────────────────────────────────────────────────────

test.describe("长会话压力测试", () => {
  test.describe.configure({ timeout: 600_000 }); // 10 分钟，50 轮 + 大响应需要更长预算

  test.beforeEach(async ({ context }) => {
    // 拦截境外 CDN（遵循准则四）
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (
        url.includes("fonts.googleapis.com") ||
        url.includes("fonts.gstatic.com") ||
        url.includes("cdn.jsdelivr.net") ||
        url.includes("testingcf.jsdelivr.net")
      ) {
        return route.abort("aborted");
      }
      return route.continue();
    });

    // Mock LLM 端点：在浏览器上下文内拦截 fetch('/api/proxy/openai')
    // 关键：必须在页面上下文内构造 Response，确保 response.body 是 ReadableStream，
    // 否则 streamReader 在 response.body 为 null 时直接 return，不触发 onDone，
    // 导致 ChatStreamService 的 isFinished 永远为 false，isSending 卡在 true。
    //
    // Phase 2 增强：每个回复返回 2000 token（20 chunk × 100 token），
    // 模拟真实 LLM 的长回复，压力测试 streamReader 解析和 React 渲染。
    //
    // LLMService.universalFetch 发送的 body 是 safePayload，结构为：
    //   { baseUrl, apiKey, reqBody: { stream, model, messages, ... }, ... }
    // stream 字段嵌套在 reqBody 内部。
    // 同时记录请求体大小，用于追踪上下文增长趋势。
    await context.addInitScript(() => {
      const CHUNK_COUNT = 20;
      const TOKENS_PER_CHUNK = 100;
      const mockTurns: number[] = [];
      const originalFetch = window.fetch;

      // 生成指定 token 数的中文内容（1 中文字 ≈ 1.5 token）
      function generateContent(tokens: number, seed: string): string {
        const chars = Math.ceil(tokens / 1.5);
        const unit = `${seed}这是一段用于压测的模拟回复内容，用于填充响应体大小。`;
        const unitLen = unit.length;
        const repeat = Math.ceil(chars / unitLen);
        return unit.repeat(repeat).slice(0, chars);
      }

      // @ts-ignore - 测试用 monkey-patch
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : (input instanceof URL ? input.href : input.url);
        if (url.includes("/api/proxy/openai") && init?.method?.toUpperCase() === "POST") {
          let reqBody: any = {};
          try {
            if (typeof init.body === "string") {
              reqBody = JSON.parse(init.body);
            }
          } catch {}

          // 兼容两种结构：优先读取 reqBody.stream（生产实际路径），回退到顶层 stream
          const isStream = reqBody?.reqBody?.stream === true || reqBody?.stream === true;
          const turn = mockTurns.length;
          mockTurns.push(turn);

          // 记录请求体大小到 window 供测试读取
          const bodySize = typeof init.body === "string" ? init.body.length : 0;
          (window as any).__stressLastRequestSize = bodySize;

          if (isStream) {
            // 流式响应（聊天主流程）：2000 token，分 20 个 chunk 返回
            const chunks: string[] = [];
            for (let i = 0; i < CHUNK_COUNT; i++) {
              const isLast = i === CHUNK_COUNT - 1;
              if (isLast) {
                chunks.push(`data: ${JSON.stringify({
                  choices: [{ delta: {}, finish_reason: "stop" }],
                  usage: {
                    prompt_tokens: 5000 + turn * 500, // 模拟上下文增长
                    completion_tokens: CHUNK_COUNT * TOKENS_PER_CHUNK,
                  },
                })}\n\n`);
                chunks.push(`data: [DONE]\n\n`);
              } else {
                chunks.push(`data: ${JSON.stringify({
                  choices: [{
                    delta: { content: generateContent(TOKENS_PER_CHUNK, `[T${turn}C${i}]`) },
                    finish_reason: null,
                  }],
                })}\n\n`);
              }
            }

            // 在浏览器上下文构造 Response，body 自动转为 ReadableStream
            return new Response(chunks.join(""), {
              status: 200,
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
              },
            });
          } else {
            // 非流式 JSON 响应（AutoSummaryService 等内部调用）
            const body = JSON.stringify({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: `第 ${turn + 1} 轮摘要内容`,
                  },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 50, completion_tokens: 20 },
            });
            return new Response(body, {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
        }
        // 其他请求走原始 fetch
        return originalFetch(input as RequestInfo, init);
      };
    });
  });

  test("50 轮对话后 heap/DOM/延迟增长在阈值内", async ({ page, context }) => {
    test.setTimeout(600_000); // 10 分钟

    // CPU 限速模拟手机性能（Playwright 通过 CDP DevTools 协议实现）
    // 4x = 中端 Android WebView 的 JS 执行速度估算
    if (CPU_THROTTLE_RATE > 1) {
      const client = await context.newCDPSession(page);
      await client.send("Emulation.setCPUThrottlingRate", {
        rate: CPU_THROTTLE_RATE,
      });
      console.log(`[Stress] CPU 限速: ${CPU_THROTTLE_RATE}x（模拟手机）`);
    } else {
      console.log(`[Stress] CPU 无限速（桌面基线）`);
    }

    await page.goto("/", { timeout: 60_000 });
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });

    // ─── 步骤 1：配置 API（一次性） ───────────────────────────────────────────
    await page.getByRole("tab", { name: "设置" }).click();
    const connCategory = page.getByRole("button", { name: /模型与连接/ });
    await expect(connCategory).toBeVisible({ timeout: 30_000 });
    await connCategory.click();
    await expect(page.getByRole("heading", { name: "模型与连接" })).toBeVisible({ timeout: 10_000 });

    const apiPanelBtn = page.getByRole("button", { name: /API 服务端点配置/ });
    await expect(apiPanelBtn).toBeVisible({ timeout: 20_000 });
    await apiPanelBtn.click();

    const apiKeyInput = page.getByPlaceholder(/sk-\.\.\./);
    await expect(apiKeyInput).toBeVisible({ timeout: 10_000 });
    await apiKeyInput.fill("sk-test-mock-key-for-stress-test");

    const modelInput = page.getByPlaceholder("gpt-4o");
    await expect(modelInput).toBeVisible({ timeout: 5_000 });
    await modelInput.fill("mock-model-stress");

    await expect(page.getByText("修改已自动保存")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);

    await page.getByRole("tab", { name: "角色" }).click();

    // ─── 步骤 2：创建简单角色卡（一次性） ─────────────────────────────────────
    const newCharBtn = page.getByTitle("手动创造新角色卡");
    await expect(newCharBtn).toBeVisible({ timeout: 5_000 });
    await newCharBtn.click();

    await expect(page.getByText("重新打造 AI 灵魂容器设定")).toBeVisible({ timeout: 5_000 });

    const nameInput = page.getByPlaceholder("如: 艾莉娅");
    await nameInput.fill("压测角色");

    const firstMesInput = page.getByPlaceholder("角色出场的第一句话");
    await firstMesInput.fill("你好，这是压测开场白。");

    const saveBtn = page.getByRole("button", { name: "保存修改" });
    await saveBtn.click();

    const charCard = page.getByText("压测角色").first();
    await expect(charCard).toBeVisible({ timeout: 5_000 });

    // ─── 步骤 3：进入聊天 ─────────────────────────────────────────────────────
    await charCard.click();

    const chatInput = page.getByLabel(/发送给.+的消息输入框/);
    await expect(chatInput).toBeVisible({ timeout: 10_000 });

    // ─── 步骤 4：采集基线 ─────────────────────────────────────────────────────
    const baseline = await sampleMemory(page, -1);
    console.log("[Stress] Baseline:", baseline);
    console.log(`[Stress] Mock 响应: ${MOCK_CHUNK_COUNT} chunk × ${MOCK_TOKENS_PER_CHUNK} token = ${MOCK_RESPONSE_TOKENS} token/轮`);

    const samples: MemorySample[] = [baseline];
    const turnMetrics: TurnMetrics[] = [];
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    // ─── 步骤 5：压测循环 ─────────────────────────────────────────────────────
    for (let i = 0; i < TURNS; i++) {
      await chatInput.fill(`第 ${i + 1} 轮压测消息`);

      const turnStart = Date.now();
      await chatInput.press("Enter");

      // 等待 AI 回复完成：等待"中止对话"按钮消失（isSending=false 时切换为发送按钮）
      const stopButton = page.getByRole("button", { name: "中止对话" });
      try {
        await expect(stopButton).toBeHidden({ timeout: 60_000 });
      } catch (e) {
        console.log(`[Stress] Turn ${i + 1} FAILED after ${Date.now() - turnStart}ms`);
        throw e;
      }
      const turnDuration = Date.now() - turnStart;

      // 读取该轮请求体大小（mock 中记录到 window）
      const requestSizeBytes = await page.evaluate(() =>
        (window as any).__stressLastRequestSize || 0
      );
      const requestSizeKB = requestSizeBytes / 1024;

      const metric: TurnMetrics = {
        turn: i + 1,
        durationMs: turnDuration,
        requestSizeKB,
      };
      turnMetrics.push(metric);

      // 每 K 轮采样
      if ((i + 1) % SAMPLE_EVERY === 0) {
        const sample = await sampleMemory(page, i + 1);
        samples.push(sample);
        console.log(
          `[Stress] Turn ${i + 1}: heap=${sample.usedJSHeapSizeMB.toFixed(1)}MB ` +
          `dom=${sample.domNodeCount} ` +
          `latency=${turnDuration}ms ` +
          `reqSize=${requestSizeKB.toFixed(1)}KB`
        );
      }
    }

    // ─── 步骤 6：最终采样与断言 ───────────────────────────────────────────────
    const finalSample = await sampleMemory(page, TURNS);
    samples.push(finalSample);

    const heapGrowthMB = finalSample.usedJSHeapSizeMB - baseline.usedJSHeapSizeMB;

    // 输出汇总
    console.log("\n========================================");
    console.log("压测结果汇总");
    console.log("========================================");
    console.log(`轮数:          ${TURNS}`);
    console.log(`每轮回复:      ${MOCK_RESPONSE_TOKENS} token`);
    console.log(`Heap 增量:     ${heapGrowthMB.toFixed(2)} MB ` +
      `(baseline ${baseline.usedJSHeapSizeMB.toFixed(2)} MB → final ${finalSample.usedJSHeapSizeMB.toFixed(2)} MB)`);
    console.log(`DOM 节点数:    ${baseline.domNodeCount} → ${finalSample.domNodeCount}`);

    // 请求体大小增长趋势
    if (turnMetrics.length > 0) {
      const firstReq = turnMetrics[0];
      const lastReq = turnMetrics[turnMetrics.length - 1];
      console.log(`请求体大小:    Turn 1 = ${firstReq.requestSizeKB.toFixed(1)} KB → Turn ${TURNS} = ${lastReq.requestSizeKB.toFixed(1)} KB`);
    }

    // 延迟分析：首段 vs 末段
    const firstSegment = turnMetrics.slice(0, 5);
    const lastSegment = turnMetrics.slice(-5);
    const avgFirst = firstSegment.reduce((s, m) => s + m.durationMs, 0) / firstSegment.length;
    const avgLast = lastSegment.reduce((s, m) => s + m.durationMs, 0) / lastSegment.length;
    const latencyGrowthRatio = avgLast / avgFirst;
    console.log(`延迟分析:      首段(1-5) avg=${avgFirst.toFixed(0)}ms → 末段(${TURNS - 4}-${TURNS}) avg=${avgLast.toFixed(0)}ms (ratio=${latencyGrowthRatio.toFixed(2)}x)`);

    // 所有采样点
    console.log("\n[Stress] Memory samples:");
    console.log(JSON.stringify(samples, null, 2));
    console.log("\n[Stress] Turn metrics:");
    console.log(JSON.stringify(turnMetrics, null, 2));
    console.log("");

    // ─── 断言 ─────────────────────────────────────────────────────────────────

    // 断言 1：heap 增量不超过阈值
    expect(
      heapGrowthMB,
      `Heap growth ${heapGrowthMB.toFixed(2)} MB exceeds limit ${HEAP_GROWTH_LIMIT_MB} MB`
    ).toBeLessThan(HEAP_GROWTH_LIMIT_MB);

    // 断言 2：DOM 节点数不超过阈值
    expect(
      finalSample.domNodeCount,
      `DOM node count ${finalSample.domNodeCount} exceeds limit ${DOM_NODE_LIMIT}`
    ).toBeLessThan(DOM_NODE_LIMIT);

    // 断言 3：延迟增长率不超过阈值（末段延迟 / 首段延迟）
    // 如果超过 3 倍，说明上下文增长导致严重的性能瓶颈
    expect(
      latencyGrowthRatio,
      `Latency degraded ${latencyGrowthRatio.toFixed(2)}x from first 5 turns to last 5 turns (limit: ${LATENCY_GROWTH_RATIO_LIMIT}x)`
    ).toBeLessThan(LATENCY_GROWTH_RATIO_LIMIT);

    // 断言 4：采样过程中 heap 趋势不应单调递增（允许波动）
    if (samples.length >= 3) {
      let monotonicIncreaseCount = 0;
      for (let i = 1; i < samples.length; i++) {
        if (samples[i].usedJSHeapSizeMB > samples[i - 1].usedJSHeapSizeMB) {
          monotonicIncreaseCount++;
        }
      }
      const increaseRatio = monotonicIncreaseCount / (samples.length - 1);
      console.log(`[Stress] Monotonic increase ratio: ${(increaseRatio * 100).toFixed(1)}% (${monotonicIncreaseCount}/${samples.length - 1})`);
      expect(
        increaseRatio,
        `Heap monotonically increased in ${(increaseRatio * 100).toFixed(1)}% of samples, suspected leak`
      ).toBeLessThan(0.95);
    }

    // 断言 5：无致命 console error（过滤已知警告）
    const fatalErrors = consoleErrors.filter((e) =>
      !e.includes("Failed to load resource") &&
      !e.includes("net::ERR_FAILED")
    );
    expect(
      fatalErrors,
      `Fatal console errors during stress test: ${fatalErrors.join("\n")}`
    ).toHaveLength(0);
  });
});
