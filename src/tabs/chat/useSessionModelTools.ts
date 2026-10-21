/**
 * 当前会话「模型可自动调用」的工具摘要。
 *
 * 唯一数据来源是 `resolveSessionEnabledToolNames`——发送链路与 Agent Handle 也用它，
 * 因此面板展示的集合与模型实际拿到的工具不会分叉。
 * 解析失败（Kernel 未就绪、服务缺失）时返回空集合，不向界面抛出异常。
 */
import React from "react";
import { useOptionalKernel } from "../../contexts/KernelContext";
import { resolveSessionEnabledToolNames } from "@/src/application/useCases/sessionToolComposition";
import { KernelServices, type IAgentRuntimeService } from "@/src/application/serviceContracts";
import type { CharacterCard, ChatSession } from "../../types";
import type { SessionModelToolSummary } from "./composer-panels/ToolsPanel";

export function useSessionModelTools(
  session: ChatSession | null | undefined,
  character: CharacterCard | null | undefined,
): readonly SessionModelToolSummary[] {
  const kernel = useOptionalKernel();

  return React.useMemo<SessionModelToolSummary[]>(() => {
    if (!kernel) return [];
    try {
      const enabled = new Set(resolveSessionEnabledToolNames({
        kernel,
        character,
        sessionComposition: session?.compositionSnapshot,
      }));
      if (enabled.size === 0) return [];
      const definitions = kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime).listTools();
      return definitions
        .filter((tool) => enabled.has(tool.name))
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          riskLevel: tool.riskLevel,
          sideEffect: tool.sideEffect,
          policy: tool.policy,
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch {
      // 工具面板是可降级 UI：运行时缺失时展示空集合，不影响普通聊天。
      return [];
    }
  }, [kernel, session, character]);
}
