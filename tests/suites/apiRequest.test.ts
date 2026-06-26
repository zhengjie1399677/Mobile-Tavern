/**
 * API 请求与响应测试套件
 *
 * 覆盖：
 *  - testApiCleanRequestPayload：cleanRequestPayload 默认透传策略与互斥字段裁剪
 *  - testSSEStreamWithReasoning：SSE 流式响应中 reasoning_content / content 分流
 *  - testCleanLLMResponse：非流式 LLM 响应字段白名单清洗（P1-9）
 */

import { cleanRequestPayload, cleanLLMResponse } from "../../src/kernel/utils/requestSchema";
import { readSSEStream, safeParseSSEData } from "../../src/utils/streamReader";
import { assert } from "./testUtils";

export function testApiCleanRequestPayload() {
  console.log("\n--- Running API Request Payload Cleaning Verification ---");

  const fullPayload = {
    model: "gpt-4",
    messages: [{ role: "user", content: "hello" }],
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    min_p: 0.05,
    max_tokens: 100,
    max_completion_tokens: 100,
    presence_penalty: 0.5,
    frequency_penalty: 0.5,
    repetition_penalty: 1.1,
  };

  // CR-URLFIX：新策略为「默认透传所有参数」，仅保留 max_completion_tokens/max_tokens 互斥逻辑。
  // 所有域名（含未知第三方中转站）均应保留 top_k / min_p / repetition_penalty / stream_options / max_completion_tokens。

  // 1. OpenRouter（全量透传）
  const openRouterRes = cleanRequestPayload("https://openrouter.ai/api/v1", fullPayload);
  assert(openRouterRes !== undefined, "OpenRouter payload should exist");
  assert(openRouterRes!.top_k === 40, "OpenRouter: keep top_k");
  assert(openRouterRes!.min_p === 0.05, "OpenRouter: keep min_p");
  assert(openRouterRes!.repetition_penalty === 1.1, "OpenRouter: keep repetition_penalty");
  assert(openRouterRes!.max_completion_tokens === 100, "OpenRouter: keep max_completion_tokens");
  assert(openRouterRes!.max_tokens === undefined, "OpenRouter: strip max_tokens when max_completion_tokens is present");
  assert(openRouterRes!.stream_options !== undefined, "OpenRouter: keep stream_options");

  // 2. OpenAI Official（默认透传策略下保留所有参数）
  const openaiRes = cleanRequestPayload("https://api.openai.com/v1", fullPayload);
  assert(openaiRes !== undefined, "OpenAI payload should exist");
  assert(openaiRes!.top_k === 40, "OpenAI: keep top_k (default passthrough)");
  assert(openaiRes!.min_p === 0.05, "OpenAI: keep min_p (default passthrough)");
  assert(openaiRes!.repetition_penalty === 1.1, "OpenAI: keep repetition_penalty (default passthrough)");
  assert(openaiRes!.max_completion_tokens === 100, "OpenAI: keep max_completion_tokens");
  assert(openaiRes!.max_tokens === undefined, "OpenAI: strip max_tokens when max_completion_tokens is present");
  assert(openaiRes!.stream_options !== undefined, "OpenAI: keep stream_options");
  assert(openaiRes!.temperature === 0.7, "OpenAI: keep standard parameters");

  // 3. DeepSeek Official（默认透传策略下保留所有参数）
  const deepseekRes = cleanRequestPayload("https://api.deepseek.com/v1", fullPayload);
  assert(deepseekRes !== undefined, "DeepSeek payload should exist");
  assert(deepseekRes!.top_k === 40, "DeepSeek: keep top_k (default passthrough)");
  assert(deepseekRes!.min_p === 0.05, "DeepSeek: keep min_p (default passthrough)");
  assert(deepseekRes!.repetition_penalty === 1.1, "DeepSeek: keep repetition_penalty");
  assert(deepseekRes!.max_completion_tokens === 100, "DeepSeek: keep max_completion_tokens");
  assert(deepseekRes!.max_tokens === undefined, "DeepSeek: strip max_tokens when max_completion_tokens is present");
  assert(deepseekRes!.stream_options !== undefined, "DeepSeek: keep stream_options");

  // 4. Gemini / Google（默认透传策略下保留所有参数）
  const geminiRes = cleanRequestPayload("https://generativelanguage.googleapis.com/v1beta", fullPayload);
  assert(geminiRes !== undefined, "Gemini payload should exist");
  assert(geminiRes!.top_k === 40, "Gemini: keep top_k (default passthrough)");
  assert(geminiRes!.min_p === 0.05, "Gemini: keep min_p (default passthrough)");
  assert(geminiRes!.repetition_penalty === 1.1, "Gemini: keep repetition_penalty (default passthrough)");
  assert(geminiRes!.max_completion_tokens === 100, "Gemini: keep max_completion_tokens (default passthrough)");
  assert(geminiRes!.max_tokens === undefined, "Gemini: strip max_tokens when max_completion_tokens is present");
  assert(geminiRes!.stream_options !== undefined, "Gemini: keep stream_options (default passthrough)");

  // 5. 第三方未知中转站（CR-URLFIX 关键修复点：不再裁剪任何参数）
  const otherRes = cleanRequestPayload("https://api.some-thirdparty-中转.top/v1", fullPayload);
  assert(otherRes !== undefined, "Other payload should exist");
  assert(otherRes!.top_k === 40, "Other: keep top_k (CR-URLFIX default passthrough)");
  assert(otherRes!.min_p === 0.05, "Other: keep min_p (CR-URLFIX default passthrough)");
  assert(otherRes!.repetition_penalty === 1.1, "Other: keep repetition_penalty (CR-URLFIX default passthrough)");
  assert(otherRes!.max_completion_tokens === 100, "Other: keep max_completion_tokens (CR-URLFIX)");
  assert(otherRes!.max_tokens === undefined, "Other: strip max_tokens when max_completion_tokens is present");
  assert(otherRes!.stream_options !== undefined, "Other: keep stream_options (CR-URLFIX default passthrough)");

  // 6. 自定义代理 + DeepSeek 模型（默认透传，保留所有参数）
  const deepseekModelPayload = { ...fullPayload, model: "deepseek-reasoner" };
  const customProxyDeepseekRes = cleanRequestPayload("https://api.some-thirdparty-中转.top/v1", deepseekModelPayload);
  assert(customProxyDeepseekRes !== undefined, "Custom proxy deepseek payload should exist");
  assert(customProxyDeepseekRes!.repetition_penalty === 1.1, "Custom Proxy Deepseek: keep repetition_penalty");
  assert(customProxyDeepseekRes!.max_completion_tokens === 100, "Custom Proxy Deepseek: keep max_completion_tokens");
  assert(customProxyDeepseekRes!.max_tokens === undefined, "Custom Proxy Deepseek: strip max_tokens when max_completion_tokens is present");
  assert(customProxyDeepseekRes!.stream_options !== undefined, "Custom Proxy Deepseek: keep stream_options");

  // 7. 自定义代理 + GPT 模型（CR-URLFIX 关键修复点：不再裁剪 stream_options/max_completion_tokens）
  const gptModelPayload = { ...fullPayload, model: "gpt-4o" };
  const customProxyGptRes = cleanRequestPayload("https://api.some-thirdparty-中转.top/v1", gptModelPayload);
  assert(customProxyGptRes !== undefined, "Custom proxy gpt payload should exist");
  assert(customProxyGptRes!.stream_options !== undefined, "Custom Proxy GPT: keep stream_options (CR-URLFIX)");
  assert(customProxyGptRes!.max_completion_tokens === 100, "Custom Proxy GPT: keep max_completion_tokens (CR-URLFIX)");
  assert(customProxyGptRes!.max_tokens === undefined, "Custom Proxy GPT: strip max_tokens when max_completion_tokens is present");

  console.log("✔ API Request Payload Cleaning verified successfully!");
}

export async function testSSEStreamWithReasoning() {
  console.log("\n--- Running SSE Stream with Reasoning Content Verification ---");

  // 模拟一个包含 reasoning_content 的流式响应数据
  const mockSseChunks = [
    'data: {"choices":[{"delta":{"reasoning_content":"思考一"}}]}\n\n',
    'data: {"choices":[{"delta":{"reasoning_content":"，思考二"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"！"}}]}\n\n',
    'data: [DONE]\n\n'
  ].join("");

  // 将字符串模拟成 ReadableStream 的 Response
  const mockStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(mockSseChunks));
      controller.close();
    }
  });

  const mockResponse = new Response(mockStream);

  let responseText = "";
  let reasoningText = "";

  await readSSEStream(mockResponse, {
    onData: (dataStr) => {
      const parsed = safeParseSSEData(dataStr);
      if (!parsed) return;

      const reasoning = (parsed as any).choices?.[0]?.delta?.reasoning_content;
      if (reasoning) {
        reasoningText += reasoning;
        return;
      }

      const delta = (parsed as any).choices?.[0]?.delta?.content;
      if (delta) {
        responseText += delta;
      }
    }
  });

  // 断言验证最终拼接的思维链和正式对白
  assert(reasoningText === "思考一，思考二", `Reasoning Text should match. Got: ${reasoningText}`);
  assert(responseText === "你好！", `Response Text should match. Got: ${responseText}`);

  console.log("✔ SSE Stream with Reasoning Content verified successfully!");
}

/**
 * P1-9 修复验证：cleanLLMResponse 响应字段白名单清洗
 * 验证非流式 LLM 响应中的中转站非标字段被剥离，标准 OpenAI 字段被保留。
 */
export async function testCleanLLMResponse() {
  console.log("\n--- Running cleanLLMResponse (P1-9) Verification ---");

  // 场景 1：标准 OpenAI 响应字段应被保留，中转站附加字段应被剥离
  const mockResponse = {
    id: "chatcmpl-abc123",
    object: "chat.completion",
    created: 1719400000,
    model: "gpt-4",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "你好，世界！",
          reasoning_content: "思考过程...",
          // 中转站附加的脏字段（应被剥离）
          __proxy_cache_key: "cache-xyz",
          __upstream_latency_ms: 234,
          __raw_provider: "azure",
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    // 顶层中转站附加字段（应被剥离）
    __proxy_version: "1.2.3",
    __request_id: "req-abc",
  };

  const cleaned = cleanLLMResponse(mockResponse) as any;

  // 顶层标准字段应保留
  assert(cleaned.id === "chatcmpl-abc123", "Standard top-level field 'id' should be preserved");
  assert(cleaned.object === "chat.completion", "Standard top-level field 'object' should be preserved");
  assert(cleaned.model === "gpt-4", "Standard top-level field 'model' should be preserved");
  assert(cleaned.usage.total_tokens === 15, "Standard top-level field 'usage' should be preserved");

  // 顶层非标字段应被剥离
  assert(cleaned.__proxy_version === undefined, "Non-standard top-level field '__proxy_version' should be stripped");
  assert(cleaned.__request_id === undefined, "Non-standard top-level field '__request_id' should be stripped");

  // message 标准字段应保留
  const msg = cleaned.choices[0].message;
  assert(msg.role === "assistant", "Standard message field 'role' should be preserved");
  assert(msg.content === "你好，世界！", "Standard message field 'content' should be preserved");
  assert(msg.reasoning_content === "思考过程...", "Standard message field 'reasoning_content' should be preserved");

  // message 非标字段应被剥离
  assert(msg.__proxy_cache_key === undefined, "Non-standard message field '__proxy_cache_key' should be stripped");
  assert(msg.__upstream_latency_ms === undefined, "Non-standard message field '__upstream_latency_ms' should be stripped");
  assert(msg.__raw_provider === undefined, "Non-standard message field '__raw_provider' should be stripped");

  // 场景 2：null/undefined 输入应安全降级
  assert(cleanLLMResponse(null) === null, "null input should return null");
  assert(cleanLLMResponse(undefined) === undefined, "undefined input should return undefined");

  // 场景 3：缺少 choices 的响应不应崩溃
  const noChoices = { id: "test", model: "gpt-4" };
  const cleanedNoChoices = cleanLLMResponse(noChoices) as any;
  assert(cleanedNoChoices.id === "test", "Response without choices should not crash");
  assert(!cleanedNoChoices.choices, "choices should be absent if not in original");

  console.log("✔ cleanLLMResponse (P1-9) verified successfully!");
}
