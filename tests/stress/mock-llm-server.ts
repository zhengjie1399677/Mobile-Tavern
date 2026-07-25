/**
 * Mock LLM 上游服务器
 *
 * 模拟 OpenAI 兼容的 LLM API，用于 HTTP 层压测。
 * 不消耗真实 token，可随意并发。
 *
 * 端点：
 *   POST /v1/chat/completions
 *     - stream=true  → 返回 SSE 流（模拟聊天主流程）
 *     - stream=false → 返回 JSON（模拟 AutoSummary 等内部调用）
 *
 * 可通过环境变量配置：
 *   - MOCK_LLM_PORT（默认 8080）
 *   - MOCK_LLM_CHUNK_DELAY_MS（默认 20ms，每个 chunk 间隔）
 *   - MOCK_LLM_CHUNK_COUNT（默认 10，每个回复的 chunk 数）
 *   - MOCK_LLM_TOKENS_PER_CHUNK（默认 15，每个 chunk 的 token 数，决定响应大小）
 */

import http from "node:http";

const PORT = parseInt(process.env.MOCK_LLM_PORT || "8080", 10);
const CHUNK_DELAY_MS = parseInt(process.env.MOCK_LLM_CHUNK_DELAY_MS || "20", 10);
const CHUNK_COUNT = parseInt(process.env.MOCK_LLM_CHUNK_COUNT || "10", 10);
const TOKENS_PER_CHUNK = parseInt(process.env.MOCK_LLM_TOKENS_PER_CHUNK || "15", 10);

interface ChatRequest {
  stream?: boolean;
  model?: string;
  messages?: Array<{ role: string; content: string }>;
}

// 生成指定 token 数的中文内容（粗略：1 中文字 ≈ 1.5 token）
function generateContent(tokens: number): string {
  const chars = Math.ceil(tokens / 1.5);
  const unit = "这是一段用于压测的模拟回复内容，用于填充响应体大小。";
  const unitLen = unit.length;
  const repeat = Math.ceil(chars / unitLen);
  return unit.repeat(repeat).slice(0, chars);
}

function buildSSEChunk(turn: number, isLast: boolean): string {
  if (isLast) {
    return (
      `data: ${JSON.stringify({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 5000, completion_tokens: CHUNK_COUNT * TOKENS_PER_CHUNK },
      })}\n\n` + `data: [DONE]\n\n`
    );
  }
  return `data: ${JSON.stringify({
    choices: [
      {
        delta: { content: generateContent(TOKENS_PER_CHUNK) },
        finish_reason: null,
      },
    ],
  })}\n\n`;
}

function buildJSONResponse(): string {
  return JSON.stringify({
    choices: [
      {
        message: { role: "assistant", content: generateContent(200) },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 5000, completion_tokens: 200 },
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || !req.url?.includes("/chat/completions")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  // 读取请求 body
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const rawBody = Buffer.concat(chunks).toString("utf-8");

  let body: ChatRequest = {};
  try {
    body = JSON.parse(rawBody) as ChatRequest;
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  const isStream = body.stream === true;

  if (isStream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // 逐 chunk 写入，模拟真实 LLM 流式输出
    for (let i = 0; i < CHUNK_COUNT; i++) {
      res.write(buildSSEChunk(i, i === CHUNK_COUNT - 1));
      if (CHUNK_DELAY_MS > 0) {
        await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
      }
    }
    res.end();
  } else {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(buildJSONResponse());
  }
});

server.listen(PORT, () => {
  console.log(`[Mock LLM] Listening on http://localhost:${PORT}`);
  console.log(`[Mock LLM] chunkDelay=${CHUNK_DELAY_MS}ms, chunkCount=${CHUNK_COUNT}, tokensPerChunk=${TOKENS_PER_CHUNK}`);
  console.log(`[Mock LLM] 响应总 token ≈ ${CHUNK_COUNT * TOKENS_PER_CHUNK}`);
});

// 优雅退出
process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
