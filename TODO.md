# Mobile Tavern 活跃待办

> 本文件是未完成事项的唯一清单，只记录可执行任务、依赖和当前优先级。
> 当前产品状态见 [CURRENT_STATE.md](docs/agents/CURRENT_STATE.md)，目标路线见
> [插件式 Agent Runtime 与聊天组合路线](docs/agents/agent_plugin_runtime_roadmap.md)，
> 已完成事项见 [2026 年归档](docs/history/TODO_ARCHIVE_2026.md)。

## 当前优先级

> 方向映射见[产品方向](docs/agents/product_direction.md)：①能力积木层 ②自定义闭环 ③扩展通道。三项初始缺口已完成最低闭环，当前继续按需扩充实例并推进轻量生态试运行。

- [x] **自定义 Agent 闭环（P0，方向②）**：已把「定义 Agent = 选角色 + 挂工具 + 调行为」做成可存、可改、可文件级分享的最小闭环。`mobile-tavern.agent-profile` v1 提供严格导入导出、凭据隔离、依赖诊断和旧 Profile 降级；设置页已接入 Android/Web 文件入口与引导式表单，角色、Tool、行为和采样进入新会话不可变组合，缺失依赖与版本漂移 fail-closed。

- [ ] **能力积木层扩充（P1，方向①）**：内置 Tool 从 2 个补齐联网、记忆写入、图像、TTS、日历等外部能力实例，media processor 从 2 个同步扩充；优先联网与记忆写入，其余按需。全部走 External Tool Plugin 框架，不进 Kernel。
  - 2026-09-02：已加入首个官方预置能力实例 `official.brave-search`。它通过 External Tool Plugin 的固定 HTTPS Origin、加密凭据注入、单次审批和流量配额提供网页搜索，默认未安装、未授权且未启用；下一步补 `memory.write`。
  - 2026-09-02：已加入 `official.memory`，通过 Manifest 白名单 Host Capability 把 `memory.write` 接到 `MemoryService`；每次写入均需高风险单次审批，并绑定当前会话来源消息，来源缺失时 fail-closed。联网与记忆写入两项优先能力已完成，其余能力按需继续。

- [ ] **自定义主题工作室后续（P1）**：全屏工作室、独立草稿、隔离预览、核心/高级颜色和保存/应用分离已完成；继续实现起点选择、多场景预览、对比度与 CSS 行列诊断、片段库，以及 Theme 1.1 媒体/状态/规则可视化编辑。

## 中期排期

- [ ] **生态试运行（P2，方向③，路线阶段 E）**：仓库内 Tool Plugin SDK、确定性 `.mttool` 打包器和官方无权限文本工具箱示例已完成；继续评估 SDK 独立发布以及 Provider、Media Processor、Renderer、Context Source 扩展模板。公开目录与审核/撤回流程只保留为条件性事项。
- [ ] **测试覆盖补强（P2）**：补充现有 Hook 测试尚未覆盖的边界，并新增跨组件数据流契约测试，优先检查 `useCharacters`、`useCatbot`、`useSendMessage` 与 Profile/聊天切换；数量以 `npm test` 和 `npm run test:unit` 当次结果为准。
- [ ] **P3-B Store 拆分（P3，条件性）**：先解除 `useSettings` 对 `ChatContext.availableModels` 的反向依赖，再只拆出 Settings；更大范围拆分只有出现明确维护瓶颈时再评估。

## 低优先级与外部条件

- [ ] **全双工免手触连续语音扮演模式（N）**：本地 Web Wasm VAD、自动发送、播报插话与中断。
- [ ] **局域网 P2P 数据热同步与热迁移（G）**：基于 WebRTC 的本地数据增量备份和跨端迁移。
- [ ] **面向非开发者的 AI 插件创作层**：以双角色或多 NPC 模板生成受控的气泡交互、游戏状态和 LLM 对话，不向用户暴露底层代码权限。
- [ ] **公开第三方 Tool 生态治理（条件性）**：仅在准备开放公开目录或出现实际安全事件响应需求时，再立项签名工具、签名者轮换、远程撤回、审核和发布后台；当前来源等级只作风险提示，不放宽权限、隔离和审批边界。
- [ ] **AR 真机重新验收**：等待具备兼容 ARCore 的测试设备；当前入口已隐藏，不能视为已上线。
- [ ] **iOS 适配与验收**：当前产品仅完成 Android 方向的开发和构建，iOS 尚未纳入实施计划。

## 已完成摘要

- 2026-09-02：External Tool Plugin 来源信任收敛为提示性策略；未验证包仍可安装，导入入口与确认页明确告知作者、代码和后续授权风险，远程撤回与动态信任治理改为公开生态的条件性事项。
- 2026-09-02：完成 Tool Plugin 来源证明与包验签基线，严格绑定插件身份、内容哈希和签名者公钥，区分未知有效签名、可信指纹与官方内置来源；旧记录降级且版本历史不丢失。
- 2026-09-02：完成仓库内 Tool Plugin 作者 SDK 与官方文本工具箱示例，覆盖 v2 Manifest/Worker 类型、确定性打包、可安装产物和运行时契约一致性测试；后续按需评估独立发布与更多扩展模板。
- 2026-08-29：完成自定义主题工作室阶段一，加入独立草稿、隔离预览、离开保护、响应式分区编辑和保存/应用分离，并保留 Theme 1.0/1.1 高级能力。
- 2026-08-28：完成会话管理器数据底座和三分类页面，加入归档删除守卫、权威搜索/批量管理、独立收藏备份、修订落后提示与收藏恢复；单会话导出和用户人设入口继续按专项设计后续实施。

详细历史索引见 [docs/history/TODO_ARCHIVE_2026.md](docs/history/TODO_ARCHIVE_2026.md)。
