/**
 * 当前会话的两种工具视图：
 *
 *   - `modelTools`：模型本轮真正可自动调用的 Tool。唯一数据来源是
 *     `resolveSessionEnabledToolNames`（发送链路也用它），并剔除 `autoInvoke: false`。
 *   - `manualTools`：用户可手动执行的 Tool（Profile 级可用性），包含 `autoInvoke: false`
 *     的收费能力；MCP 工具走独立分区，不在此列。
 *
 * 解析失败时返回空集合，不向界面抛异常。
 */
import React from "react";
import { useOptionalKernel } from "../../contexts/KernelContext";
import { resolveSessionEnabledToolNames } from "@/src/application/useCases/sessionToolComposition";
import { listToolsForProfile } from "@/src/application/useCases/profileToolCatalogUseCases";
import { getSessionRuntimeProfileId } from "@/src/application/useCases/runtimeProfileSession";
import { KernelServices, type IAgentRuntimeService } from "@/src/application/serviceContracts";
import type { AgentToolDefinition } from "@/src/domain/agents/contracts";
import type { CharacterCard, ChatSession } from "../../types";
import type { SessionManualToolSummary, SessionModelToolSummary } from "./composer-panels/ToolsPanel";

export interface SessionToolViews {
  readonly modelTools: readonly SessionModelToolSummary[];
  readonly manualTools: readonly SessionManualToolSummary[];
}

const EMPTY: SessionToolViews = { modelTools: [], manualTools: [] };

function toBaseSummary(tool: AgentToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    riskLevel: tool.riskLevel,
    sideEffect: tool.sideEffect,
    policy: tool.policy,
  } as const;
}

export function useSessionTools(
  session: ChatSession | null | undefined,
  character: CharacterCard | null | undefined,
): SessionToolViews {
  const kernel = useOptionalKernel();

  return React.useMemo<SessionToolViews>(() => {
    if (!kernel) return EMPTY;
    try {
      const runtime = kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime);
      const definitions = runtime.listTools();

      const modelVisible = new Set(resolveSessionEnabledToolNames({
        kernel,
        character,
        sessionComposition: session?.compositionSnapshot,
      }));
      const modelTools = definitions
        .filter((tool) => modelVisible.has(tool.name) && tool.autoInvoke !== false)
        .map(toBaseSummary)
        .sort((left, right) => left.name.localeCompare(right.name));

      const profileId = getSessionRuntimeProfileId(session ?? null);
      const mounted = new Set(
        (profileId ? listToolsForProfile(kernel, profileId) : []).map((tool) => tool.name),
      );
      const manualTools: SessionManualToolSummary[] = definitions
        .filter((tool) =>
          mounted.has(tool.name)
          // MCP 工具由「外部能力」分区负责，避免同一工具出现两次
          && !tool.name.startsWith("mcp.")
          && tool.policy !== "deny")
        .map((tool) => ({ ...toBaseSummary(tool), inputJsonSchema: tool.inputJsonSchema }))
        .sort((left, right) => left.name.localeCompare(right.name));

      return { modelTools, manualTools };
    } catch {
      return EMPTY;
    }
  }, [kernel, session, character]);
}
