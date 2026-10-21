import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { invokeAgentToolManually } from "../../src/application/useCases/manualToolInvocation";
import type { AgentToolDefinition } from "../../src/domain/agents/contracts";
import type { IKernel } from "../../src/kernel/types";

/**
 * 手动执行通道的契约（2026-10-22）：
 *   - `autoInvoke: false` 只影响模型可见性，不剥夺用户手动执行；
 *   - 输入必须过工具自身 Schema，校验失败不执行；
 *   - `policy: "deny"` 的工具仍然不可执行；
 *   - 执行抛错转换成可展示的失败结果，而不是把异常抛给界面。
 */
function makeTool(overrides: Partial<AgentToolDefinition> = {}): AgentToolDefinition {
  return {
    name: "ext.official.deepseek-web.web.search",
    version: "1.0.0",
    description: "搜索公开网页",
    inputSchema: z.object({ query: z.string().min(1) }).strict(),
    inputJsonSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
    outputSchema: z.unknown(),
    permissions: ["network.request"],
    riskLevel: "medium",
    sideEffect: "external",
    executionScope: "external",
    autoInvoke: false,
    policy: "ask",
    timeoutMs: 5_000,
    execute: vi.fn(async (input: unknown) => ({ echo: input })),
    ...overrides,
  };
}

function makeKernel(tools: AgentToolDefinition[]): IKernel {
  return {
    getService: () => ({ listTools: () => tools }),
  } as unknown as IKernel;
}

describe("手动执行工具", () => {
  it("autoInvoke:false 的工具仍可手动执行，返回结果正文", async () => {
    const tool = makeTool();
    const result = await invokeAgentToolManually({
      kernel: makeKernel([tool]),
      sessionId: "session-1",
      toolName: tool.name,
      input: { query: "唐朝" },
    });

    expect(tool.execute).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(false);
    expect(result.data).toContain("唐朝");
    expect(result.toolName).toBe(tool.name);
  });

  it("输入不满足 Schema 时不执行，直接返回失败", async () => {
    const tool = makeTool();
    const result = await invokeAgentToolManually({
      kernel: makeKernel([tool]),
      sessionId: "session-1",
      toolName: tool.name,
      input: { query: "" },
    });

    expect(tool.execute).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });

  it("policy:deny 的工具拒绝执行", async () => {
    const tool = makeTool({ policy: "deny" });
    await expect(invokeAgentToolManually({
      kernel: makeKernel([tool]),
      sessionId: "session-1",
      toolName: tool.name,
      input: { query: "唐朝" },
    })).rejects.toThrow("MANUAL_TOOL_DENIED");
  });

  it("未知工具名明确失败", async () => {
    await expect(invokeAgentToolManually({
      kernel: makeKernel([]),
      sessionId: "session-1",
      toolName: "ext.unknown.tool",
      input: {},
    })).rejects.toThrow("MANUAL_TOOL_NOT_FOUND");
  });

  it("执行期异常转成可展示的失败结果", async () => {
    const tool = makeTool({
      execute: vi.fn(async () => {
        throw new Error("NETWORK_UNAVAILABLE");
      }),
    });
    const result = await invokeAgentToolManually({
      kernel: makeKernel([tool]),
      sessionId: "session-1",
      toolName: tool.name,
      input: { query: "唐朝" },
    });

    expect(result.isError).toBe(true);
    expect(result.data).toBe("NETWORK_UNAVAILABLE");
  });
});
