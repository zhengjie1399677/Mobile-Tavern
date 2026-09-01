# 插件式 Agent Runtime 与聊天组合路线

> 本文定义 Mobile Tavern 从当前模块化应用演进为插件式移动端 Agent Host 的目标架构、聊天组合模型、迁移阶段和验收条件。
> 它描述目标态，不放宽 `AGENTS.md`、`runtime_boundaries.md` 中仍然生效的当前边界；每一阶段只有在代码、迁移和守卫同时完成后，才能更新当前边界。

## 当前状态速览（2026-09-02）

| 路线 | 状态 | 说明 |
|---|---|---|
| 阶段 0–5 | 已完成当前验收范围 | Agent Host 基础闭环已落地，详见各阶段的当前进度和 `CURRENT_STATE.md`。 |
| 阶段 A | 已完成当前验收范围 | Base/Tavern Profile 已注册 `character.read` 与 `session.branch`，诊断只展示真实注册结果。 |
| 阶段 B–C | 已完成当前验收范围 | Tool 策略、一次性审批卡片、fail-closed 和 Journal 重放已接入。 |
| 阶段 D | 进行中 | L1 声明式 HTTPS 连接器、白名单 Host Capability 与 L2 一次性受限 Worker 已接入 Agent Runtime；签名/可信来源、远程版本撤回和生态发布仍未完成。 |
| 阶段 E | 进行中 | 仓库内 Tool Plugin SDK 与官方最小示例已完成；独立发布、审核、灰度和生态试运行尚未完成。 |

阶段 A–E 是阶段 1–5 之后的新路线，不应把 Agent Runtime 已有的 Tool Registry、Tool Call 展示或有限 Tool Loop 误判为这些产品阶段已经完成。

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
| 世界书格式和触发语义 | `context.source`、`compat.world-info-resolver`、兼容 Codec |
| MVU 与 Regex | `input.transform`、`output.transform`、`session.state.reducer` |
| Depth Prompt、Author's Note | `prompt.section`，由通用消息整形器按 `in_chat/depth/role` 插入 |
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

当前进度（2026-08-24）：阶段 1 已完成。Scope/Effect、Runtime Plugin Definition、Profile 的稳定拓扑解析与版本校验、初始化失败回滚、脱敏运行快照，以及 legacy runtime plugin 组合根接入已经完成。Runtime Plugin 配置统一由 Zod Schema 在装载前校验；类型化 Capability Token 同时描述 Slot 基数与必选性，Profile Loader 会拒绝 Token 定义冲突、重复 Provider、缺失 Binding、错误基数与未知 Contribution。

### 阶段 2：Message Content V2 与 Attachment Data Plane

目标：让聊天领域原生支持文字、图片、音频、视频和文件。

工作项：

- 定义 V1/V2 消息读取联合类型和单向迁移策略。
- 建立附件元数据、字节存储、staging、引用和垃圾回收。
- 接入消息新增、删除、重发分支、完整备份与覆盖恢复。
- 实现基础图片选择、预览和一种 Provider 的图片输入投影。
- 保持旧纯文本消息、分页、摘要和记忆链路兼容。

完成条件：图片消息可以保存、重启恢复、重生成、分支、备份恢复；不支持图片的模型会明确拒绝或降级，不会静默丢失。

当前进度（2026-08-24）：阶段 2 已完成。`messages` Store 支持 V1 文本记录与 V2 Content Parts 联合读取，运行态继续提供兼容文本投影；消息附件使用独立 `MobileTavernAttachmentDB`，元数据与字节分 Store 保存，并具备魔数校验、`staging/committed/orphaned`、引用重建、垃圾回收和 Blob URL 回收。聊天端已接入最多四张图片的选择、预览、V2 落盘和气泡展示；OpenAI-compatible 图片输入只在用户明确启用模型视觉能力后投影，Anthropic 原生方言及音视频 Provider 投影会明确拒绝。统一备份携带所引用附件字节，恢复使用安全快照和跨数据库补偿。音视频文件的领域类型、存储与展示已进入同一 Content Parts/Attachment Data Plane；ASR、视频关键帧和声明式 Provider 能力协商由阶段 3 的 Runtime Plugin 接续实现。

### 阶段 3：Agent Spine、Tool Registry 与 Provider Seam

目标：把一次性聊天调用升级为可插拔 Agent Driver。

工作项：

- 定义 AgentHandle、Agent Registry、Inbox、Turn、Step 和取消语义。
- 把现有 `useSendMessage` 包装为 legacy driver，UI 改用 AgentHandle。
- 建立 Tool Registry、Schema 校验、权限、超时和 Tool Call/Result 持久化。
- 把 LLM 请求转换为 Provider Adapter，提供声明式模型能力。
- 增加音频 ASR 与视频关键帧/音轨处理插件。

完成条件：同一聊天 UI 可以切换两个 Driver 或两个 Provider；工具循环和多模态降级可以重放，停止与销毁不残留请求。

当前进度（2026-08-24）：阶段 3 已完成。应用层新增 `AgentRuntimeService`、AgentHandle/Turn/Driver/Provider/Tool/Media Processor 契约和独立 Agent Journal；聊天发送与停止已通过 `mobile-tavern.chat.driver` 进入 AgentHandle，同一 UI 的 Profile 绑定稳定的 settings route，再按 API 类型解析 OpenAI-compatible 或 Anthropic-compatible Provider，并在每个 Turn 记录实际 Provider。Tool Registry 已具备输入/输出 Schema、权限、超时、取消与 Call/Result 持久化；Provider/媒体决定、Turn 终态和会话 Composition Snapshot 可重放并随 v6 备份恢复。OpenAI-compatible 流会聚合分片 `tool_calls`，经 Agent Turn 执行工具后附加 Assistant/Tool 消息继续模型请求，最多执行 8 个 Step；达到上限且已无后续模型步骤时不会再执行有副作用的工具，每步决定和已执行工具结果进入 Journal。音频附件可经 ASR 转写，视频附件可生成关键帧并把派生引用写回 V2 消息。

### 阶段 4：SillyTavern 兼容能力降级为 Runtime Plugin

目标：清除通用层对 SillyTavern 实现的直接依赖。

工作项：

- 建立 Codec、Prompt Section、Context Source、Transform、State Reducer、World Info Resolver 和 Renderer Slot。
- 迁移 Database、Prompt、Script、消息渲染和变量通知中的直接兼容调用。
- 将兼容状态放入插件命名空间并提供旧数据读取降级。
- 建立关闭兼容插件的 base Profile 回归测试。
- 保持 Tavern Profile 现有导入、聊天、重生成、分支和状态恢复能力。

完成条件：通用生产代码不再 import `compatibility/sillytavern`；Compatibility Runtime Plugin 可关闭和重载；旧用户数据无静默丢失。

当前进度（2026-08-31）：阶段 4 已完成并补齐兼容基线。Application 层新增默认为空的 `CompatibilityRuntimeService`，提供 Codec、Prompt Section、Context Source、Transform、State Reducer、World Info Resolver 和 Renderer 七类可撤销贡献；`mobile-tavern.sillytavern-compat` 作为独立受信 Runtime Plugin 连接现有 SillyTavern 实现。角色卡导入导出保留来源扩展字段，World Info 触发、递归、选择逻辑和预算在插件专属 resolver 中执行，Depth Prompt 与 Author's Note 通过通用 `in_chat/depth/role` 元数据进入最终消息历史，global/preset/character Regex 按链路执行，脚本 iframe 按会话隔离并在卸载或页面生命周期结束时清理计时器、动画帧、Blob URL、媒体和动态资源。Database、Prompt、Script、消息渲染、变量通知和聊天生成状态仍只消费 Host 契约，通用生产代码不直接导入 `compatibility/sillytavern` 或读写 TavernHelper 生成全局字段。`mobile-tavern.base` 不装载兼容插件，`mobile-tavern.tavern` 显式装载并可在同一 Host 卸载、重载；会话状态以 `runtimePluginState[pluginId]` 为新权威位置，旧 `variables` 仅在兼容插件边界读取和瞬时投影，统一备份恢复对命名空间执行边界校验。

### 阶段 5：Profile UI、生态扩展与旧路径清理

目标：让组合能力成为可使用、可诊断的产品功能。

工作项：

- 提供 Profile 选择、复制、能力开关和会话切换确认。
- 展示实际 Provider、工具、Prompt Section、Renderer 和媒体降级策略。
- 为插件版本不兼容、缺失 Provider 和 Profile 更新提供安全降级。
- 删除 legacy driver、旧静态 capability catalog 和重复注册路径。
- 评估受信插件签名与分发；在安全方案完成前不开放任意 Runtime Plugin 安装。

完成条件：用户可以用同一聊天端创建至少一个 base Agent 和一个 Tavern Agent；两者共享通用多模态与 Provider 底座，兼容能力互不污染。

当前进度（2026-09-01）：阶段 5 已完成当前路线定义的产品闭环。设置页提供 Profile 卡片、内置 Base/Tavern 选择、复制、自定义 Compatibility/音频/视频能力开关和实际运行诊断，并提供“角色 → Tool → 行为 → 高级采样”的移动端渐进编辑、Android/Web 文件导入导出与“保存并开始”入口。Agent 文件只保存稳定引用和公开小字段；角色卡、Prompt 正文、插件包与凭据继续物理分轨。启动前校验角色、预设、Tool 及精确版本，再以一次性意图重载目标 Profile 并创建新会话；组合根把 Agent 决定与外部 Tool 贡献冻结到 Composition Snapshot，发送和重生成按会话快照解析行为，引用丢失时拒绝静默漂移。当前运行区提供明确的 Compatibility Runtime 开关，开启/关闭分别切换 Tavern/Base Profile。打开绑定其他 Profile 的旧会话时同样验证目标 Profile 与精确版本后恢复，目标已删除或版本不匹配时明确拒绝且不会形成重启循环。旧 `session.variables` 已停止持久化双写，仅保留旧数据读取降级；`legacy.tavern.driver`、旧静态 capability catalog 与隐式默认注册均已删除。受信 Runtime Plugin 仍只随安装包分发；外部任意 Runtime Plugin 安装继续作为安全方案完成前的明确非目标。

## 八、第一批实施任务

以下三个批次是已经完成的首批实施任务，后续工作按本文第十节的新路线推进：

1. **Scope/Effect 契约（已完成）**：为 Kernel extension、消息订阅和 Pipeline 注册补充可撤销 Effect，并建立生命周期测试。
2. **Runtime Plugin/Profile 最小实现（已完成）**：用 legacy plugin 包装当前 `serviceCatalog`，输出不含配置秘密的可诊断插件快照，不改变用户行为。
3. **Message Content V2 与 Attachment Data Plane（已完成最小闭环）**：V1/V2 兼容、独立附件存储、引用/回收、图片 UI、OpenAI-compatible 投影和 v6 备份恢复均已接入；复杂媒体处理与 Provider 能力注册进入阶段 3。

每个批次都必须遵循 `CHANGE-SAFE`：先定义公开契约与失败路径测试，再接入组合根；涉及当前边界变化时同步更新 `runtime_boundaries.md`、`module_contracts.md` 和架构守卫。

## 九、非目标

- 不把 Agent、工具、角色、Prompt、媒体或 Compatibility Runtime 移入 `src/kernel/`。
- 不在第一阶段开放任意第三方 Runtime Plugin 代码执行。
- 不把当前 `.mtplugin` iframe 与 Runtime Plugin 合并为通用 Bridge。
- 不为了追求完整事件溯源立即重写全部会话数据库；允许以 Message V2 和新增事件分轨渐进迁移。
- 不保证所有模型原生理解视频；目标是能力协商、可见降级和可复现发送。
- 不让 Profile 成为新的万能设置对象，秘密、用户数据和大字段继续物理分轨。

## 十、后续路线：Agent Tool 产品化与受控生态

阶段 1–5 已完成 Agent Host 的基础闭环：Scope/Effect、Runtime Profile、Message Content V2、Attachment Data Plane、AgentHandle、Provider、Tool Registry、有限 Tool Loop、Agent Journal、媒体处理、Compatibility Runtime 和 Profile UI 均已落地。本阶段不重复建设这些底座，而是把现有契约转化为用户可发现、可使用、可授权的 Agent Tool 能力。

### 10.1 阶段 A：内置 Tool 产品化

目标：在现有 Tool Registry 和 Tool Loop 之上，完成第一个真实可用的 Tool 纵向闭环。

工作项：

- 实际注册 `session.search`、`memory.search`、`character.read` 等低风险内置 Tool；Tool 实现必须位于 Application/Domain，不进入 Kernel。
- 为每个 Tool 补齐输入输出 Schema、版本身份、取消/超时处理、错误投影和聊天内结果 Renderer。
- 将 Tool 的可见性与 Profile/会话组合绑定，确保 Base Profile 在关闭 Compatibility Runtime 后仍能使用通用 Tool。
- 使用现有 Agent Journal 记录 Tool Call/Result、执行失败和关键决定；仅补齐当前 Journal 尚未覆盖的模型可见输入，不新建重复的 Tool 日志体系。

完成条件：用户可以在 Base Profile 的普通聊天中触发至少一个本地 Tool，并看到可理解的调用状态、结果和失败原因；Tavern Profile 的兼容聊天不受影响。

当前进度（2026-08-26）：阶段 A 已完成当前验收范围。`mobile-tavern.agent-spine` 在 Profile 明确启用贡献时注册只读 `character.read` 和本地 `session.branch`；前者只投影当前角色的安全公开字段，后者作为后续审批链的真实副作用 Tool。Tool 输入/输出均经 Zod Schema，支持取消、执行超时和通用错误投影；诊断面板删除未注册占位名称，只展示 Runtime 的真实注册项。旧会话按自己的 Composition Snapshot 冻结 Tool 集合，不会因 App 升级静默获得新能力。

### 10.2 阶段 B：副作用 Tool 与审批策略

目标：为会修改数据、访问外部服务或产生不可逆影响的 Tool 增加最小可用审批能力。

本阶段只处理移动端本地、具有明确副作用或需要用户授权的 Tool：

- `session.branch`：创建会话分支，需要轻量确认并记录来源会话。
- `memory.write`：写入或修改长期记忆，必须单次确认。
- 后续的联网、文件写入和角色编辑 Tool：默认拒绝或单次确认，具体能力必须单独声明。

在现有 Tool 权限、超时和取消契约上补充风险级别、副作用和执行 Scope；策略统一返回 `allow`、`deny` 或 `ask`，未知能力和缺失策略必须 fail-closed。

完成条件：高风险 Tool 在没有有效授权时不会执行；允许、拒绝、取消、超时和宿主不可用均能被记录并安全结束。

当前进度（2026-08-26）：阶段 B 已完成当前验收范围。Tool Definition 声明风险级别、副作用、执行 Scope、宿主权限和 `allow` / `deny` / `ask`；具有副作用或高风险的 Tool 禁止默认 `allow`。`session.branch` 使用 `ask`，只有一次性允许后才会以单次写入创建带来源 ID 的本地分支；未知 Tool、权限缺失、策略拒绝、审批取消、超时和宿主不可用均 fail-closed。

### 10.3 阶段 C：审批与可发现性

目标：让高风险 Tool 的授权过程可理解、可取消、可追溯，并让用户发现当前 Agent 拥有哪些能力。

工作项：

- 在聊天中提供待审批 Tool Call 卡片，展示 Tool 名称、用途、目标数据、关键参数和风险提示。
- 支持“允许一次”“拒绝一次”；暂不默认提供永久允许，永久授权必须进入 Profile/Tool 管理页并可撤销。
- 审批取消、超时、宿主不可用和权限不足统一按拒绝处理，并写入可重放事件。
- 在 Agent 诊断与会话历史中展示 Tool 调用、审批决定、执行结果和失败原因；复用现有 Journal，不另建平行诊断链路。
- 将 Tool 能力入口放入通用聊天工作区和 Profile 诊断页，不能只埋在插件设置中。

完成条件：用户能够发现当前 Agent 有哪些 Tool，并能在不阅读开发文档的情况下理解和拒绝一次高风险操作。

当前进度（2026-08-26）：阶段 C 已完成当前验收范围。聊天区订阅当前会话的待审批 Call，展示用途、参数、风险、副作用和执行 Scope，并提供“允许一次”“拒绝一次”；组件卸载或最后一个审批宿主消失时立即拒绝。审批请求、决定、Tool Result 和友好失败原因进入既有 Agent Journal、备份校验和聊天历史，未建立平行日志体系。

### 10.4 阶段 D：受控 Agent Tool Plugin Manifest

目标：在内置 Tool 和审批策略稳定后，开放声明式 Tool 扩展，但不开放任意应用进程代码执行。

Manifest 至少声明：

- 插件 ID、版本、作者、来源和内容哈希。
- Tool ID、输入输出 Schema、风险级别、副作用和所需能力。
- 依赖、兼容的 Agent Runtime 版本和目标 Profile。
- 执行位置：内置 Runtime、Worker、Sandbox，或不承载插件代码的白名单 Host Capability 代理；默认禁止插件代码直接进入 App 进程。
- 安装、启用、停用、卸载、回滚和权限撤销后的数据清理策略。

在签名、来源验证、版本撤回和原生能力隔离完成前，只允许随安装包分发受信 Runtime Plugin；用户安装的 Agent Tool 代码只能先落在 Worker/Sandbox 边界。Manifest-only Tool 可以请求版本化、白名单化的 Host Capability，但宿主只执行内置类型化处理器，不能执行插件代码、暴露 Kernel/存储或复用 `.mtplugin` 以外的信任假设。

完成条件：一个外部 Tool Plugin 可以被发现、安装、授权、停用和卸载；插件无法访问 Manifest 未声明的能力，卸载后不残留注册、任务、凭据或会话数据。

当前进度（2026-09-02）：阶段 D 已完成本地 L2 执行闭环。`mobile-tavern.tool-plugin` v2 可通过 `.mttool` 包携带单入口 Worker，也可声明无需脚本的 HTTPS Tool；包安装会校验 ZIP 路径与体积、规范化 SHA-256、受支持 JSON Schema 子集和禁用 API。启用后的 Tool 以 `ext.<pluginId>.<toolId>` 注册到 Agent Runtime，新会话快照记录插件版本和 Tool，旧会话保持冻结；每次执行仍重新检查启用状态、内容哈希和权限，使撤销对旧句柄立即生效。Worker 每次调用新建并在完成、失败、取消或超时后终止，不能直接使用网络、动态代码、持久化或子 Worker；网络只能经宿主按精确 HTTPS Origin、方法、请求次数和流量配额代理，凭据加密分轨保存并只在宿主侧注入。安装、授权、停用、最多 8 个历史版本、回滚清权、凭据清理和卸载均已接通。官方目录现提供默认未安装、未授权、未启用的 `official.brave-search` 与 `official.memory`；前者固定 Brave Search Origin，后者使用当前唯一开放的声明式 Host handler `memory.write`，经高风险单次审批后通过 `MemoryService` 写入带来源消息的长期记忆，来源缺失时 fail-closed。`targetProfiles: ["*"]` 只声明连接器可供任意 Profile 选择，自定义 Agent 的实际组合仍按其 `toolMounts` 白名单冻结。仓库内作者 SDK 已提供 v2 Manifest/Worker 类型、确定性 `.mttool` 打包器和无权限文本工具箱示例。尚未完成的是签名/可信来源、远程版本撤回、生态审核与 SDK 独立发布；当前也不提供后台常驻、任意原生能力或无界 JavaScript 运行。

### 10.5 阶段 E：生态试运行

仅在阶段 A–D 完成后评估：

- 官方 Tool Plugin SDK 和模板。
- 插件目录、版本固定、来源展示和兼容性检查。
- Provider、Media Processor、Renderer 和 Context Source 的扩展模板。
- 插件审核、撤回、灰度和安全事件处理流程。

本阶段暂不追求完整桌面 Agent 能力。Shell、PTY、持久终端、通用文件系统、后台 Job、Subagent、Agent Team、Headless Runner 和 ACP 均不作为首批移动端生态的前置条件；如未来需要，必须以独立能力和独立风险评估立项。

当前进度（2026-09-02）：`sdk/tool-plugin/` 已完成仓库内最小作者 SDK，提供 v2 Manifest 定义、Worker handler 注册与确定性 `.mttool` 打包；`examples/tool-plugin-text-toolkit/` 提供不申请权限、不联网、不写数据的官方示例和可安装产物。该阶段仍处于试运行起点，尚未承诺 npm 独立发布、第三方目录开放或来源可信等级。

### 10.6 总体验收顺序

```text
现有 Tool Runtime 底座
  → 内置 Tool 落地
  → Tool Policy 与审批
  → 会话事件重放与诊断
  → Tool Plugin Manifest
  → Worker/Sandbox 插件试运行
  → Provider/Media/Renderer 生态扩展
```

每一阶段都必须遵循 `CHANGE-SAFE`：先定义边界、权限、失败路径和迁移策略，再接入组合根；不得因为开放插件而放宽 `ARCH-KERNEL`、`ARCH-FLOW` 或三类插件信任边界。

## 十一、远期展望：可无头运行、由 AI 即时塑形的 Agent Host

> 本节记录阶段 E 之后的产品方向，不是当前实现阶段、排期或边界放宽。当前产品仍遵守
> `PLATFORM-MOBILE`，生产安装包继续与 `cloud/` 物理隔离。若正式启动本节任一方向，必须先独立立项、
> 完成风险评估，并同步修改 `AGENTS.md`、运行时边界、移动端/云端策略、共享契约和自动化守卫；不得用远期目标提前覆盖当前代码边界。

### 11.1 产品愿景

Mobile Tavern 远期可以从固定形态的 APK 演进为本地优先、可嵌入、可远程调用、可无头运行的个人
Agent Host。Android/iOS App 仍是重要的隐私优先部署方式，但 APK 不再定义能力上限，只是 Host 的一种
部署外壳和官方体验入口。

Host 不强制用户只能使用默认 Tavern UI。默认 Profile、AI 即时工坊、用户安装插件、替代 UI 和外部软件
都可以成为体验入口；它们共享同一个权限化能力宿主，不复制存储、Agent、工具或原生能力实现。

```text
                         Headless Tavern Host
        ┌──────────────────────────────────────────────────┐
        │ Agent / Chat / Model / Media / Tool / Storage   │
        │ Capability Broker / Permission / Audit / Scope  │
        │ Plugin Lifecycle / Recovery / Versioned Contract │
        └───────────────────────┬──────────────────────────┘
                                │ 稳定、版本化的 Host Protocol
              ┌─────────────────┼─────────────────┐
              │                 │                 │
        Android/iOS UI      AI 即时工坊       外部软件/替代 UI
              │                 │                 │
              └────────── 仅持有已授权 Capability ──────────┘
```

这里所说的“两个系统”不是两套可以互相绕过的宿主，而是职责分离：

- **能力系统**：提供完整、稳定、可授权、可撤销、可审计的通用能力，是不可被运行时生成物绕过的权力边界。
- **体验系统**：决定 UI、交互、工作流和外部对接方式，可以被替换、组合或由 AI 临时生成。

入口可以变化，能力可以组合，但权限、数据所有权和生命周期不能出现第二条旁路。

### 11.2 不可由 AI 或普通插件改写的宿主边界

“核心不可更改”是指运行中的 AI、插件和替代 UI 没有改写或绕过权；宿主自身仍可通过正式、可迁移的版本升级演进。

- Kernel 的 Scope、生命周期、可撤销 Effect、Pipeline、注册与通用校验机制。
- Capability 的签发、裁剪、撤销、风险策略和审批决定。
- 用户数据所有权、事务、版本迁移、备份恢复与安全删除语义。
- 插件安装、签名与来源校验、隔离、资源限制、停用、卸载和回滚。
- 凭据、令牌和秘密解析；生成代码只能持有引用，不得读取秘密明文。
- Native Adapter、宿主更新、完整性校验、安全模式和崩溃恢复。
- Host Protocol 的身份、认证、版本协商、重连、流式事件和错误语义。

Agent、聊天、媒体、插件业务和协议 Adapter 仍然位于 Kernel 之上。“无头运行”不得成为把业务移入
`src/kernel/`，或合并 Compatibility Runtime、Plugin Host RPC 与 Native Adapter 的理由。

### 11.3 AI 即时工坊

Host 可以内置一个可关闭、可替换的受信 AI Builder Runtime。它负责理解用户意图、读取脱敏诊断和公开
扩展契约，生成临时 UI Patch、Sandbox/Worker Plugin 或外部协议 Adapter；AI Builder 本身不属于 Kernel，
其生成物也不会因为来源于内置 AI 而自动成为受信 Runtime Plugin。

典型闭环：

```text
自然语言需求或 UI 故障
  → 读取公开 Slot、组件描述、错误与布局约束
  → 从版本化 SDK/模板生成 Patch、Plugin 或 Adapter
  → Schema / TypeScript / 禁止 API / 依赖与资源预算校验
  → 声明域名、数据、凭据引用和 Host Capability
  → 用户审批
  → 独立 Scope 中预览或试运行
  → 失败自动撤销；确认后版本化安装
  → 可停用、回滚、导出或继续交给 AI 修改
```

AI 生成能力按风险分层：

1. 主题 Token、布局参数和声明式 UI Patch 可以即时预览与撤销。
2. 普通功能进入 Worker 或 Sandbox Plugin，经过校验、授权和资源限制后热加载。
3. 涉及宿主架构、数据库迁移、Native 权限、共享契约或正式 Runtime Plugin 的修改只能生成变更提案，不能在运行时自行应用。

AI 不应依靠任意 DOM 操作或修改宿主源码修复界面。长期应提供声明式 UI Slot、Panel、Action、Form、
Renderer、Theme Token 和稳定组件描述，使生成结果能够跨版本验证和降级。临时修复必须拥有独立 Scope，
不能覆盖原始资源；确认后可以固化为有 Manifest、版本和权限声明的插件。

### 11.4 Headless Host 与部署形态

在远期目标中，同一组领域契约可以支持三种相互兼容但物理实现独立的 Deployment Profile：

| 部署形态 | Host 位置 | 主要价值 | 约束 |
|---|---|---|---|
| 嵌入模式 | 随 Android/iOS App 本地运行 | 离线、隐私、本地优先 | 必须尊重移动端后台和资源限制 |
| 无头模式 | 独立进程或受控设备服务 | 无固定 UI、长期任务、被多个客户端调用 | 必须独立定义进程、存储和升级边界 |
| 远程模式 | 用户控制的设备或服务器 | 跨设备访问、对接其他软件 | 必须提供强认证、传输安全、撤销和审计 |

移动端、独立 Host 与远程服务不得通过复制业务类型各自演进。若立项，应先在 `shared/` 定义最小、稳定、
版本化的 Host Protocol，再由各部署端分别适配；移动端实现继续位于 `src/` 与 `src-tauri/`，云端或独立服务
不得反向混入生产 APK。

离线本地态仍是默认权威来源。远程模式不能隐式把本地数据变成云端数据；同步、冲突解决、远端删除、
设备丢失、会话可重放性和附件传输都必须作为独立数据方案设计，不能由通用 RPC 顺带承担。

### 11.5 稳定 Host Protocol 与 AI 生成 Adapter

AI 可以根据外部软件的 HTTP、WebSocket、MCP 或专有协议即时生成 Connector Adapter，但不能为每次连接
重新发明宿主协议。Host Protocol 应只提供少量稳定原语：

- 查询 Host、协议版本和当前可授权能力。
- 创建、恢复、分支和订阅会话。
- 发送 Content Parts，并以流式事件接收 Agent、消息和 Tool 状态。
- 请求 Tool 执行，提交外部 Tool Result，并传播取消和超时。
- 读取或修改经过 Capability 授权的数据。
- 安装、启停、诊断和回滚允许的插件类型。
- 请求、展示和撤销权限，不传输秘密明文。

外部对接关系应保持为：

```text
外部软件协议
  ↕
AI 生成的 Connector Adapter
  ↕
版本化 Host Protocol
  ↕
Capability Broker
```

Connector 必须声明可访问域名、网络方法、数据范围、凭据引用、事件订阅、重试策略和资源预算。所有输入在
边界清洗，未知能力默认拒绝，联网和副作用操作进入既有审批与 Journal。AI 可以编写和修复 Adapter，
但不能自行扩大 Manifest、绕过用户审批或获得凭据明文。

Runtime Plugin、Connector Plugin、Sandbox App Plugin 与 Native Adapter 面向不同变化源和信任等级；未来即使
共享部分 Schema 或 SDK，也不能合并为万能 Bridge 或共用执行权限。

### 11.6 正式立项的前置门槛

本方向只有在当前受控插件生态形成闭环后才进入方案评审。正式实现至少需要：

- 阶段 D–E 的 Manifest、来源验证、权限撤回、卸载清理和生态试运行已经完成。
- UI 扩展口和 Host Capability 已经版本化，并能在插件缺失或不兼容时安全降级。
- 生成物具备确定的构建环境、依赖白名单、模拟测试、资源预算、版本固定和可复现产物。
- Headless Host 的身份、协议、存储权威、升级、发现、认证和恢复模型已经独立评审。
- 远程访问完成威胁建模；默认不监听公网，不因便利开放 Shell、通用文件系统或宿主进程代码执行。
- 旧会话、旧 Profile、旧 `.mtplugin` 和 SillyTavern Compatibility Runtime 有明确迁移或兼容降级路径。

远期验收目标不是“AI 能生成一段可以运行的代码”，而是：用户可以在几分钟内用自然语言塑造一套临时
体验或外部连接，并且每个产物都可解释权限、可隔离验证、可撤销、可回滚、可迁移，不污染宿主核心，
也不破坏本地优先的数据权威。
