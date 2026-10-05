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
  - 2026-09-02：已加入 `official.utility` 本地实用工具包（按软件性质筛掉开发者向工具，只保留角色扮演/跑团/聊天场景）：`/dice` 掷骰（NdM±K）、`/coin` 掷硬币、`/pick` 随机抽取、`/count` 字数统计，四个均为无权限、低风险、无副作用的 turn composer 命令，走 Host Capability（random.dice / random.coin / random.pick / text.count），执行结果直接回填输入框草稿不自动发送。

- [ ] **外部能力通道与 MCP 接入（P0，方向①/③扩展）**：按[外部能力通道与 MCP 接入设计](docs/agents/external_capability_channel_design.md)推进，MCP 只是第一个 Connector 实现，抽象层不得出现协议绑定。
  - 2026-10-05：M0 已落地并通过验证——中立契约 + Connector 注册表 + MCP driver（Streamable HTTP、era 协商、`server/discover`）+ 外部 Schema 收口 + 本地夹具 8/8 + 四条架构守卫；真实远端实测对方是 legacy 世代（2025-11-25）并成功协商回退。驱动尚未接入组合根，接入时必须懒加载（≈328 KB minified / 90 KB gzip）。
  - 2026-10-05：M1 已落地并通过验证——来源配置独立 IndexedDB + 用例门面、`ExternalSourceRuntimeService` 把外部工具投影为 `AgentToolDefinition`（默认 `ask`、副作用 `external`）并扩展组合快照、来源停用后执行立即失败、单来源失败不影响其它来源；设置页插件分区新增「外部能力」子页（新增/启停/删除/探测）。真实构建确认 driver 独立成 chunk（213 KB / gzip 58 KB），主包仅 +5 KB。
  - 2026-10-05：M2a 静态凭据已落地并通过验证——`authHeader`/`authScheme` 非秘密配置 + 独立加密凭据库（来源库 v2，AES-GCM，密钥独立于主库）；默认注入 `Authorization: Bearer`，可自定义头名与 raw；删除来源连带删凭据；设置页可按来源录入/清除凭据。实测夹具在 HTTP 层收到注入头，未配置时不发送认证头，落盘与状态接口均不含明文。
  - M2b 待做：OAuth 2.1（PRM 发现、CIMD 优先 / DCR 回退、Native Adapter 回调、按 issuer 隔离、可选 DPoP）。
  - 2026-10-05：M3a 已落地并通过验证——来源声明资源时派生只读工具 `resources.list`（allow / 无副作用）与 `resources.read`（ask / 外部副作用），读取白名单只接受连接期声明过的 URI（否则 `EXTERNAL_SOURCE_RESOURCE_NOT_ADVERTISED`），重名跳过派生，撤销立即生效。路径收敛规则已写入设计文档：主动取用走工具，系统自动注入才走未来的通用 `context.source`，MCP 资源永不迁入。
  - M3b 待做（需通用缝，明确推迟）：`prompts/*` 用户侧取用与「一键插入草稿」——composer 缝当前为 Tool Plugin 私有，复制会制造第二条路径。
  - M4 待做：MRTR 表单、`ext-tasks` 与 `subscriptions/listen` 变更订阅。
  - 2026-10-05：M3b 已落地——提示词模板经通用输入框命令缝（`ComposerCommandService`）注册为 `mcp.<source>.<prompt>` 命令，用户 `/` 选用、结果只回填草稿不自动发送，撤销立即失效。

- [ ] **通用上下文来源缝（P1，架构工作）**：按[通用上下文来源缝设计](docs/agents/context_source_seam_design.md)分阶段实施。当前 `context.source` 只有兼容插件实现，记忆召回是硬编码单通道，每接一种推送式上下文都要再改一次 prompt 调用链。
  - 2026-10-05：设计已完成并接入路由。关键结论：提示词是每次发送时重算的（`MemoryAuditSnapshot` 明确不写入会话），因此本缝**不引入逐轮冻结**；未注册宏会留下字面量，因此注册表必须为已声明来源补齐空占位；预算继续由 `compilePromptComposition` 裁决，不建第二套。
  - C0 契约 + 注册表 + 并行读取/超时/占位/排序（不接线，对现有提示词完全惰性）。
  - C1 适配器接入 + 记忆召回改为第一个来源（保留 `memory.recalled` 宏名），以逐字节黄金对比守住输出不变。
  - C2 审计泛化；C3 `compat.context-source` 迁移；C4 新来源（知识库、日历、M3b 提示词取用）。

- [ ] **自定义主题工作室后续（P1）**：全屏工作室、独立草稿、隔离预览、核心/高级颜色和保存/应用分离已完成；继续实现起点选择、多场景预览、对比度与 CSS 行列诊断、片段库，以及 Theme 1.1 媒体/状态/规则可视化编辑。

## 中期排期

- [ ] **生态试运行（P2，方向③，路线阶段 E）**：仓库内 Tool Plugin SDK、确定性 `.mttool` 打包器和官方无权限文本工具箱示例已完成；继续评估 SDK 独立发布以及 Provider、Media Processor、Renderer、Context Source 扩展模板。公开目录与审核/撤回流程只保留为条件性事项。
- [ ] **测试覆盖补强（P2）**：补充现有 Hook 测试尚未覆盖的边界，并新增跨组件数据流契约测试，优先检查 `useCharacters`、`useCatbot`、`useSendMessage` 与 Profile/聊天切换；数量以 `npm test` 和 `npm run test:unit` 当次结果为准。
- [ ] **P3-B Store 拆分（P3，条件性）**：先解除 `useSettings` 对 `ChatContext.availableModels` 的反向依赖，再只拆出 Settings；更大范围拆分只有出现明确维护瓶颈时再评估。

## 低优先级与外部条件

- [ ] **测试工具链版本债（条件性）**：`vitest` 停在 `2.1.9`、`happy-dom` 停在 `15.11.7`，两者都是所在主版本的末位，官方安全修复都要求跨主版本，因此无法用补丁升级解决。
  - vitest 告警：critical（`<3.2.6`，条件是 Vitest UI/API server 处于监听状态 —— 我们只用 `vitest run`，不跑 `--ui`，实际不可达）与 moderate（`@vitest/mocker` 重定向 mock 路径穿越，`<4.1.11`）；另外 vitest 2.x 会带出两个嵌套的 `vite@5.4.21`，它们是 high 级 `server.fs.deny` 绕过等条目的来源。
  - happy-dom 告警：critical（VM 逃逸可导致 RCE，`<20.0.0`）与两条 high，修复要求 `>=20.x`；该风险仅在测试环境渲染不可信内容时可触发（仓库测试确实会喂外部角色卡/主题内容），且只存在于开发依赖，不会进入 APK。
  - 环境前置已满足：根 `vite@6.4.3`（vitest 5 要求 `^6.4.0`）、Node 24（要求 `>=22.12.0`）；升级还会顺带移除嵌套的 vite 5。**成本集中在一次跨 3 个主版本的测试代码适配**（3.0 的 `clearMocks` 默认值、4.0 的 DOM 全局赋值语义、5.0 的 `vi.mock` 提升限制与异步断言必须 await 等）。
  - 分级选项：最小清 critical = `vitest@3.2.7`；彻底清 vitest 告警 = `vitest@4.1.11` 或 `5.0.3`；`happy-dom` 无论哪条都必须到 `20.x`。
  - 2026-10-05：按条件挂起。重新评估的触发条件 = 需要新特性、开发机/CI 暴露到不可信输入、或做专项清理时，在隔离分支试升级并统计真实失败数，再决定是否合入。

- [ ] **全仓 ESLint 潜在错误（条件性）**：门禁只 lint **改动文件**，因此以下 18 条既有错误长期潜伏——任何人下次改动这些文件都会被 pre-commit 直接拦下。
  - 11 条 `prefer-const`（自动可修）、3 条 `no-control-regex`（控制字符正则，可用 `\p{Cc}` 或字符码过滤重写）、1 条 `no-extra-boolean-cast`、1 条 `Function` 类型（需换成具体签名）。
  - 涉及 `src/utils/tavernHelper/*` 等；`src/application/services/memory/MemoryRecall.ts` 的 2 条已顺带修复。
  - 2026-10-05：记录为独立清理项，不与功能改动混合。修复后应把「全仓 ESLint」纳入 CI，否则债务会再次静默累积。

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
