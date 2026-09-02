import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../../src/types";
import { LLMService } from "../../src/application/services/LLMService";
import {
  ModelCapabilityRegistry,
  normalizeProviderStreamChunk,
  prepareProviderRequest,
  preserveAssistantReasoning,
  resolveProviderIdentity,
} from "../../src/application/services/llmCompatibility";

describe("LLM Provider 兼容层", () => {
  beforeEach(() => ModelCapabilityRegistry.resetRuntimeCacheForTesting());
  afterEach(() => vi.unstubAllGlobals());

  it("使用 URL hostname 识别官方端点，并拒绝查询串伪装", () => {
    expect(resolveProviderIdentity("https://api.deepseek.com/v1", "x")).toMatchObject({
      family: "deepseek",
      official: true,
      origin: "https://api.deepseek.com",
    });
    expect(resolveProviderIdentity(
      "https://proxy.example/v1?upstream=api.deepseek.com",
      "custom-model",
    ).family).toBe("other");
    expect(resolveProviderIdentity("https://proxy.example/v1", "deepseek/deepseek-v4").family)
      .toBe("deepseek");
  });

  it("按端点隔离运行时能力学习，避免一个中转站污染其他端点", () => {
    ModelCapabilityRegistry.updateCapabilities(
      "gpt-4o",
      { supportsTopP: false },
      "https://api.openai.com/v1",
    );
    expect(ModelCapabilityRegistry.getCapabilities(
      "gpt-4o",
      "https://api.openai.com/v1",
    ).supportsTopP).toBe(false);
    expect(ModelCapabilityRegistry.getCapabilities(
      "gpt-4o",
      "https://openrouter.ai/api/v1",
    ).supportsTopP).toBe(true);

    ModelCapabilityRegistry.updateCapabilities(
      "gpt-4o",
      { supportsTemperature: false },
      "https://api.openai.com/tenant-a/v1/",
    );
    expect(ModelCapabilityRegistry.getCapabilities(
      "gpt-4o",
      "https://api.openai.com/tenant-a/v1",
    ).supportsTemperature).toBe(false);
    expect(ModelCapabilityRegistry.getCapabilities(
      "gpt-4o",
      "https://api.openai.com/tenant-b/v1",
    ).supportsTemperature).toBe(true);
  });

  it("集中完成 DeepSeek 请求裁剪、关闭思考方言与工具消息修复", () => {
    const request = prepareProviderRequest({
      baseUrl: "https://api.deepseek.com/v1",
      modelId: "deepseek-v4-flash",
      disableReasoning: true,
      request: {
        model: "deepseek-v4-flash",
        top_k: 40,
        tools: [{ type: "function", function: { name: "weather" } }],
        tool_choice: "auto",
        messages: [{ role: "assistant", content: null, tool_calls: [{ id: "call-1" }] }],
      },
    });
    expect(request.top_k).toBeUndefined();
    expect(request.tool_choice).toBeUndefined();
    expect(request.thinking).toEqual({ type: "disabled" });
    expect(request.messages).toEqual([
      { role: "assistant", content: "", tool_calls: [{ id: "call-1" }] },
    ]);
  });

  it("不会向仅思考模型注入关闭开关", () => {
    expect(ModelCapabilityRegistry.getReasoningDisableParams(
      "qwen3-235b-a22b-thinking-2507",
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    )).toEqual({});
    expect(ModelCapabilityRegistry.getReasoningDisableParams(
      "deepseek-reasoner",
      "https://api.deepseek.com/v1",
    )).toEqual({});
    expect(ModelCapabilityRegistry.getReasoningDisableParams(
      "claude-fable-5",
      "https://api.anthropic.com/v1",
    )).toEqual({});
  });

  it("按 Claude 5 模型能力移除已拒绝的采样参数", () => {
    const request = prepareProviderRequest({
      baseUrl: "https://api.anthropic.com/v1",
      modelId: "claude-sonnet-5",
      request: {
        model: "claude-sonnet-5",
        messages: [{ role: "user", content: "hi" }],
        temperature: 0.7,
        top_p: 0.9,
        top_k: 40,
      },
    });
    expect(request.temperature).toBeUndefined();
    expect(request.top_p).toBeUndefined();
    expect(request.top_k).toBeUndefined();
  });

  it("按重复文本出现顺序回填历史 reasoning_content", () => {
    const sessionMessages = [
      { id: "a", sender: "assistant", content: "相同回复", reasoningContent: "思考一", timestamp: 1 },
      { id: "b", sender: "assistant", content: "相同回复", reasoningContent: "思考二", timestamp: 2 },
    ] as Message[];
    const result = preserveAssistantReasoning([
      { role: "assistant", content: "相同回复" },
      { role: "assistant", content: "相同回复" },
    ], sessionMessages, "https://open.bigmodel.cn/api/paas/v4", "glm-5.1");
    expect(result.map((message) => message.reasoning_content)).toEqual(["思考一", "思考二"]);
  });

  it("历史助手文本被请求包装后仍回填 reasoning_content", () => {
    const sessionMessages = [{
      id: "wrapped-assistant",
      sender: "assistant",
      content: "原始回复",
      reasoningContent: "原始思考",
      timestamp: 1,
    }] as Message[];

    const result = preserveAssistantReasoning([{
      role: "assistant",
      content: "<center>\n原始回复\n</center>",
    }], sessionMessages, "https://api.deepseek.com/v1", "deepseek-chat");

    expect(result[0].reasoning_content).toBe("原始思考");
  });

  it("按 tool_calls ID 为 content=null 的助手消息回填 reasoning_content", () => {
    const sessionMessages = [{
      id: "tool-message",
      sender: "assistant",
      content: "",
      reasoningContent: "需要先调用天气工具",
      timestamp: 1,
      extra: { tool_calls: [{ id: "call-weather" }] },
    }] as Message[];

    const result = preserveAssistantReasoning([{
      role: "assistant",
      content: null,
      tool_calls: [{
        id: "call-weather",
        type: "function",
        function: { name: "weather", arguments: "{}" },
      }],
    }], sessionMessages, "https://api.deepseek.com/v1", "deepseek-chat");

    expect(result[0]).toMatchObject({
      content: null,
      reasoning_content: "需要先调用天气工具",
    });
  });

  it("空文本无键候选先于同键候选被 content=null 消息消费，保持线性扫描语义", () => {
    const sessionMessages = [
      {
        id: "fallback",
        sender: "assistant",
        content: "",
        reasoningContent: "兜底思考",
        timestamp: 1,
      },
      {
        id: "keyed",
        sender: "assistant",
        content: "",
        reasoningContent: "键位思考",
        timestamp: 2,
        extra: { tool_calls: [{ id: "call-1" }] },
      },
    ] as Message[];

    const result = preserveAssistantReasoning([
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call-1",
          type: "function",
          function: { name: "f", arguments: "{}" },
        }],
      },
      { role: "assistant", content: "" },
    ], sessionMessages, "https://api.deepseek.com/v1", "deepseek-chat");

    expect(result.map((message) => message.reasoning_content)).toEqual(["兜底思考", "键位思考"]);
  });

  it("归一化 OpenAI 别名、Anthropic SSE、Gemini 与 DashScope 响应", () => {
    expect(normalizeProviderStreamChunk({
      choices: [{ delta: { reasoningContent: "想", text: "答" }, finishReason: "STOP" }],
    })?.choices?.[0]).toMatchObject({
      delta: { reasoning_content: "想", content: "答" },
      finish_reason: "stop",
    });
    expect(normalizeProviderStreamChunk({
      type: "content_block_delta",
      delta: { type: "thinking_delta", thinking: "分析" },
    })?.choices?.[0].delta?.reasoning_content).toBe("分析");
    expect(normalizeProviderStreamChunk({
      candidates: [{
        content: { parts: [{ thought: true, text: "推理" }, { text: "结论" }] },
        finishReason: "SAFETY",
      }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
    })).toMatchObject({
      choices: [{
        delta: { reasoning_content: "推理", content: "结论" },
        finish_reason: "content_filter",
      }],
      usage: { prompt_tokens: 3, completion_tokens: 4 },
    });
    expect(normalizeProviderStreamChunk({
      output: { choices: [{ message: { content: "百炼" } }] },
    })?.choices?.[0].delta?.content).toBe("百炼");
  });

  it("直连端点遇到不支持参数时按字段重试，并只污染当前端点能力", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (requestBodies.length === 1) {
        return new Response(JSON.stringify({ error: { message: "Unsupported parameter: top_p" } }), {
          status: 400,
        });
      }
      return new Response("data: [DONE]\n\n", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await new LLMService().universalFetch("/api/proxy/openai", {
      baseUrl: "https://api.openai.com/tenant-a/v1",
      apiKey: "test-key",
      bypassProxy: true,
      reqBody: {
        model: "gpt-4o",
        stream: true,
        messages: [{ role: "user", content: "hi" }],
        top_p: 0.9,
      },
    });

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBodies[0].top_p).toBe(0.9);
    expect(requestBodies[1].top_p).toBeUndefined();
    expect(ModelCapabilityRegistry.getCapabilities(
      "gpt-4o",
      "https://api.openai.com/tenant-a/v1",
    ).supportsTopP).toBe(false);
    expect(ModelCapabilityRegistry.getCapabilities(
      "gpt-4o",
      "https://api.openai.com/tenant-b/v1",
    ).supportsTopP).toBe(true);
  });
});
