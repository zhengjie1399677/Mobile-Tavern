# Mobile Tavern 活跃待办

> 本文件是未完成事项的唯一清单，只记录可执行任务、依赖和当前优先级。
> 当前产品状态见 [CURRENT_STATE.md](docs/agents/CURRENT_STATE.md)，目标路线见
> [插件式 Agent Runtime 与聊天组合路线](docs/agents/agent_plugin_runtime_roadmap.md)，
> 已完成事项见 [2026 年归档](docs/history/TODO_ARCHIVE_2026.md)。

## 当前优先级

- [ ] **社区生产版本对齐（P1）**：部署仓库中的最新 `cloud/minimal-community` 二进制，复验 `/health/deep`、双 SHA-256 去重、评论限流、管理员删除、上传/下载时间戳和测试数据清理。需要服务器发布权限与管理员令牌；本地代码和测试已具备，线上状态尚未在本轮验证。

## 中期排期

- [ ] **External Tool Plugin 来源治理（P2，路线阶段 D）**：本地 L2 已完成 `.mttool`、声明式 HTTPS、一次性受限 Worker、精确依赖检查、加密凭据、Agent Runtime/新会话快照、权限撤销和卸载清理；继续实现签名/可信来源、远程版本撤回与生态审核。仍不开放任意 Runtime Plugin 安装、后台常驻或原生能力。
- [ ] **生态试运行（P2，路线阶段 E）**：阶段 A–D 稳定后，再评估 Tool Plugin SDK、目录、版本固定、审核/撤回流程以及 Provider、Media Processor、Renderer、Context Source 扩展模板。
- [ ] **测试覆盖补强（P2）**：补充现有 Hook 测试尚未覆盖的边界，并新增跨组件数据流契约测试，优先检查 `useCharacters`、`useCatbot`、`useSendMessage` 与 Profile/聊天切换；数量以 `npm test` 和 `npm run test:unit` 当次结果为准。
- [ ] **P3-B Store 拆分（P3，条件性）**：先解除 `useSettings` 对 `ChatContext.availableModels` 的反向依赖，再只拆出 Settings；更大范围拆分只有出现明确维护瓶颈时再评估。

## 低优先级与外部条件

- [ ] **全双工免手触连续语音扮演模式（N）**：本地 Web Wasm VAD、自动发送、播报插话与中断。
- [ ] **局域网 P2P 数据热同步与热迁移（G）**：基于 WebRTC 的本地数据增量备份和跨端迁移。
- [ ] **面向非开发者的 AI 插件创作层**：以双角色或多 NPC 模板生成受控的气泡交互、游戏状态和 LLM 对话，不向用户暴露底层代码权限。
- [ ] **AR 真机重新验收**：等待具备兼容 ARCore 的测试设备；当前入口已隐藏，不能视为已上线。
- [ ] **iOS 适配与验收**：当前产品仅完成 Android 方向的开发和构建，iOS 尚未纳入实施计划。

## 已完成摘要

- 2026-08-28：完成会话管理器数据底座和三分类页面，加入归档删除守卫、权威搜索/批量管理、独立收藏备份、修订落后提示与收藏恢复；单会话导出和用户人设入口继续按专项设计后续实施。
- 2026-08-26：重做多模态附件选择与预览，按图片/视频/音频区分入口和消息展示；完成 External Tool Plugin 本地 L2 执行闭环，后续仅保留签名来源、远程撤回、SDK 与生态审核。
- 2026-08-26：完成内置 `character.read`、需一次性审批的 `session.branch`、Tool 策略/Journal/聊天卡片闭环，并补齐改动文件 ESLint、Dependabot 和 PR 标题门禁。
- 2026-08-25：完成 Agent Host 五阶段当前验收范围，包含 Runtime Profile、Message Content V2、Attachment Data Plane、Agent Spine、Compatibility Runtime 和 Profile UI。
- 2026-08-24：完成 Tool Loop、Agent Journal、音频 ASR、视频关键帧及 Profile 会话恢复的最小纵向闭环。
- 2026-08-06：修复世界书角色导入重启丢失及 catalog 空壳覆盖完整角色数据的问题。

详细历史索引见 [docs/history/TODO_ARCHIVE_2026.md](docs/history/TODO_ARCHIVE_2026.md)。
