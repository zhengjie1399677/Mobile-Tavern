import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message, ReasoningStrength } from "../../src/types";
import { LLMService } from "../../src/application/services/LLMService";
import {
  ModelCapabilityRegistry,
  normalizeReasoningStrength,
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

  describe("推理强度控制", () => {
    const openAi = "https://api.openai.com/v1";
    const anthropic = "https://api.anthropic.com/v1";
    const gemini = "https://generativelanguage.googleapis.com/v1beta";
    const deepseek = "https://api.deepseek.com/v1";
    const glm = "https://open.bigmodel.cn/api/paas/v4";
    const qwen = "https://dashscope.aliyuncs.com/compatible-mode/v1";

    const buildRequest = (
      baseUrl: string,
      modelId: string,
      level: ReasoningStrength,
      extra: Record<string, unknown> = {},
    ) => prepareProviderRequest({
      baseUrl,
      modelId,
      reasoningStrength: level,
      request: { model: modelId, messages: [{ role: "user", content: "hi" }], ...extra },
    });

    it("归一化旧布尔开关与非法档位", () => {
      expect(normalizeReasoningStrength({ disableReasoning: true })).toBe("off");
      expect(normalizeReasoningStrength({ disableReasoning: false })).toBe("auto");
      expect(normalizeReasoningStrength({})).toBe("auto");
      expect(normalizeReasoningStrength({ reasoningStrength: "high", disableReasoning: true })).toBe("high");
      expect(normalizeReasoningStrength({ reasoningStrength: "ultra" })).toBe("auto");
    });

    it("按模型能力暴露可选档位", () => {
      expect(ModelCapabilityRegistry.describeReasoningControl("gpt-5.6", openAi).selectableLevels)
        .toEqual(["off", "low", "medium", "high", "max"]);
      expect(ModelCapabilityRegistry.describeReasoningControl("o3", openAi).selectableLevels)
        .toEqual(["low", "medium", "high"]);
      expect(ModelCapabilityRegistry.describeReasoningControl("gemini-3-pro", gemini).selectableLevels)
        .toEqual([]);
      expect(ModelCapabilityRegistry.describeReasoningControl("deepseek-reasoner", deepseek).selectableLevels)
        .toEqual([]);
      expect(ModelCapabilityRegistry.describeReasoningControl("glm-5.3", glm).selectableLevels)
        .toEqual([]);
    });

    it("把统一档位映射为各厂商方言，并按模型收敛", () => {
      expect(buildRequest(openAi, "gpt-5.6", "max").reasoning_effort).toBe("max");
      expect(buildRequest(openAi, "gpt-5.6", "off").reasoning_effort).toBe("none");
      expect(buildRequest(openAi, "gpt-5.6", "high").reasoning_effort).toBe("high");
      // 5.6 以下没有 max 档，收敛到 high。
      expect(buildRequest(openAi, "gpt-5.4", "max").reasoning_effort).toBe("high");
      // 原版 GPT-5 最低只到 minimal，o 系列最低只到 low。
      expect(buildRequest(openAi, "gpt-5-mini", "off").reasoning_effort).toBe("minimal");
      expect(buildRequest(openAi, "o3", "off").reasoning_effort).toBe("low");
      expect(buildRequest(openAi, "o3", "medium").reasoning_effort).toBe("medium");
      // gpt-4o 等传统模型不识别 reasoning_effort。
      expect(buildRequest(openAi, "gpt-4o", "high").reasoning_effort).toBeUndefined();
      expect(buildRequest(gemini, "gemini-2.5-pro", "off").reasoning_effort).toBe("none");
      expect(buildRequest(gemini, "gemini-2.5-pro", "medium").reasoning_effort).toBe("medium");
      expect(buildRequest(gemini, "gemini-3-pro", "high").reasoning_effort).toBeUndefined();
      expect(buildRequest(deepseek, "deepseek-v4-flash", "high").thinking).toEqual({ type: "enabled" });
      expect(buildRequest(deepseek, "deepseek-v4-flash", "off").thinking).toEqual({ type: "disabled" });
      expect(buildRequest(deepseek, "deepseek-reasoner", "high").thinking).toBeUndefined();
      expect(buildRequest(glm, "glm-5.1", "low").thinking).toEqual({ type: "enabled" });
      expect(buildRequest(glm, "glm-5.3", "high").thinking).toBeUndefined();
      expect(buildRequest(qwen, "qwen3-max", "off").enable_thinking).toBe(false);
      expect(buildRequest(qwen, "qwen3-max", "high").enable_thinking).toBe(true);
      expect(buildRequest(qwen, "qwen3-235b-a22b-thinking-2507", "high").enable_thinking).toBeUndefined();
      // 未识别的中转站不注入任何强度字段。
      expect(buildRequest("https://proxy.example/v1", "custom-model", "high").reasoning_effort).toBeUndefined();
    });

    it("Anthropic 开启思考时夹取预算并约束采样参数", () => {
      const enabled = buildRequest(anthropic, "claude-sonnet-4-5", "medium", {
        max_tokens: 4096,
        temperature: 0.7,
        top_p: 0.9,
      });
      expect(enabled.thinking).toEqual({ type: "enabled", budget_tokens: 4095 });
      expect(enabled.temperature).toBe(1);
      expect(enabled.top_p).toBeUndefined();

      // 输出上限装不下最小思考预算时不注入，保持原采样参数。
      const tiny = buildRequest(anthropic, "claude-sonnet-4-5", "high", {
        max_tokens: 800,
        temperature: 0.7,
      });
      expect(tiny.thinking).toBeUndefined();
      expect(tiny.temperature).toBe(0.7);

      const disabled = buildRequest(anthropic, "claude-sonnet-4-5", "off", {
        temperature: 0.7,
        top_p: 0.9,
      });
      expect(disabled.thinking).toEqual({ type: "disabled" });
      expect(disabled.temperature).toBe(0.7);
      expect(disabled.top_p).toBe(0.9);
    });

    it("强度字段被拒绝时按字段重试并停止后续注入", async () => {
      const requestBodies: Array<Record<string, unknown>> = [];
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        if (requestBodies.length === 1) {
          return new Response(JSON.stringify({ error: { message: "Unsupported parameter: reasoning_effort" } }), {
            status: 400,
          });
        }
        return new Response("data: [DONE]\n\n", { status: 200 });
      });
      vi.stubGlobal("fetch", fetchMock);

      const baseUrl = "https://api.openai.com/tenant-reasoning/v1";
      const payload = {
        baseUrl,
        apiKey: "test-key",
        bypassProxy: true,
        reasoningStrength: "high" as const,
        reqBody: { model: "gpt-5.6", stream: true, messages: [{ role: "user", content: "hi" }] },
      };

      const first = await new LLMService().universalFetch("/api/proxy/openai", payload);
      expect(first.ok).toBe(true);
      expect(requestBodies[0].reasoning_effort).toBe("high");
      expect(requestBodies[1].reasoning_effort).toBeUndefined();
      expect(ModelCapabilityRegistry.getCapabilities("gpt-5.6", baseUrl).supportsReasoningControl).toBe(false);

      await new LLMService().universalFetch("/api/proxy/openai", payload);
      expect(requestBodies[2].reasoning_effort).toBeUndefined();
      expect(ModelCapabilityRegistry.describeReasoningControl("gpt-5.6", baseUrl).selectableLevels).toEqual([]);
    });
  });
});
