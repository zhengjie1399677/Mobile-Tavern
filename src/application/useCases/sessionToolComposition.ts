/**
 * 会话本轮可用工具名的唯一解析入口。
 *
 * 组合快照在会话建立时冻结（安全边界：Profile 身份与 Tool 插件贡献不随全局设置漂移），
 * 但**外部能力源（MCP）是用户显式启用的实时能力**：启用后必须对已有会话立即生效，
 * 否则"工作台里测得好好的、聊天里模型根本看不到工具"。
 *
 * 因此这里统一为：
 *   - 无会话快照：以当前运行时组合为基底（与建会话一致），叠加 Tool 插件与外部来源；
 *   - 有会话快照：保留冻结的 Profile 身份与插件贡献，只叠加当前已启用的外部来源工具；
 *   - 直连 API 角色（通用助手）：不暴露任何工具。
 *
 * 发送链路与 Agent Handle 必须共用本函数，避免两处各写一份过滤条件产生分叉。
 */
import type { AgentCompositionSnapshot } from "../../domain/agents/contracts";
import type {
  IAgentRuntimeService,
  IExternalSourceRuntimeService,
  IToolPluginRuntimeService,
} from "../serviceContracts";
import { KernelServices } from "../serviceContracts";
import type { IKernel } from "../../kernel/types";
import { isDirectApiCharacter } from "../../domain/agents/directApiMode";
import type { CharacterCard } from "../../types";

export interface SessionEnabledToolsInput {
  readonly kernel: IKernel;
  readonly character: CharacterCard | null | undefined;
  readonly sessionComposition?: AgentCompositionSnapshot;
}

/** 解析当前会话本轮应暴露给模型的工具名（已按启用的外部来源与 Profile 挂载过滤）。 */
export function resolveSessionEnabledToolNames(input: SessionEnabledToolsInput): string[] {
  const { kernel, character, sessionComposition } = input;
  if (character && isDirectApiCharacter(character)) return [];

  const runtime = kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime);
  const base = sessionComposition ?? runtime.getCompositionSnapshot();
  if (!base) return [];

  let composed = base;
  if (!sessionComposition && kernel.hasService(KernelServices.ToolConnectors)) {
    composed = kernel
      .getService<IToolPluginRuntimeService>(KernelServices.ToolConnectors)
      .extendComposition(composed);
  }
  if (kernel.hasService(KernelServices.ExternalSources)) {
    composed = kernel
      .getService<IExternalSourceRuntimeService>(KernelServices.ExternalSources)
      .extendComposition(composed);
  }
  return [...(composed.contributionOrder.tool ?? [])];
}
