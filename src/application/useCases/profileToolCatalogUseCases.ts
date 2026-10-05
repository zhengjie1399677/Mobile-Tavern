/**
 * Runtime Profile 可挂载工具目录。
 *
 * 唯一职责：把「Agent Runtime 里注册了哪些工具」与「哪些工具当前可用」合并成 Profile 可勾选的清单。
 *
 * 关键：可用工具必须**同时**咨询所有能力提供方——Tool Plugin 与外部能力源（MCP）。
 * 只问其中一个会让另一类工具在「运行模式」页里根本不可见，用户也就无法挂载它们。
 */
import type { IKernel } from "../../kernel/types";
import type { RuntimeProfileToolMount } from "../runtimeProfiles/contracts";
import {
  KernelServices,
  type IAgentRuntimeService,
  type IExternalSourceRuntimeService,
  type IToolPluginRuntimeService,
} from "../serviceContracts";
import { CHARACTER_READ_TOOL_NAME, SESSION_BRANCH_TOOL_NAME } from "../tools/builtinAgentTools";

export const BUILTIN_TOOLS: readonly RuntimeProfileToolMount[] = [
  { name: CHARACTER_READ_TOOL_NAME, version: "1.0.0" },
  { name: SESSION_BRANCH_TOOL_NAME, version: "1.0.0" },
];

export function isBuiltinTool(tool: RuntimeProfileToolMount): boolean {
  return tool.name === CHARACTER_READ_TOOL_NAME || tool.name === SESSION_BRANCH_TOOL_NAME;
}

/** Agent Runtime 中已注册的全部工具（含内建），按名字排序。 */
export function listAllKnownTools(kernel: IKernel): RuntimeProfileToolMount[] {
  const versions = new Map(BUILTIN_TOOLS.map((tool) => [tool.name, tool.version]));
  if (kernel.hasService(KernelServices.AgentRuntime)) {
    kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime)
      .listTools()
      .forEach((tool) => versions.set(tool.name, tool.version));
  }
  return [...versions.entries()]
    .map(([name, version]) => ({ name, version }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** 合并所有能力提供方"当前可用"的工具名；缺失或降级的服务按空集合处理。 */
function collectEnabledToolNames(kernel: IKernel, profileId: string): Set<string> {
  const enabled = new Set<string>();
  if (kernel.hasService(KernelServices.ToolConnectors)) {
    const service = kernel.getService<IToolPluginRuntimeService>(KernelServices.ToolConnectors);
    if (typeof service?.getEnabledToolNames === "function") {
      for (const name of service.getEnabledToolNames(profileId)) enabled.add(name);
    }
  }
  if (kernel.hasService(KernelServices.ExternalSources)) {
    const service = kernel.getService<IExternalSourceRuntimeService>(KernelServices.ExternalSources);
    if (typeof service?.getEnabledToolNames === "function") {
      for (const name of service.getEnabledToolNames(profileId)) enabled.add(name);
    }
  }
  return enabled;
}

/** Profile 可挂载的工具：内建工具常驻，其余只列当前真正可用的。 */
export function listToolsForProfile(kernel: IKernel, profileId: string): RuntimeProfileToolMount[] {
  const enabled = collectEnabledToolNames(kernel, profileId);
  return listAllKnownTools(kernel)
    .filter((tool) => isBuiltinTool(tool) || enabled.has(tool.name));
}
