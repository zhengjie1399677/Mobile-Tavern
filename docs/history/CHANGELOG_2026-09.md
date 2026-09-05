# 2026 年 9 月变更记录

- 2026-09-02：External Tool Plugin 来源等级调整为提示性策略：无签名包仍可安装，导入入口和确认页会按未验证、未知有效签名、可信与官方来源解释代码及后续授权风险；无效来源证明仍拒绝，Manifest、Worker/Sandbox、权限与高风险单次审批边界保持不变。签名工具、密钥轮换、远程撤回和后台服务暂不实现。
- 2026-09-02：External Tool Plugin 新增严格 `provenance.json` 来源证明和 ECDSA P-256/SHA-256 WebCrypto 验签，证明绑定插件 ID、版本、内容哈希、签名者 ID 与 SPKI 公钥；安装界面区分未验证、未知有效签名、可信指纹和官方内置来源，旧记录安全降级，篡改、身份错配与可信 ID 换钥均拒绝。
- 2026-09-02：新增仓库内 Tool Plugin 作者 SDK、确定性 `.mttool` 打包器和官方无权限文本工具箱示例；SDK 暂未独立发布，也不保存或分发签名私钥。
- 2026-09-01：建立 `mobile-tavern.agent-profile` v1 文件级粘合契约，Runtime Profile 可保存小型角色/Prompt 引用、Tool 身份和有限采样参数；导入生成新 ID 并报告来源冲突、缺失依赖和 Tool 版本漂移，严格排除 API Key、令牌、角色卡/Prompt 正文与插件包，旧 Base/Tavern Profile 保持原有降级行为。

- 2026-09-05：基于 v1.8.9 的持续审查修复了预设并发及内容隔离、Prompt 编辑和历史正则、世界书递归与时效持久化、主题 ZIP 往返和回滚、SDK 可选字段哈希及 iframe 计时器兼容；按功能提交，局部回归通过，完整审查与最终推送结果见 [审查记录](CODE_REVIEW_2026-09-05.md)。
