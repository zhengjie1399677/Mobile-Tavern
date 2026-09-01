import type { ToolPluginTrustedSigner } from "../domain/toolPlugins";

export interface ToolPluginTrustPolicy {
  readonly trustedSigners: readonly ToolPluginTrustedSigner[];
}

export const toolPluginTrustPolicy: ToolPluginTrustPolicy = Object.freeze({
  // 外部签名者必须通过发布流程审阅并固定公钥指纹，不能从插件包或网络响应动态加入。
  trustedSigners: Object.freeze([]),
});
