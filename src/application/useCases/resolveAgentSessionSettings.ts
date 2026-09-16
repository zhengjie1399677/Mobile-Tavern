import type { AgentCompositionSnapshot } from "../../domain/agents/contracts";
import type { UserSettings } from "../../types";
import { readAgentSettingsFromComposition } from "../runtimeProfiles/agentSettings";

/**
 * 解析本次请求使用的设置。
 *
 * 不变量：会话快照只冻结 Agent 身份与 Tool 可见性（见 `docs/agents/module_contracts.md`
 * 的 Tool 冻结契约），**不得**用它覆盖提示词、编排、采样或预设正则。
 *
 * 理由：预设是用户随时会切换与迭代的东西。一旦会话按快照覆盖配置，用户在设置页
 * 换的预设就不会进入请求，表现成"开关/切换没用"；而"可复现"由身份冻结与 Agent
 * Journal 承担，不需要靠锁死配置。Agent Profile 绑定的行为预设与采样改为启动时
 * 一次性套用（见 `RuntimeProfileManagerSection`）。
 *
 * 快照畸形时仍然 fail-closed，避免静默按错误配置发送。
 */
export function resolveAgentSessionSettings(
  settings: UserSettings,
  snapshot: AgentCompositionSnapshot | undefined,
): UserSettings {
  readAgentSettingsFromComposition(snapshot);
  return settings;
}
