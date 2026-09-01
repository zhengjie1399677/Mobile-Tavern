# Mobile Tavern 活跃待办

> 本文件是未完成事项的唯一清单，只记录可执行任务、依赖和当前优先级。
> 当前产品状态见 [CURRENT_STATE.md](docs/agents/CURRENT_STATE.md)，目标路线见
> [插件式 Agent Runtime 与聊天组合路线](docs/agents/agent_plugin_runtime_roadmap.md)，
> 已完成事项见 [2026 年归档](docs/history/TODO_ARCHIVE_2026.md)。

## 当前优先级

> 方向映射见[产品方向](docs/agents/product_direction.md)：①能力积木层 ②自定义闭环 ③扩展通道。三缺口（工具实例少、Profile 不可导出、无 SDK/示例）依次对应这三块。

- [ ] **自定义 Agent 闭环（P0，方向②）**：把「定义 Agent = 选角色 + 挂工具 + 调行为」做成可存、可改、可文件级分享的最小闭环，补齐「Profile 不可导出」这一结构性缺口。`mobile-tavern.agent-profile` v1 的小型粘合契约、严格导入导出、凭据隔离、依赖诊断和旧 Profile 降级已完成；下一步接入文件入口与新手引导式表单，并让角色、Tool、行为选择进入实际新会话组合。验收：同一份定义可在另一台设备复现完整 Agent，普通用户不查文档能完成一次定义与导出。

- [ ] **能力积木层扩充（P1，方向①）**：内置 Tool 从 2 个补齐联网、记忆写入、图像、TTS、日历等外部能力实例，media processor 从 2 个同步扩充；优先联网与记忆写入，其余按需。全部走 External Tool Plugin 框架，不进 Kernel。

- [ ] **自定义主题工作室后续（P1）**：全屏工作室、独立草稿、隔离预览、核心/高级颜色和保存/应用分离已完成；继续实现起点选择、多场景预览、对比度与 CSS 行列诊断、片段库，以及 Theme 1.1 媒体/状态/规则可视化编辑。

## 中期排期

- [ ] **External Tool Plugin 来源治理（P2，方向③，路线阶段 D）**：本地 L2 已完成 `.mttool`、声明式 HTTPS、一次性受限 Worker、精确依赖检查、加密凭据、Agent Runtime/新会话快照、权限撤销和卸载清理；继续实现签名/可信来源、远程版本撤回与生态审核。仍不开放任意 Runtime Plugin 安装、后台常驻或原生能力。
- [ ] **生态试运行（P2，方向③，路线阶段 E）**：阶段 A–D 稳定后，再评估 Tool Plugin SDK、目录、版本固定、审核/撤回流程以及 Provider、Media Processor、Renderer、Context Source 扩展模板。
- [ ] **测试覆盖补强（P2）**：补充现有 Hook 测试尚未覆盖的边界，并新增跨组件数据流契约测试，优先检查 `useCharacters`、`useCatbot`、`useSendMessage` 与 Profile/聊天切换；数量以 `npm test` 和 `npm run test:unit` 当次结果为准。
- [ ] **P3-B Store 拆分（P3，条件性）**：先解除 `useSettings` 对 `ChatContext.availableModels` 的反向依赖，再只拆出 Settings；更大范围拆分只有出现明确维护瓶颈时再评估。

## 低优先级与外部条件

- [ ] **全双工免手触连续语音扮演模式（N）**：本地 Web Wasm VAD、自动发送、播报插话与中断。
- [ ] **局域网 P2P 数据热同步与热迁移（G）**：基于 WebRTC 的本地数据增量备份和跨端迁移。
- [ ] **面向非开发者的 AI 插件创作层**：以双角色或多 NPC 模板生成受控的气泡交互、游戏状态和 LLM 对话，不向用户暴露底层代码权限。
- [ ] **AR 真机重新验收**：等待具备兼容 ARCore 的测试设备；当前入口已隐藏，不能视为已上线。
- [ ] **iOS 适配与验收**：当前产品仅完成 Android 方向的开发和构建，iOS 尚未纳入实施计划。

## 已完成摘要

- 2026-08-29：完成自定义主题工作室阶段一，加入独立草稿、隔离预览、离开保护、响应式分区编辑和保存/应用分离，并保留 Theme 1.0/1.1 高级能力。
- 2026-08-28：完成会话管理器数据底座和三分类页面，加入归档删除守卫、权威搜索/批量管理、独立收藏备份、修订落后提示与收藏恢复；单会话导出和用户人设入口继续按专项设计后续实施。
- 2026-08-26：重做多模态附件选择与预览，按图片/视频/音频区分入口和消息展示；完成 External Tool Plugin 本地 L2 执行闭环，后续仅保留签名来源、远程撤回、SDK 与生态审核。
- 2026-08-26：完成内置 `character.read`、需一次性审批的 `session.branch`、Tool 策略/Journal/聊天卡片闭环，并补齐改动文件 ESLint、Dependabot 和 PR 标题门禁。
- 2026-08-25：完成 Agent Host 五阶段当前验收范围，包含 Runtime Profile、Message Content V2、Attachment Data Plane、Agent Spine、Compatibility Runtime 和 Profile UI。

详细历史索引见 [docs/history/TODO_ARCHIVE_2026.md](docs/history/TODO_ARCHIVE_2026.md)。
