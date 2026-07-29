/**
 * HTTP 层压测脚本（autocannon）
 *
 * 直接打 Mock LLM 上游服务器，测试 SSE 流式响应的并发吞吐与延迟。
 * 支持真实大小的请求体（角色卡 + 聊天历史），测出真实瓶颈。
 *
 * 前置条件：
 *   1. Mock LLM 服务器已启动：npx tsx tests/stress/mock-llm-server.ts
 *
 * 用法（PowerShell）：
 *   npm run test:stress:http                                     # 默认：5k token body, 10 连接, 30s
 *   $env:BODY_TOKENS=20000; npm run test:stress:http             # 20k token body（复杂卡）
 *   $env:BODY_TOKENS=50000; npm run test:stress:http             # 50k token body（超长历史）
 *   $env:CONNECTIONS=50; npm run test:stress:http                # 50 并发
 *   $env:DURATION=60; npm run test:stress:http                   # 60 秒
 *   $env:STREAM="false"; npm run test:stress:http                # 非流式 JSON
 *
 * 指标解读：
 *   - req/sec：每秒完成的请求数（SSE 流较长时偏低，正常）
 *   - latency p50/p97.5/p99：响应延迟分布（含完整 SSE 流传输时间）
 *   - throughput：吞吐量 MB/sec（反映 body 大小对带宽的压力）
 *   - errors / timeouts：应为 0，否则说明到达卡顿临界点
 */

// @ts-expect-error autocannon 缺少类型声明文件
import autocannon from "autocannon";

const TARGET_URL = process.env.TARGET_URL || "http://localhost:8080/v1/chat/completions";
const CONNECTIONS = parseInt(process.env.CONNECTIONS || "10", 10);
const DURATION = parseInt(process.env.DURATION || "30", 10);
const STREAM = process.env.STREAM !== "false"; // 默认 true
const BODY_TOKENS = parseInt(process.env.BODY_TOKENS || "5000", 10); // 请求体 token 数

// ─── 真实请求体生成 ───────────────────────────────────────────────────────────
// 模拟角色卡 + 聊天历史的 messages 数组
// 1 中文字 ≈ 1.5 token，1 英文单词 ≈ 1.3 token

function generateText(tokens: number, seed: string): string {
  const chars = Math.ceil(tokens / 1.5);
  const unit = `${seed}这是一段用于填充请求体大小的模拟文本内容，用于压测。`;
  const unitLen = unit.length;
  const repeat = Math.ceil(chars / unitLen);
  return unit.repeat(repeat).slice(0, chars);
}

function buildRequestBody(targetTokens: number, stream: boolean): string {
  const messages: Array<{ role: string; content: string }> = [];

  // 系统提示词（角色卡设定）— 占总量约 40%
  const systemTokens = Math.floor(targetTokens * 0.4);
  messages.push({
    role: "system",
    content: generateText(systemTokens, "[角色卡设定]"),
  });

  // 聊天历史 — 占总量约 55%，交替 user/assistant
  const historyTokens = Math.floor(targetTokens * 0.55);
  const perMessageTokens = 300; // 每条消息约 300 token
  const messageCount = Math.max(2, Math.floor(historyTokens / perMessageTokens));

  for (let i = 0; i < messageCount; i++) {
    const isUser = i % 2 === 0;
    messages.push({
      role: isUser ? "user" : "assistant",
      content: generateText(perMessageTokens, isUser ? `[用户消息${i}]` : `[AI回复${i}]`),
    });
  }

  // 最后一条用户消息 — 占总量约 5%
  const lastMsgTokens = Math.max(20, targetTokens - systemTokens - messageCount * perMessageTokens);
  messages.push({
    role: "user",
    content: generateText(Math.min(lastMsgTokens, 500), "[最新消息]"),
  });

  return JSON.stringify({
    model: "mock-model-stress",
    messages,
    stream,
    temperature: 0.8,
    max_tokens: 2000,
    top_p: 0.95,
  });
}

const requestBody = buildRequestBody(BODY_TOKENS, STREAM);
const bodySizeKB = (Buffer.byteLength(requestBody, "utf-8") / 1024).toFixed(1);

console.log("[Stress] HTTP 压测配置:");
console.log(`  目标:         ${TARGET_URL}`);
console.log(`  模式:         ${STREAM ? "SSE 流式" : "JSON 非流式"}`);
console.log(`  请求体大小:   ${BODY_TOKENS} token ≈ ${bodySizeKB} KB`);
console.log(`  连接数:       ${CONNECTIONS}`);
console.log(`  持续时间:     ${DURATION}s`);
console.log("");

const instance = autocannon({
  url: TARGET_URL,
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer sk-mock-stress-test",
  },
  body: requestBody,
  connections: CONNECTIONS,
  duration: DURATION,
  // SSE 流式响应时间较长，关闭 pipelining
  pipelining: 1,
  // 超时设置为 duration + 10s 缓冲
  timeout: (DURATION + 10) * 1000,
  // 流式响应不应检查 body 完整性
  expectBody: false,
}, (err: unknown, result: {
  requests: { total: number; average: number };
  throughput: { total: number; average: number };
  errors: number;
  timeouts: number;
  non2xx: number;
  latency: { p2_5?: number; p50?: number; p97_5?: number; p99?: number; average?: number; max?: number; maximum?: number };
}) => {
  if (err) {
    console.error("[Stress] 压测失败:", err);
    process.exit(1);
  }

  console.log("\n========================================");
  console.log("压测结果摘要");
  console.log("========================================");
  console.log(`请求体大小:    ${BODY_TOKENS} token ≈ ${bodySizeKB} KB`);
  console.log(`总请求数:      ${result.requests.total}`);
  console.log(`总字节数:      ${(result.throughput.total / 1024 / 1024).toFixed(2)} MB`);
  console.log(`错误数:        ${result.errors}`);
  console.log(`超时数:        ${result.timeouts}`);
  console.log(`非 2xx 响应:   ${result.non2xx}`);
  console.log("");
  console.log("吞吐量:");
  console.log(`  req/sec:     ${result.requests.average.toFixed(2)}`);
  console.log(`  MB/sec:      ${(result.throughput.average / 1024 / 1024).toFixed(2)}`);
  console.log("");
  console.log("延迟分布 (含完整 SSE 流传输时间):");
  // autocannon 提供的百分位：p2_5, p50, p97_5, p99
  const lat = result.latency;
  const fmt = (v: number | undefined): string => v != null ? v.toFixed(0) + " ms" : "N/A";
  console.log(`  p2.5:  ${fmt(lat.p2_5)}`);
  console.log(`  p50:   ${fmt(lat.p50)}`);
  console.log(`  p97.5: ${fmt(lat.p97_5)}`);
  console.log(`  p99:   ${fmt(lat.p99)}`);
  console.log(`  avg:   ${fmt(lat.average)}`);
  console.log(`  max:   ${fmt(lat.max ?? lat.maximum)}`);
  console.log("");

  // 断言：无错误、无超时
  const hasErrors = result.errors > 0 || result.timeouts > 0;
  if (hasErrors) {
    console.error(`[Stress] ❌ 存在 ${result.errors} 错误 + ${result.timeouts} 超时，已到达卡顿临界点`);
    console.error(`[Stress]    建议：降低并发数或检查 body 大小 (${bodySizeKB} KB) 是否过大`);
    process.exit(1);
  } else {
    console.log("[Stress] ✅ 无错误与超时");
  }
});

// 实时进度输出
autocannon.track(instance, { renderProgressBar: true });
