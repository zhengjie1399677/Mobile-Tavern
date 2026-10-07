/**
 * 外部能力（MCP）总开关的运行时门禁。
 *
 * 用户定稿（2026-10-07）：MCP 默认关闭、不强行出现在聊天界面、模型不得自动调用。
 * 设置真值仍保存在 `UserSettings.enableExternalCapabilities`；本模块只是把它投影成
 * 运行时服务可同步读取的门禁位，避免服务层反向依赖设置 Hook 或 React 状态。
 *
 * 默认 false：应用启动、设置尚未加载完成时，绝不能先替用户连一圈外部来源。
 * 设置加载完成、用户在工作台拨动开关时，由装配层调用 `setExternalCapabilitiesEnabled`
 * 并在值变化后触发一次 `runtime.reload()`（开启=连接，关闭=断开）。
 */

let externalCapabilitiesEnabled = false;

/** 当前外部能力是否启用（默认关闭）。 */
export function isExternalCapabilitiesEnabled(): boolean {
  return externalCapabilitiesEnabled;
}

/** 更新门禁位；返回是否发生了变化，便于调用方决定要不要重连。 */
export function setExternalCapabilitiesEnabled(next: boolean): boolean {
  if (externalCapabilitiesEnabled === next) return false;
  externalCapabilitiesEnabled = next;
  return true;
}

/** 仅供测试重置模块状态。 */
export function __resetExternalCapabilityGateForTesting(): void {
  externalCapabilitiesEnabled = false;
}
