/**
 * 外部能力源（MCP）启用 / 停用时，同步活跃 Profile 的工具挂载。
 *
 * 目标：用户在工作台点「启用」就等效于自动挂载，点「停用」就是卸载，
 * 不需要再去「装配」里手工勾选。
 *
 * 语义边界：
 *   - 内置 Profile（Tavern Agent / Base Agent）不声明 `agent.toolMounts`，
 *     运行时本身就会隐式包含所有启用来源的工具，因此这里无需改动（也不可改，内置只读）；
 *   - 自定义 Profile 显式声明了 toolMounts，属于"用户钦定清单"，这里随启用状态增删对应来源的工具；
 *   - 会话在创建时冻结组合快照，因此新启用对**已有会话**不生效，新会话自动带上（设计如此）。
 */
import type { IKernel } from "../../kernel/types";
import type { IRuntimeProfileService, RuntimeProfileToolMount } from "../runtimeProfiles/contracts";
import { KernelServices } from "../serviceContracts";
import { listAllKnownTools } from "./profileToolCatalogUseCases";

export interface ExternalSourceToolMountSyncResult {
  /** 是否改动了 Profile（内置或未声明 agent 的 Profile 返回 false）。 */
  readonly changed: boolean;
  /** 说明性原因，供界面日志与用户提示使用。 */
  readonly reason:
    | "builtin-implicit"
    | "no-explicit-agent"
    | "updated"
    | "no-change";
}

/** 某个外部来源派生出的工具名（兼容 lib 与 resources 派生的工具）。 */
export function listExternalSourceToolMounts(
  kernel: IKernel,
  sourceId: string,
): RuntimeProfileToolMount[] {
  const prefix = `mcp.${sourceId}.`;
  return listAllKnownTools(kernel).filter((tool) => tool.name.startsWith(prefix));
}

export function syncExternalSourceToolMounts(options: {
  kernel: IKernel;
  sourceId: string;
  enabled: boolean;
}): ExternalSourceToolMountSyncResult {
  const { kernel, sourceId, enabled } = options;
  if (!kernel.hasService(KernelServices.RuntimeProfiles)) {
    return { changed: false, reason: "no-explicit-agent" };
  }
  const profileService = kernel.getService<IRuntimeProfileService>(KernelServices.RuntimeProfiles);
  const catalog = profileService.listProfiles();
  const profileId = catalog.activeProfileId ?? catalog.selectedProfileId;
  const profile = catalog.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) return { changed: false, reason: "no-explicit-agent" };
  if (profile.builtin) return { changed: false, reason: "builtin-implicit" };
  if (!profile.agent) return { changed: false, reason: "no-explicit-agent" };

  const prefix = `mcp.${sourceId}.`;
  const existing = profile.agent.toolMounts;
  const withoutSource = existing.filter((tool) => !tool.name.startsWith(prefix));
  const nextMounts = enabled
    ? [
        ...withoutSource,
        ...listExternalSourceToolMounts(kernel, sourceId)
          .filter((tool) => !withoutSource.some((current) => current.name === tool.name)),
      ]
    : withoutSource;

  const unchanged = nextMounts.length === existing.length
    && nextMounts.every((tool, index) => tool.name === existing[index]?.name);
  if (unchanged) return { changed: false, reason: "no-change" };

  profileService.updateAgentSettings(profile.id, { ...profile.agent, toolMounts: nextMounts });
  return { changed: true, reason: "updated" };
}
