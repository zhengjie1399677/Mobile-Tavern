/**
 * 云端后端服务端点集中配置。
 *
 * 收口原本散落在 keyManager.ts / UpdateCheckService.ts / LLMService.ts 的 fcapp.run URL，
 * 便于后续切换环境（dev / staging / prod）或更换函数计算实例名时一处修改。
 *
 * 端点分类：
 * - trial token / key：免 Key 试用模式的临时密钥下发链路
 * - update check：版本更新检查
 * - catbot：LLM 代理（备用聊天通道）
 *
 * 注意：这些 URL 仅在 Tauri 客户端环境下直连云端 fcapp.run；本地 dev server
 * 与浏览器测试环境会回退到 `${origin}/api/...` 由 Express 服务器代理。
 */
export const CLOUD_ENDPOINTS = {
  /** Trial token 签发端点（自签名 JWT，由 keyManager.ts 拉取）。 */
  trialToken: "https://mobile-ue-token-zcslobjkak.cn-hangzhou.fcapp.run",
  /** Trial key 下发端点（AES-GCM 加密，由 keyManager.ts 拉取并解密）。 */
  trialKey: "https://mobile-get-key-uggoeabkfb.cn-hangzhou.fcapp.run",
  /**
   * 版本更新检查端点（由 UpdateCheckService.ts 调用）。
   *
   * 本仓库自有服务器提供，不再依赖阿里云函数计算/OSS：
   * - `latestVersion` / `releaseDate` / `downloadUrl` / `sha256` 全部由服务端从
   *   `downloads` 目录实时推导，发布新 APK 后无需手工维护；
   * - `downloadUrl` 固定为 `https://neural-node.xyz/dl/latest`，永远指向最新版本。
   */
  updateCheck: "https://neural-node.xyz/version.json",
  /** Catbot LLM 代理端点（备用聊天通道，由 LLMService.sendCatbotRequest 调用）。 */
  catbot: "https://catbot-gmkodirnhh.cn-hangzhou.fcapp.run/api/catbot",
} as const;

export type CloudEndpointName = keyof typeof CLOUD_ENDPOINTS;
