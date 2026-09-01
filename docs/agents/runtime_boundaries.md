# 运行时模块边界

本文用于回答 Kernel、兼容运行时、存储层、插件 RPC 和原生适配器为什么同时存在。它们面向不同变化源，不属于同一套服务体系。新增代码必须先判断所属边界，不得为了调用方便跨层互引。

## 一、权威路径

| 能力 | 权威入口 | 职责 | 禁止事项 |
|---|---|---|---|
| Kernel 通用机制 | `src/kernel/index.ts`、`src/kernel/types.ts`、`src/kernel/EffectScope.ts` | 容器、服务生命周期、父子 Scope、可撤销 Effect、消息总线、Pipeline 与扩展契约 | 不放任何应用服务、业务装配、生态格式、存储或平台调用 |
| 应用运行时组合 | `src/application/runtime.ts`、`src/application/runtimePlugins/`、`src/application/bootstrap/` | 解析受信 Runtime Profile，以插件子 Scope 把应用服务、默认 Pipeline 和类型化 Capability 装配到 Kernel | 不反向改变 Kernel 的通用机制，不执行用户安装的任意代码，不把插件配置或秘密写入解析快照；配置必须先过插件 Zod Schema，Slot/Provider 冲突必须在产生 Effect 前失败 |
| Runtime Profile 管理 | `src/application/runtimeProfiles/`、`RuntimeProfileService.ts`、`src/infrastructure/runtimeProfiles/` | 校验并持久化公开 Profile 选择、复制、能力开关和小型 Agent 粘合引用，生成当前受信组合并提供脱敏诊断 | 不保存 API Key、角色卡/Prompt 正文、Blob 或服务实例；UI 不直接访问 `localStorage`；不开放任意 Runtime Plugin 安装 |
| 通用数据库服务 | `src/application/services/DatabaseService.ts` | 面向上层提供通用 CRUD、分页、轻量索引统计与跨 Store 事务能力 | 不承载记忆召回、摘要或角色行为 |
| IndexedDB 物理实现 | `src/infrastructure/storage/` | 连接、Schema、事务队列、仓库和端口适配器 | 不反向导入 `src/utils/localDB.ts` |
| 数据迁移应用服务 | `src/application/services/DataMigrationService.ts` | 聚合完整备份、统一脱敏，并委托基础设施以单事务覆盖用户数据 | 不在 React Hook 中直接清 Store 或跨 Repository 编排恢复 |
| 会话管理应用服务 | `src/application/services/SessionManagementService.ts` | 查询权威会话目录，编排归档、收藏备份更新、恢复和归档后永久删除 | 不把收藏载荷塞入 sessions/settings，不允许 UI 直连备份 Store，不绕过 archived 删除守卫 |
| 收藏会话备份存储 | `src/infrastructure/sessionBackups/sessionBackupStorage.ts` | 在独立数据库保存收藏元数据与不可变备份版本，执行 SHA-256 回读校验和指针切换 | 不保存 API Key、全局设置或其他会话数据；不被 React 直接调用 |
| 冻结的存储兼容门面 | `src/utils/localDB.ts` | 旧版外部导入兼容与测试重置 | 不允许任何生产调用或新增导出；兼容期结束后删除 |
| Compatibility Host | `src/application/compatibility/`、`CompatibilityRuntimeService.ts` | 提供无生态语义的 Codec、Prompt Section、Context Source、Transform、State Reducer、Renderer 注册与撤销机制 | 不实现 SillyTavern 语义，不依赖 React，不执行用户安装代码 |
| SillyTavern Compatibility Runtime Plugin | `sillyTavernCompatibilityRuntimePlugin.ts`、`src/compatibility/sillytavern/` | 以受信 Profile Scope 注册角色卡扩展、MVU、正则脚本、预设 Codec 和 iframe 兼容实现 | 不进入 Kernel，不承载通用存储或原生能力，不与 `.mtplugin` 沙箱合并 |
| Plugin Host RPC | `src/domain/plugins/pluginHostRpc.ts` | 强沙箱插件的权限校验、输入清洗和脱敏 RPC | 不复用 Compatibility Runtime，不直接访问原生平台 |
| Native Adapter | `src/services/ar/NativeArAdapter.ts` | 将 Web 调用适配为 Tauri/Kotlin AR 命令 | 不承载第三方插件权限或角色卡兼容逻辑 |
| 应用用例层 | `src/application/useCases/` | 业务初始化、分页、级联流程和跨 Service 协调 | 不保存 React State，不直接渲染界面 |
| 本地界面资源服务 | `src/application/services/LocalResourceService.ts` | 校验用户导入的图片、视频与音频，管理受控 Blob URL 和 CSS 资源变量 | 不把媒体字节写入 settings，不开放任意远程 URL |
| 本地界面资源存储 | `src/infrastructure/resources/localResourceStorage.ts` | 在独立数据库中物理分轨资源元数据与文件字节 | 不被 React 组件直接调用，不与插件包存储混用 |
| 消息附件应用服务 | `src/application/services/AttachmentService.ts` | 校验附件魔数与配额，管理引用状态、备份字节和受控 Blob URL | 不承载 Provider 方言，不借用主题资源数据库 |
| 消息附件存储 | `src/infrastructure/attachments/attachmentStorage.ts` | 在独立数据库中分轨消息附件元数据和字节，执行引用重建与 GC | 不被 React Hook/组件直接调用，不把媒体塞入主消息记录 |
| 多模态 Provider 投影 | `src/application/useCases/multimodalProviderProjection.ts` | 把通用 Content Parts 按已确认能力投影为请求方言 | 不修改领域消息，不把 Provider 格式持久化 |
| LLM Provider 兼容层 | `src/application/services/llmCompatibility/` | 解析端点与模型族，裁剪请求能力、适配思考回放、归一化流式响应，并按完整端点隔离运行时能力学习 | 不进入 Kernel，不持久化 Provider 方言到领域消息，不在 Hook、Prompt 或记忆模块复制厂商分支 |
| Prompt 预设与组装 | `src/application/useCases/presetPromptConfig.ts`、`src/application/services/prompt/` | 将新旧 Mobile Tavern 与外部 Codec 产物收口为版本化预设快照，经中立编排、请求整形和最终预算审计生成唯一消息包 | 不在 React Hook 解释外部预设语义，不让旧预设继承其他预设模式，不在发送/重生成中二次拼装 Prompt |
| Agent Runtime 主干 | `src/application/services/AgentRuntimeService.ts`、`src/application/services/agents/`、`src/domain/agents/`、`src/application/useCases/openAiToolLoop.ts` | 管理 AgentHandle、Turn、Driver、Provider、有限多步 Tool Loop、媒体 Processor、权限、一次性审批、取消与诊断 | 不进入 Kernel，不持有 React State，不绕过 Turn 直接执行 Tool，不执行用户安装的任意代码；审批宿主缺失时必须 fail-closed |
| Agent Journal 存储 | `src/infrastructure/agents/agentJournalStorage.ts` | 物理分轨持久化 Turn、Provider/媒体决定与 Tool Call/Result | 不保存插件配置或凭据，不塞入 sessions/messages 大对象 |
| Tool Plugin 管理用例 | `src/application/useCases/toolPluginManagementUseCases.ts` | 解析和安装受控 Manifest/`.mttool`，编排来源验签、授权、凭据、停用、回滚与卸载 | 不直接注册 Tool，不把管理状态混入 Runtime Profile 或 `.mtplugin`，不把包内自声明公钥直接提升为可信来源 |
| Tool Plugin 来源验证 | `src/infrastructure/toolPlugins/toolPluginSourceVerifier.ts`、`src/config/toolPluginTrustPolicy.ts` | 以 WebCrypto 校验 ECDSA P-256/SHA-256 包签名，并把签名有效性与宿主信任等级分开判定 | 不读取私钥，不从插件包或网络响应动态添加可信签名者，不把未知签名显示为可信 |
| Tool Plugin Runtime | `src/application/services/ToolPluginRuntimeService.ts`、`src/application/toolPlugins/hostCapabilityExecutor.ts` | 校验兼容性和依赖、注册 External Tool、执行前重查授权、扩展新会话组合快照，并把白名单 Host Capability 代理到类型化应用服务 | 不执行 `.mtplugin`，不向外部代码暴露 Kernel、存储或明文凭据；Host handler 不执行插件代码且不得绕过 Tool 单次审批 |
| Tool Plugin 执行适配 | `src/infrastructure/toolPlugins/toolPluginHttpClient.ts`、`browserToolPluginExecutor.ts` | 代理受限 HTTPS 请求并运行一次性 Worker | 不允许 Worker 直接联网、持久化、创建子 Worker、动态加载或后台常驻 |
| Tool Plugin 管理存储 | `src/infrastructure/toolPlugins/toolPluginStorage.ts` | 在独立数据库保存 Manifest、Artifact、加密凭据、授权状态与有限版本历史 | 不被 React 直连，不与 `.mtplugin` 包数据库混用；凭据不进入 Manifest 或会话快照 |
| 浏览器视频关键帧适配 | `src/infrastructure/media/browserVideoFrameExtractor.ts` | 在 WebView 边界解码本地视频并生成有限 JPEG 关键帧 | 不参与 Profile 解析，不直接写会话或消息 |
| 主题交互应用服务 | `src/application/services/ThemeInteractionService.ts` | 解释主题 1.1 白名单事件、条件与动作，维护有限状态、冷却和延迟任务 | 不接触 DOM、存储、网络或业务数据，不执行主题代码 |
| 主题媒体宿主 | `src/components/theme-interactions/ThemeInteractionHost.tsx` | 把稳定 `data-ui` 事件、生命周期和三个背景 Surface 适配到主题服务，并解析本地媒体 | 不向主题暴露元素引用，不接受远程 URL 或任意选择器 |

## 二、允许的数据方向

```text
界面与业务组合
  ├─→ application/runtime ─→ Runtime Profile/Plugin Scope ─→ Kernel 通用机制
  ├─→ React Context ─→ application/useCases ─→ 应用 Service
  ├─→ 应用 Service ─→ Repository/Adapter ─→ infrastructure/storage
  ├─→ LocalResourceService ───────────────→ infrastructure/resources
  ├─→ AttachmentService ─────────────────→ infrastructure/attachments
  ├─→ SessionManagementService ──────────→ infrastructure/sessionBackups
  ├─→ Chat Use Case ─→ Provider Projection ─→ AttachmentService（按需读取字节）
  ├─→ Chat UI ─→ AgentHandle ─→ Driver ─→ Provider/Tool/Media Processor
  │                                  └─→ LLM Provider 兼容层 ─→ LLMService/ChatStreamService
  │                                  ├─→ Agent Journal Port ─→ infrastructure/agents
  │                                  └─→ Attachment/ASR/视频关键帧 Adapter
  ├─→ Tool Plugin 设置 UI ─→ 管理用例 ─→ 来源验证/管理存储 ─→ infrastructure/toolPlugins
  │                              └→ Tool Plugin Runtime ─→ 白名单 Host Capability ─→ MemoryService ─→ 记忆领域端口
  ├─→ ThemeInteractionHost ─→ ThemeInteractionService ─→ 主题私有运行态
  │                        └→ LocalResourceService（只解析已声明本地媒体）
  ├─→ 记忆领域端口 ───────────────────────→ IndexedDbMemoryPersistenceService
  ├─→ Compatibility Host ─→ 受信 Compatibility Runtime Plugin ─→ SillyTavern 实现
  ├─→ Plugin Host RPC
  └─→ Native Adapter ─→ Tauri IPC
```

`localDB.ts` 的仓库内生产调用已经清零。它只为尚未迁移的外部导入和测试重置保留，不再处于正常数据方向上。后续确认不存在外部依赖后应直接删除。

## 三、会话聚合与消息窗口

- `sessions` Store 只保存 `ChatSessionMetadata`、摘要和内部计数基线；旧记录中的内嵌 `messages` 读取时必须丢弃。
- `messages` Store 是消息正文的唯一权威来源。消息的展示字段、重生成字段和状态快照统一经过 `messageRecord.ts` 映射，禁止写入路径各自挑选字段。
- V2 消息以 Content Parts 为唯一权威内容，`Message.content` 只作为兼容文本投影；附件只保存 `att_*` 引用，物理字节进入独立 Attachment 数据库。
- React 内部将会话元数据与已水合的 `ChatMessageWindow` 分开保存；对外兼容的 `ChatSession` 视图只是投影，不得反向作为全量历史写回数据库。
- 虚拟列表只减少 DOM 渲染量；消息分页通过最早消息 ID 对应的绝对 `turnIndex` 游标读取。会话目录默认通过 `(createdAt, id)` 游标读取，用户选择其他排序时使用 `(sortKey, id)` 游标；禁止使用会受并发新增影响的数字 offset 作为持续分页边界。
- 应用消息新增、编辑、删除或替换统一经过 `commitSessionTurn`、`updateSessionMessage`、`deleteSessionMessage`、`replaceSessionBranch` 跨 Store 事务；低层记忆消息原语不得顺带维护会话统计。
- 自动总结必须在本轮消息事务提交后读取权威消息 Store；不能在输出中间件尚未持久化助手回复时推进摘要边界。
- 角色删除不得绕过会话归档与永久删除守卫；只要仍存在关联会话，Character Service 必须拒绝删除并引导用户先在会话管理器中处理，会话及其记忆分轨只由会话删除事务级联清理。
- 备份恢复的 `replaceCompleteSessions` 是完整替换语义：同一事务内先清理旧消息，再写入最终消息并重算统计，禁止保留旧尾部；普通 UI 分页会话不得调用。
- 消息事务完成后由 Database Service 串行扫描权威消息记录并重建附件反向引用；主库与附件库跨库提交使用可恢复状态补偿，不能伪装成单个 IndexedDB 原子事务。
- Prompt 组装必须根据编排配置从数据库读取权威历史窗口；即使编排不发送聊天历史，也要为世界书触发保留独立受控扫描窗口。重生成必须传入目标消息边界，不能使用当前 UI 分页切片。
- 每次完成助手输出后，把变量和状态表快照绑定到该消息。重生成与历史分支优先恢复最近完整快照；旧 MVU 消息只作为变量降级来源，缺失的旧状态表不得伪造为可回放结果。
- 插件私有会话状态只持久化到 `runtimePluginState[pluginId]`。旧 `session.variables` 只在 Compatibility Plugin 边界作为读取降级或瞬时 Bridge 投影，不得由通用写路径继续双写。
- 会话 Composition Snapshot 与当前 Profile 不一致时，跨 Profile 恢复必须先验证目标 ID 和精确版本，再以一次性意图重启；目标组合装载后从权威存储恢复会话，缺失或漂移时明确失败且不得循环重启。

## 四、适配边界命名

- Compatibility Runtime：外部角色卡脚本生态与应用内部类型边界。
- Plugin Host RPC：强沙箱 iframe 与宿主权限边界。
- Native Adapter：Web 前端与 Android 原生能力边界。

旧 Bridge 名称仅作为兼容导出保留。三者的协议、信任等级和生命周期均不同，禁止合并为统一 Service 或统一 Bridge 基类。

## 五、回归守卫

`tests/suites/architectureBoundaries.test.ts` 固化以下约束：

1. 记忆领域不得绕过 `MemoryPersistencePort`。
2. `infrastructure/storage` 不得反向依赖 `localDB` 兼容门面。
3. `src/` 生产代码不得导入 `localDB`，该门面不得重新出现 IndexedDB 物理实现。
4. Compatibility Runtime、Plugin Host RPC、Native Adapter 不得相互导入。
5. `src/kernel/` 不得重新出现业务服务、页面业务、应用装配目录或对应用层的反向依赖。
6. React Context 不得直接访问存储、Compatibility Runtime、Native Adapter 或执行业务 Service 的持久化方法。
7. Runtime Plugin/Profile 契约只能位于 Application 层；应用组合根必须通过 Profile Loader 装载 legacy runtime，不能恢复散落的直接注册路径。
8. Agent、Provider、Tool 与媒体 Processor 契约只能位于 Domain/Application 层；Kernel 不得出现 Agent 业务语义，聊天发送必须经 AgentHandle 进入 `mobile-tavern.chat.driver`。
9. Agent Journal 必须使用独立数据库并通过应用服务访问；React、Driver 和 Tool 不得直连其 IndexedDB 实现。
10. 通用生产代码不得直接导入 `compatibility/sillytavern` 或读写 TavernHelper 全局字段；只有内置 Compatibility Runtime Plugin 可以连接实现，`base` Profile 必须不装载它。
11. Profile 启动偏好是公开、类型化的小对象，只能通过 Runtime Profile Service/Infrastructure Port 读写；损坏、缺失 Provider 或找不到 Profile 时必须返回诊断并安全回退，不能把秘密并入 Profile。
12. Runtime Plugin 配置必须由 Zod Schema 校验，Capability Token/Provider 冲突必须在装载前失败；模型 Tool Call 必须经有限 Step Loop 和 Agent Turn 执行边界。
13. 跨 Profile 会话恢复必须使用 Schema 校验的一次性意图；兼容会话状态必须单写插件命名空间，旧 `session.variables` 不得恢复为通用持久化路径。
14. Tool Plugin 管理必须使用独立数据库并经应用用例访问；运行只能由独立 `ToolPluginRuntimeService` 注册到 Agent Runtime。Worker 网络必须经宿主精确白名单代理，权限或必需凭据撤销必须立即阻止旧 Tool 闭包继续执行。包签名必须在安装审阅边界验证，包内公钥只能证明签名一致性，可信等级只能来自宿主固定策略或随 App 分发的内置目录。
15. LLM Provider 的端点识别、能力裁剪、思考回放与响应归一化必须集中在 `llmCompatibility`；`LLMService` 和 `ChatStreamService` 只通过该边界收发数据，旧记忆路径只允许兼容导出。
16. Agent/Profile Bundle 必须留在 Application 契约与用例边界，以严格 Schema 和公开字段白名单导入导出；Runtime Profile 持久化只接收小型引用和采样参数，不得携带角色卡/Prompt 正文、插件包或凭据。

若确需改变这些方向，应先更新本文件与 `TECHNICAL.md`，说明新边界及迁移策略，再修改守卫。
