/**
 * 用户手动执行 Agent Tool 的唯一入口。
 *
 * 定位（2026-10-22）：模型工具列表只包含 `autoInvoke !== false` 的 Tool；收费或高成本的
 * 外部能力（联网检索等）声明 `autoInvoke: false` 后仍然注册，但只能由用户主动点击执行。
 *
 * 语义与 MCP 的「单次测试调用」保持一致，理由也相同：
 *   - 单次、无审批链：点击本身就是授权；
 *   - 不写 Agent Journal：结果不进入模型可见事实，除非用户手动把正文插回输入框；
 *   - 仍以 Tool Definition 的 Zod Schema 校验输入，失败即停，不做猜测性修补。
 *
 * 边界：本用例只依赖 Agent Runtime 契约，不接触存储、不渲染界面。
 */
import type { IKernel } from "../../kernel/types";
import { KernelServices, type IAgentRuntimeService } from "../serviceContracts";
import type { AgentToolDefinition } from "../../domain/agents/contracts";
import { formatAgentToolResult } from "./toolResultFormatting";

export interface ManualToolInvocationResult {
  readonly toolName: string;
  readonly data: string;
  readonly durationMs: number;
  readonly isError: boolean;
}

/** 单次手动执行的结果正文上限，避免把超大响应塞进输入框。 */
const MAX_RESULT_CHARS = 20_000;

function resolveTool(kernel: IKernel, toolName: string): AgentToolDefinition {
  const runtime = kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime);
  const tool = runtime.listTools().find((candidate) => candidate.name === toolName);
  if (!tool) throw new Error("MANUAL_TOOL_NOT_FOUND");
  if (tool.policy === "deny") throw new Error("MANUAL_TOOL_DENIED");
  return tool;
}

export async function invokeAgentToolManually(options: {
  readonly kernel: IKernel;
  readonly sessionId: string;
  readonly toolName: string;
  readonly input: unknown;
}): Promise<ManualToolInvocationResult> {
  const { kernel, sessionId, toolName, input } = options;
  const tool = resolveTool(kernel, toolName);

  // 输入一律按工具自身 Schema 收口：手动执行不是绕过校验的通道。
  let parsedInput: unknown;
  try {
    parsedInput = await tool.inputSchema.parseAsync(input);
  } catch (error: unknown) {
    return {
      toolName,
      data: error instanceof Error ? error.message : String(error),
      durationMs: 0,
      isError: true,
    };
  }

  const controller = new AbortController();
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const timeout = setTimeout(() => {
    controller.abort(new Error("MANUAL_TOOL_TIMEOUT"));
  }, tool.timeoutMs);

  const startedAt = performance.now();
  try {
    const result = await tool.execute(parsedInput, {
      sessionId,
      turnId: `manual-${nonce}`,
      callId: `manual-call-${nonce}`,
      signal: controller.signal,
    });
    return {
      toolName,
      data: formatAgentToolResult(result).slice(0, MAX_RESULT_CHARS),
      durationMs: Math.round(performance.now() - startedAt),
      isError: false,
    };
  } catch (error: unknown) {
    return {
      toolName,
      data: error instanceof Error ? error.message : String(error),
      durationMs: Math.round(performance.now() - startedAt),
      isError: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}
