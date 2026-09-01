# 2026 年 9 月变更记录

- 2026-09-02：External Tool Plugin 新增严格 `provenance.json` 来源证明和 ECDSA P-256/SHA-256 WebCrypto 验签，证明绑定插件 ID、版本、内容哈希、签名者 ID 与 SPKI 公钥；安装界面区分未验证、未知有效签名、可信指纹和官方内置来源，旧记录安全降级，篡改、身份错配与可信 ID 换钥均拒绝。
- 2026-09-02：新增仓库内 Tool Plugin 作者 SDK、确定性 `.mttool` 打包器和官方无权限文本工具箱示例；SDK 暂未独立发布，也不保存或分发签名私钥。
- 2026-09-01：建立 `mobile-tavern.agent-profile` v1 文件级粘合契约，Runtime Profile 可保存小型角色/Prompt 引用、Tool 身份和有限采样参数；导入生成新 ID 并报告来源冲突、缺失依赖和 Tool 版本漂移，严格排除 API Key、令牌、角色卡/Prompt 正文与插件包，旧 Base/Tavern Profile 保持原有降级行为。
