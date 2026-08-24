# 插件式 Agent Runtime 与聊天组合路线

> 本文定义 Mobile Tavern 从当前模块化应用演进为插件式移动端 Agent Host 的目标架构、聊天组合模型、迁移阶段和验收条件。
> 它描述目标态，不放宽 `AGENTS.md`、`runtime_boundaries.md` 中仍然生效的当前边界；每一阶段只有在代码、迁移和守卫同时完成后，才能更新当前边界。

## 一、目标成品

Mobile Tavern 的目标定位是本地优先、移动端原生混合、多模态、可组合的 Agent Host。

- Kernel 只提供容器、生命周期、Scope、可撤销 Effect、Pipeline、消息总线、注册和校验机制。
- Agent、聊天、Prompt、工具、记忆、媒体和模型 Provider 都是 Kernel 之上的领域能力。
- SillyTavern 角色卡、预设、世界书格式、MVU、Regex、TavernHelper 和兼容 iframe 组成可关闭的内置 Compatibility Runtime Plugin。
- 当前 `.mtplugin` 继续作为不可信全屏沙箱插件，不与受信 Runtime Plugin 共用执行权限或生命周期协议。
- 用户通过 Chat Profile 选择一组能力组合；同一底座可以组成 Tavern 角色扮演、通用助手、语音陪伴或其他 Agent 形态。

目标结构：

```text
Mobile UI
  └─ AgentHandle
      └─ Agent Runtime
          ├─ Session Log / Projection
          ├─ Agent Driver / Tool Loop
          └─ Capability Seams
              ├─ LLM / Prompt / Context / Memory
              ├─ Attachment / Media Processor
              ├─ Tool / Renderer / Native Adapter
              └─ Compatibility Runtime Plugin
                  └─ Scoped Effects
                      └─ Microkernel
```

## 二、插件类型与信任边界

“插件化”不代表所有插件拥有相同权限。目标态固定区分三类：

| 类型 | 来源 | 执行位置 | 可访问能力 | 典型内容 |
|---|---|---|---|---|
| Runtime Plugin | 随 App 编译或受信发布 | 应用进程 | 仅通过注入的类型化能力 | Agent Driver、LLM Provider、Memory、SillyTavern Compatibility |
| Worker Plugin | 随 App 编译的受控后台模块 | Worker | 白名单消息，不持有 Kernel | 后台解析、索引、计算 |
| Sandbox App Plugin | 用户安装 `.mtplugin` | 强沙箱 iframe | 权限化 RPC | 全屏游戏、独立交互内容 |

第一阶段不允许用户安装任意 Runtime Plugin 代码。若未来开放，必须先补充签名、来源验证、权限审核、版本撤回和原生平台隔离，不能复用 `.mtplugin` 的信任假设。

## 三、不可破坏的目标契约

### `RUNTIME-SCOPE`：注册必须归属 Scope 且可撤销

- 服务、Provider、事件、Pipeline 中间件、工具、Renderer、UI Slot、Worker 和定时任务必须归属明确 Scope。
- 每次注册返回 `Dispose`，Scope 销毁时按逆序统一释放。
- 插件初始化失败必须回滚本次 Scope 已产生的全部 Effect，不能留下半注册状态。
- Kernel 全局 Scope、Profile Scope、Agent Scope、Turn Scope 和 Request/Tool Scope 形成父子生命周期。

```text
App Scope
  └─ Profile Scope
      └─ Agent/Session Scope
          └─ Turn Scope
              └─ Request/Tool Scope
```

### `RUNTIME-SEAM`：能力由 Definition、Provider、Consumer 组成

- Definition 声明类型契约、能力 ID、版本与校验 Schema。
- Provider 实现能力并声明限制、优先级和适用条件。
- Consumer 只依赖 Definition，不导入具体 Provider。
- 同一单例 Slot 出现多个 Provider 时必须由 Profile 显式选择，禁止依赖注册先后覆盖。

### `CHAT-REPLAY`：模型可见信息必须可重建

- 进入模型请求的文字、附件派生物、工具定义、工具调用结果和关键请求选择必须能从持久化记录重建。
- Profile 变化不能静默改变旧会话；会话保存解析后的 Composition Snapshot 或可等价重建的版本化引用。
- 流式 chunk 可以只作瞬态 UI 数据，但最终助手消息、工具调用和工具结果必须持久化。
- 重生成与分支必须以持久化边界为准，不能依赖当前 UI 已加载窗口。

### `CHAT-CONTENT`：消息正文使用类型化 Content Parts

- 文字、图片、音频、视频和文件是消息内容的一等成员。
- 消息只保存媒体资产引用，不保存大块 Base64、Blob URL 或远程临时 URL。
- 旧 `content: string` 是 V1 数据格式；V2 读取器将其映射为单个 text part。
- V2 只允许一个权威正文字段，禁止 `content` 与 `parts` 长期双写并分别被修改。

### `COMPAT-PLUGIN`：兼容生态只能依赖通用扩展口

- 通用应用、领域、存储和 UI 不得直接导入 SillyTavern 兼容实现。
- Compatibility Runtime Plugin 可以注册 Codec、Prompt Section、Context Source、Transform、State Reducer、Renderer 和设置面板。
- 关闭 Compatibility Runtime Plugin 后，基础 Agent、纯文本聊天、多模态附件和通用工具仍然可用。

## 四、聊天端如何组合能力

### 4.1 Chat Profile 是声明式组合，不是业务对象大集合

Chat Profile 只描述使用哪些 Runtime Plugin、如何绑定单例 Provider、启用哪些可叠加贡献和对应配置。

```ts
interface ChatProfileDefinition {
  id: string;
  version: number;
  plugins: readonly RuntimePluginReference[];
  bindings: Readonly<Record<CapabilitySlotId, ProviderId>>;
  contributions: Readonly<Record<CapabilitySlotId, readonly ContributionId[]>>;
  settings: Readonly<Record<string, unknown>>;
}
```

Profile 不直接保存服务实例、React 组件、数据库对象、API Key 或 Blob。秘密仍通过独立凭证能力解析，Profile 只保存安全引用。

### 4.2 Slot 决定“怎样组合”

每个 Slot 必须声明基数和冲突规则。

| Slot | 基数 | 组合语义 | 示例 |
|---|---:|---|---|
| `agent.driver` | 必须且仅一个 | Profile 显式绑定 | 默认 Tool Loop、旧 Tavern Driver |
| `llm.route` | 一个主路由，可有有序回退 | 按路由策略选择 Provider/Model | OpenAI Compatible、Anthropic |
| `session.store` | 必须且仅一个 | 单一权威持久化 | IndexedDB Session Store |
| `prompt.section` | 多个 | 按阶段、优先级和稳定 ID 排序 | 身份、角色、世界书、记忆 |
| `context.source` | 多个 | 并行读取后按预算合并 | 会话历史、知识库、长期记忆 |
| `tool` | 多个 | 名称唯一，权限过滤后暴露 | 搜索、角色编辑、媒体分析 |
| `input.transform` | 多个 | 有序 Pipeline | 输入清洗、兼容宏 |
| `output.transform` | 多个 | 有序 Pipeline | MVU、Regex、结构化输出 |
| `message.renderer` | 多个定义，按内容节点单选 | 用 `supports(node)` 解析 | Markdown、兼容 iframe、工具结果 |
| `media.processor` | 多个 | 按输入输出能力组成处理图 | 压图、ASR、抽帧、OCR |
| `settings.panel` | 多个 | UI Slot 聚合 | Provider、兼容层、媒体策略 |

“随意组合”的准确含义是：只要插件满足 Slot 契约、依赖、权限和版本要求，就能声明式组合；不是允许插件任意读取其他服务或修改聊天 Hook。

### 4.3 组合解析必须确定且可诊断

Profile 装载按以下顺序解析：

1. 合并基础 Profile、用户 Profile Patch 和会话覆盖。
2. 校验插件 ID、版本和配置 Schema。
3. 对 `requires` 依赖进行拓扑排序并拒绝循环依赖。
4. 校验必选 Slot、单例 Provider 冲突、工具重名和权限。
5. 为 Profile 创建子 Scope，按顺序挂载 Runtime Plugin。
6. 生成不可变 `ResolvedCompositionSnapshot`。
7. 新会话记录该 Snapshot；旧会话继续使用自己的版本，除非用户显式切换。

解析结果必须可以在诊断页查看：

```text
Profile: tavern.default@2
Driver: agent.tool-loop/default@1
LLM Route: provider.openai-compatible/main
Prompt Sections: base.identity -> tavern.character -> lorebook -> memory
Tools: media.inspect, session.branch
Renderers: markdown, sillytavern.iframe
Compatibility: sillytavern@1 enabled
Warnings: video 将降级为关键帧 + 音轨转写
```

### 4.4 会话级组合快照

会话不得只保存一个可变 `profileId`。至少保存：

```ts
interface ResolvedCompositionSnapshot {
  profileId: string;
  profileVersion: number;
  pluginVersions: Readonly<Record<string, string>>;
  providerBindings: Readonly<Record<string, string>>;
  contributionOrder: Readonly<Record<string, readonly string[]>>;
  capabilityDecisions: Readonly<Record<string, unknown>>;
}
```

API Key、访问令牌和其他秘密不能进入 Snapshot。模型、Provider 或 Profile 在会话中发生变化时，写入版本化组合变更事件；旧轮次继续保留当时的请求选择。

### 4.5 聊天运行流程

```text
用户输入 Content Parts
  → Attachment 提交与引用校验
  → 写入 user/message 持久化事实
  → Agent Inbox
  → 开启 Turn Scope
  → Input Transform Pipeline
  → Context Source 并行召回
  → Prompt Section + Tool Schema 组装
  → Provider 能力协商与媒体投影
  → LLM 请求
  → Assistant / Tool Call
  → Tool Permission + Tool Scope
  → Tool Result 持久化
  → 必要时进入下一 Step
  → Output Transform Pipeline
  → 最终消息与状态原子提交
  → UI 从 Projection 渲染
```

React Hook 只负责输入草稿、发送按钮、停止按钮、滚动和当前界面状态。Agent 驱动、Prompt 组装、工具循环、媒体降级和持久化事务都不进入 Hook。

## 五、多模态消息底座

### 5.1 内部消息契约

```ts
type MessageContentPart =
  | { type: "text"; text: string }
  | { type: "image"; assetId: string; alt?: string }
  | { type: "audio"; assetId: string; transcriptAssetId?: string }
  | { type: "video"; assetId: string; transcriptAssetId?: string; frameAssetIds?: readonly string[] }
  | { type: "file"; assetId: string; displayName: string };

interface AgentMessage {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: readonly MessageContentPart[];
  createdAt: number;
}
```

媒体原件和派生物由独立 Attachment 能力管理。现有 `LocalResourceService` 继续服务主题和界面资源，不承担消息附件生命周期。

### 5.2 Provider 能力协商

Provider 必须声明输入模态、MIME、数量、大小、时长、流式和工具调用能力。模型能力未知时采用保守策略并允许用户覆盖，不能仅根据模型名称正则推断后静默发送。

降级由 Media Processor 组成转换图：

```text
image → resize / OCR / caption
audio → transcode / ASR
video → direct / keyframes + audio track / transcript
file  → text extraction / unsupported
```

系统在发送前生成 `MediaProjectionDecision`，记录原始资产、派生资产、目标 Provider 和降级原因。用户界面必须显示关键降级，模型请求日志使用该决定保证重试可复现。

### 5.3 存储与隐私

- 附件字节物理分轨，不进入 `messages`、`sessions` 或 `settings` 大对象。
- 导入时校验 MIME 魔数、文件大小和媒体时长；不能只信任扩展名。
- 图片默认提供 EXIF/GPS 清理能力；原件保留策略由用户设置决定。
- 使用 staging、committed、orphaned 状态处理跨数据库提交与崩溃恢复。
- 消息删除、分支替换、会话删除、备份恢复和插件卸载必须纳入引用回收。
- Blob URL 只在展示期间创建并可回收，不能持久化。

## 六、SillyTavern Compatibility Runtime Plugin

目标插件提供以下贡献：

| 当前能力 | 目标扩展口 |
|---|---|
| 角色卡 PNG/JSON 导入导出 | `character.codec`、`importer/exporter` |
| ST 预设 | `prompt.composition.codec` |
| 世界书格式和触发语义 | `context.source`、兼容 Codec |
| MVU 与 Regex | `input.transform`、`output.transform`、`session.state.reducer` |
| TavernHelper | Compatibility RPC，不进入通用全局对象 |
| 消息 iframe | `message.renderer` |
| 专属设置 | `settings.panel` |

迁移期间先把现有聊天路径包装为 Driver，保持旧行为；新的 UI 只调用 `AgentHandle`。阶段 5 已将迁移期 ID 收口为格式中立的 `mobile-tavern.chat.driver`。随后逐项把直接 import 改为扩展注册，最后以“禁用兼容插件后基础 Profile 完整工作”为完成标志。

## 七、分阶段实施路线

### 阶段 0：固化目标与自动化边界

目标：让后续修改都朝同一依赖方向推进。

工作项：

- 接入本文为架构权威入口。
- 定义 Runtime Plugin、Worker Plugin、Sandbox App Plugin 的稳定命名。
- 为目标依赖方向添加首批架构守卫，但不在实现完成前错误禁止现有兼容调用。
- 建立 `base` 与 `tavern` Profile 的验收清单。
- 列出现有服务到目标 Slot/Plugin 的迁移映射。

完成条件：后续 PR 能明确标注所属阶段、目标 Slot 和需要删除的旧路径。

### 阶段 1：Scoped Runtime Plugin 基座

目标：使注册可组合、可回滚、可卸载。

工作项：

- 增加通用 Effect Scope 和父子生命周期。
- 让 extension、subscription 和 middleware 注册返回 Dispose。
- 定义类型化 Capability Token、Runtime Plugin Definition 和配置 Schema。
- 实现依赖拓扑、循环检测、初始化失败回滚和诊断快照。
- 在应用组合根加入 Profile Loader；现有服务先通过 legacy runtime plugin 接入。

完成条件：测试插件可以注册服务、事件和 Pipeline，卸载后运行时无残留；现有应用行为不变。

当前进度（2026-08-24）：Scope/Effect、Runtime Plugin Definition、Profile 的稳定拓扑解析与版本校验、初始化失败回滚、脱敏运行快照，以及 legacy runtime plugin 组合根接入已经完成。类型化 Capability Token、Provider 冲突解析和插件配置 Schema 仍属于本阶段后续工作。

### 阶段 2：Message Content V2 与 Attachment Data Plane

目标：让聊天领域原生支持文字、图片、音频、视频和文件。

工作项：

- 定义 V1/V2 消息读取联合类型和单向迁移策略。
- 建立附件元数据、字节存储、staging、引用和垃圾回收。
- 接入消息新增、删除、重发分支、完整备份与覆盖恢复。
- 实现基础图片选择、预览和一种 Provider 的图片输入投影。
- 保持旧纯文本消息、分页、摘要和记忆链路兼容。

完成条件：图片消息可以保存、重启恢复、重生成、分支、备份恢复；不支持图片的模型会明确拒绝或降级，不会静默丢失。

当前进度（2026-08-24）：阶段 2 最小纵向闭环已完成。`messages` Store 支持 V1 文本记录与 V2 Content Parts 联合读取，运行态继续提供兼容文本投影；消息附件使用独立 `MobileTavernAttachmentDB`，元数据与字节分 Store 保存，并具备魔数校验、`staging/committed/orphaned`、引用重建、垃圾回收和 Blob URL 回收。聊天端已接入最多四张图片的选择、预览、V2 落盘和气泡展示；OpenAI-compatible 图片输入只在用户明确启用模型视觉能力后投影，Anthropic 原生方言及音视频 Provider 投影会明确拒绝。统一备份升级为 v5 并携带所引用附件字节，恢复使用安全快照和跨数据库补偿。音视频文件的领域类型、存储与展示能力已预留，ASR、视频关键帧、声明式 Provider 能力协商和可复现 `MediaProjectionDecision` 留待阶段 3。

### 阶段 3：Agent Spine、Tool Registry 与 Provider Seam

目标：把一次性聊天调用升级为可插拔 Agent Driver。

工作项：

- 定义 AgentHandle、Agent Registry、Inbox、Turn、Step 和取消语义。
- 把现有 `useSendMessage` 包装为 legacy driver，UI 改用 AgentHandle。
- 建立 Tool Registry、Schema 校验、权限、超时和 Tool Call/Result 持久化。
- 把 LLM 请求转换为 Provider Adapter，提供声明式模型能力。
- 增加音频 ASR 与视频关键帧/音轨处理插件。

完成条件：同一聊天 UI 可以切换两个 Driver 或两个 Provider；工具循环和多模态降级可以重放，停止与销毁不残留请求。

当前进度（2026-08-24）：阶段 3 最小纵向闭环已完成。应用层新增 `AgentRuntimeService`、AgentHandle/Turn/Driver/Provider/Tool/Media Processor 契约和独立 Agent Journal；聊天发送与停止已通过 `mobile-tavern.chat.driver` 进入 AgentHandle，同一 UI 按 API 类型解析 OpenAI-compatible 或 Anthropic-compatible Provider。Tool Registry 已具备输入/输出 Schema、权限、超时、取消与 Call/Result 持久化；Provider/媒体决定、Turn 终态和会话 Composition Snapshot 可重放并随 v6 备份恢复。音频附件可经 ASR 转写，视频附件可生成关键帧并把派生引用写回 V2 消息。后续仍需提供真正消费模型 `tool_calls` 的内置多 Step Tool Loop Driver。

### 阶段 4：SillyTavern 兼容能力降级为 Runtime Plugin

目标：清除通用层对 SillyTavern 实现的直接依赖。

工作项：

- 建立 Codec、Prompt Section、Context Source、Transform、State Reducer 和 Renderer Slot。
- 迁移 Database、Prompt、Script、消息渲染和变量通知中的直接兼容调用。
- 将兼容状态放入插件命名空间并提供旧数据读取降级。
- 建立关闭兼容插件的 base Profile 回归测试。
- 保持 Tavern Profile 现有导入、聊天、重生成、分支和状态恢复能力。

完成条件：通用生产代码不再 import `compatibility/sillytavern`；Compatibility Runtime Plugin 可关闭和重载；旧用户数据无静默丢失。

当前进度（2026-08-24）：阶段 4 底层闭环已完成。Application 层新增默认为空的 `CompatibilityRuntimeService`，提供 Codec、Prompt Section、Context Source、Transform、State Reducer 和 Renderer 六类可撤销贡献；`mobile-tavern.sillytavern-compat` 作为独立受信 Runtime Plugin 连接现有 SillyTavern 实现。Database、Prompt、Script、消息渲染、变量通知和聊天生成状态已改为只消费 Host 契约，通用生产代码不再直接导入 `compatibility/sillytavern` 或读写 TavernHelper 生成全局字段。`mobile-tavern.base` 不装载兼容插件，`mobile-tavern.tavern` 显式装载并可在同一 Host 卸载、重载。会话状态优先读取 `runtimePluginState[pluginId]`，迁移期继续双写并降级读取旧 `variables`，统一备份恢复对该命名空间执行边界校验。Profile 选择界面、设置面板贡献和旧兼容字段最终停止双写留到阶段 5。

### 阶段 5：Profile UI、生态扩展与旧路径清理

目标：让组合能力成为可使用、可诊断的产品功能。

工作项：

- 提供 Profile 选择、复制、能力开关和会话切换确认。
- 展示实际 Provider、工具、Prompt Section、Renderer 和媒体降级策略。
- 为插件版本不兼容、缺失 Provider 和 Profile 更新提供安全降级。
- 删除 legacy driver、旧静态 capability catalog 和重复注册路径。
- 评估受信插件签名与分发；在安全方案完成前不开放任意 Runtime Plugin 安装。

完成条件：用户可以用同一聊天端创建至少一个 base Agent 和一个 Tavern Agent；两者共享通用多模态与 Provider 底座，兼容能力互不污染。

当前进度（2026-08-24）：阶段 5 第一批产品闭环已完成。设置页新增 Agent Runtime Profiles 管理区，提供内置 Base/Tavern 选择、复制、自定义 Compatibility/音频/视频能力开关和实际运行诊断；启动组合从独立公开偏好恢复，外部值经过 Schema、数量、稳定 ID 与重复项校验，损坏或悬空记录回退 Tavern Agent。会话 Composition Snapshot 与当前 Profile 不一致时，发送和重发会明确拒绝；切换 Profile 前展示当前会话影响并要求确认，随后重启运行时。迁移期 `legacy.tavern.driver` 已替换为 `mobile-tavern.chat.driver`，旧静态 capability catalog 与隐式默认注册已删除。受信 Runtime Plugin 仍只随安装包分发；签名方案至少需要发行方公钥固定、清单与代码摘要绑定、版本/权限声明、防降级和可回滚撤销，在这些机制完成前不开放外部安装。会话列表跨 Profile 自动重启后恢复和旧兼容变量停止双写仍是阶段 5 剩余工作。

## 八、第一批实施任务

后续代码从以下三个批次开始，不并行扩大到兼容层大迁移：

1. **Scope/Effect 契约（已完成）**：为 Kernel extension、消息订阅和 Pipeline 注册补充可撤销 Effect，并建立生命周期测试。
2. **Runtime Plugin/Profile 最小实现（已完成）**：用 legacy plugin 包装当前 `serviceCatalog`，输出不含配置秘密的可诊断插件快照，不改变用户行为。
3. **Message Content V2 与 Attachment Data Plane（已完成最小闭环）**：V1/V2 兼容、独立附件存储、引用/回收、图片 UI、OpenAI-compatible 投影和 v5 备份恢复均已接入；复杂媒体处理与 Provider 能力注册进入阶段 3。

每个批次都必须遵循 `CHANGE-SAFE`：先定义公开契约与失败路径测试，再接入组合根；涉及当前边界变化时同步更新 `runtime_boundaries.md`、`module_contracts.md` 和架构守卫。

## 九、非目标

- 不把 Agent、工具、角色、Prompt、媒体或 Compatibility Runtime 移入 `src/kernel/`。
- 不在第一阶段开放任意第三方 Runtime Plugin 代码执行。
- 不把当前 `.mtplugin` iframe 与 Runtime Plugin 合并为通用 Bridge。
- 不为了追求完整事件溯源立即重写全部会话数据库；允许以 Message V2 和新增事件分轨渐进迁移。
- 不保证所有模型原生理解视频；目标是能力协商、可见降级和可复现发送。
- 不让 Profile 成为新的万能设置对象，秘密、用户数据和大字段继续物理分轨。
