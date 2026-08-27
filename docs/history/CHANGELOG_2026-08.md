# 2026 年 8 月变更记录

- 2026-08-26：多模态附件改为图片、视频、音频独立入口和分类预览/消息展示；新增受控 Tool Plugin Manifest 管理面，支持 SHA-256 校验、来源审阅、逐项授权、停用、回滚清权与完整卸载，外部执行仍保持关闭。
- 2026-08-26：External Tool Plugin 补齐本地 L2：新增 `.mttool` v2 包、声明式 HTTPS Tool、一次性受限 Worker、宿主网络白名单与流量配额、加密凭据注入、Agent Runtime 注册和会话快照；权限或必需凭据撤销会立即阻止旧执行闭包，后台常驻、原生能力、签名来源与远程撤回仍未开放。
- 2026-08-26：Base/Tavern Profile 新增真实内置 `character.read` 与 `session.branch`；Tool 契约补充风险、副作用、执行 Scope 和 `allow` / `deny` / `ask`，聊天内支持一次性允许/拒绝，取消、超时与审批宿主不可用均 fail-closed，全部决定复用 Agent Journal 和 v6 备份。
- 2026-08-26：质量门禁新增相对目标分支/工作区的改动文件 ESLint、pre-commit 暂存 TS/TSX ESLint、PR 语义化标题校验，以及 npm/GitHub Actions Dependabot；远端 `main` 分支保护需仓库管理员在 GitHub 设置中启用。
