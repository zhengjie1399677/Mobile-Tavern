import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  buildOpenAiToolDefinitions,
  executeOpenAiToolLoop,
  MAX_PROVIDER_FUNCTION_NAME_LENGTH,
  OpenAiToolCallAccumulator,
} from "../../src/application/useCases/openAiToolLoop";
import type {
  AgentToolDefinition,
  AgentTurnExecutionContext,
} from "../../src/domain/agents/contracts";

const doubleTool: AgentToolDefinition = {
  name: "math.double",
  version: "1.0.0",
  description: "把输入数值乘以二",
  inputSchema: z.object({ value: z.number() }),
  inputJsonSchema: {
    type: "object",
    properties: { value: { type: "number" } },
    required: ["value"],
    additionalProperties: false,
  },
  outputSchema: z.object({ value: z.number() }),
  permissions: ["compute.basic"],
  riskLevel: "low",
  sideEffect: "none",
  executionScope: "turn",
  policy: "allow",
  timeoutMs: 100,
  execute: async () => ({ value: 8 }),
};

describe("OpenAI-compatible Tool Loop", () => {
  it("聚合分片 tool_calls 并解析 JSON 参数", () => {
    const accumulator = new OpenAiToolCallAccumulator();
    accumulator.append([{
      index: 0,
      id: "call-1",
      type: "function",
      function: { name: "math.", arguments: "{\"value\":" },
    }]);
    accumulator.append([{
      index: 0,
      function: { name: "double", arguments: "4}" },
    }]);

    expect(accumulator.finalize()).toEqual([{
      callId: "call-1",
      name: "math.double",
      arguments: { value: 4 },
    }]);
  });

  it("执行 Tool Call，把 Assistant/Tool 消息带入下一模型步骤", async () => {
    const executeTool = vi.fn(async () => ({ value: 8 }));
    const recordDecision = vi.fn(async () => undefined);
    const context = createContext(executeTool, recordDecision);
    let providerToolName = "";
    const executeModelStep = vi.fn(async ({ step, continuationMessages, tools }) => {
      if (step === 0) {
        expect(continuationMessages).toEqual([]);
        providerToolName = tools[0].function.name;
        expect(providerToolName).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
        expect(providerToolName).not.toBe("math.double");
        return {
          content: "我先计算。",
          toolCalls: [{
            callId: "call-1",
            name: providerToolName,
            arguments: { value: 4 },
          }],
        };
      }
      expect(continuationMessages).toEqual([
        {
          role: "assistant",
          content: "我先计算。",
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: { name: providerToolName, arguments: "{\"value\":4}" },
          }],
        },
        { role: "tool", content: "{\"value\":8}", tool_call_id: "call-1" },
      ]);
      return { content: "结果是 8。", toolCalls: [] };
    });

    await executeOpenAiToolLoop({
      context,
      tools: [doubleTool],
      executeModelStep,
    });

    expect(executeModelStep).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenCalledWith({
      callId: "call-1",
      name: "math.double",
      arguments: { value: 4 },
    });
    expect(recordDecision).toHaveBeenCalledWith("tool.loop.step", {
      step: 0,
      callIds: ["call-1"],
      toolNames: ["math.double"],
    });
  });

  it("达到步骤上限时显式失败，不形成无界循环", async () => {
    const executeTool = vi.fn(async () => ({ value: 8 }));
    const context = createContext(
      executeTool,
      vi.fn(async () => undefined),
    );
    await expect(executeOpenAiToolLoop({
      context,
      tools: [doubleTool],
      maxSteps: 1,
      executeModelStep: async ({ tools }) => ({
        content: "",
        toolCalls: [{ callId: "call-loop", name: tools[0].function.name, arguments: { value: 4 } }],
      }),
    })).rejects.toThrow("AGENT_TOOL_LOOP_STEP_LIMIT_EXCEEDED: 1");
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("为点号、超长名称和潜在重名生成稳定且无碰撞的 Provider 名称", () => {
    const validNameTool = { ...doubleTool, name: "math_double" };
    const longNameTool = { ...doubleTool, name: `ext.${"plugin.".repeat(20)}weather.get` };
    const definitions = buildOpenAiToolDefinitions([doubleTool, validNameTool, longNameTool]);
    const names = definitions.map((item) => item.function.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("math_double");
    expect(names.every((name) => /^[A-Za-z0-9_-]+$/.test(name))).toBe(true);
    expect(names.every((name) => name.length <= MAX_PROVIDER_FUNCTION_NAME_LENGTH)).toBe(true);
    expect(buildOpenAiToolDefinitions([doubleTool, validNameTool, longNameTool]))
      .toEqual(definitions);
  });

  it("拒绝执行 Provider 返回的未知工具别名", async () => {
    const context = createContext(vi.fn(), vi.fn(async () => undefined));
    await expect(executeOpenAiToolLoop({
      context,
      tools: [doubleTool],
      executeModelStep: async () => ({
        content: "",
        toolCalls: [{ callId: "call-unknown", name: "unknown_tool", arguments: {} }],
      }),
    })).rejects.toThrow("AGENT_PROVIDER_TOOL_NAME_UNMAPPED: unknown_tool");
  });

  it("在请求前拒绝超过 OpenAI-compatible 上限的工具数量", () => {
    const tools = Array.from({ length: 129 }, (_, index) => ({
      ...doubleTool,
      name: `tool_${index}`,
    }));
    expect(() => buildOpenAiToolDefinitions(tools))
      .toThrow("AGENT_PROVIDER_TOOL_LIMIT_EXCEEDED: 129");
  });
});

function createContext(
  executeTool: AgentTurnExecutionContext["executeTool"],
  recordDecision: AgentTurnExecutionContext["recordDecision"],
): AgentTurnExecutionContext {
  return {
    sessionId: "session-1",
    turnId: "turn-1",
    driverId: "mobile-tavern.chat.driver",
    providerId: "provider.openai-compatible",
    input: { text: "计算", attachmentIds: [] },
    signal: new AbortController().signal,
    provider: {
      id: "provider.openai-compatible",
      version: "1.0.0",
      capabilities: {
        inputModalities: ["text"],
        supportsStreaming: true,
        supportsTools: true,
      },
      buildRequestBody: (request) => ({ ...request }),
    },
    executeLegacy: async () => undefined,
    executeTool,
    processMedia: async () => {
      throw new Error("unexpected media call");
    },
    recordDecision,
  };
}
