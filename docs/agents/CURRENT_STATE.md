# 当前状态

> 更新日期：2026-10-01。本文只记录当前产品基线、真实缺口和已知风险；历史过程进入
> `docs/history/`，可执行事项统一维护在 [TODO.md](../../TODO.md)。

## 产品与架构基线

- Mobile Tavern 当前是本地优先、多模态、可组合的移动端 Agent Host。
- `Tavern Agent` 默认保持 SillyTavern 兼容体验；`Base Agent` 在关闭 Compatibility Runtime 后仍提供通用聊天、多模态附件和 Agent Runtime 底座。
- `src/kernel/` 只承载通用运行时机制。Agent、聊天、媒体、角色、Prompt、存储、插件和平台适配均位于应用、领域或基础设施层。
- 三条信任边界保持独立：随 App 分发的受信 Runtime Plugin、受控 Worker Plugin，以及用户安装的 `.mtplugin` Sandbox App Plugin。

## 已完成的当前验收范围

- Runtime Profile、Capability Slot、Provider Binding、Contribution 和会话级 Composition Snapshot 已接入组合根。
- `mobile-tavern.agent-profile` v1 已完成文件级闭环：严格校验的小型粘合契约可保存角色/Prompt 引用、Tool 身份、有限采样参数和能力开关，Android WebView 通过原生文件桥保存、Web 通过下载降级；设置页按“角色 → Tool → 行为 → 高级采样”渐进编辑，导入生成新 Profile ID，并对来源冲突、缺失依赖和 Tool 版本漂移返回诊断。Profile 仍不保存角色卡/Prompt 正文、插件包或任何凭据。
- Message Content V2、独立附件库、图片/视频/音频分入口选择、分类预览与消息展示、重启恢复、重发/分支、备份恢复和媒体引用生命周期已完成；OpenAI-compatible 图片投影在视觉能力未明确时默认拒绝。
- AgentHandle、Turn、取消、Provider、Tool Registry、有限 Tool Loop 和 Agent Journal 已完成。Base/Tavern Profile 均实际注册只读 `character.read` 与本地写入 `session.branch`；旧会话继续按自己的 Composition Snapshot 冻结 Tool 集合。
- LLM Provider 防腐层已集中到 Application：按解析后的端点与模型族裁剪参数、把统一推理强度档位（auto/off/low/medium/high/max）映射为各厂商方言并迁移旧布尔开关、适配 `reasoning_content` 回放、归一化多种流式片段，并按完整 Base URL 与模型隔离运行时参数自愈；发送和重生成共用同一适配入口。
- Prompt 预设只由传统 `promptConfig` 驱动（预设实体 v3）：SillyTavern `prompts + prompt_order` 经 Compatibility Codec 的 `readPresetPrompts` 收口为传统提示词列表，无顺序容器时按原序降级保留。**自由编排（Prompt 组装）链路已整块删除**：`domain/prompt-composition`、编排运行时适配器/装配器、`promptPlan` 与 `PromptConfig.composition`/`usePromptComposition` 全部移除，不留兼容读取；v1/v2 旧记录由 `bundleMigration` 只保留传统字段。预设包整体性闭环已补齐：切换预设只整体替换目标预设声明的字段（不再残留上一个预设的内容），可把当前设置（采样 / 提示词 / 预设正则）写回当前预设，存在未保存修改时切换前必须确认，删除被 Agent Profile 引用的预设会提示不可逆后果；出厂自带预设与导入预设完全同权：可直接覆盖保存或删除，仅在预设列表为空时初始化塞入，启动不再重建、也不再重新加回被删除的预设；行为预设（提示词 / 采样 / 预设正则）是全局设置，切换后立即对包括 Agent 会话在内的所有会话生效，不再按会话冻结。导入改为自包含并通过 `extensions.mobile_tavern_preset` 保留 ST 无法表达的运行期开关；启动引导不含任何出厂内容迁移或文本特征扫描，所有预设内容一律原样保留。预设子系统已完成彻底重构（结构收口 + 实体 v2）：启动期引导收口为无 IO 用例 `presetBootstrap`（外部静态文件收口、自带预设初始化、旧键迁移、活跃 Prompt 形状），`presetFactoryRevision` 只用于旧数据归一化写回一次；预设目录的读-改-写下沉为 `presetCatalog`（端口注入 + 串行 mutate），Hook 只剩唯一一处端口装配；SillyTavern 解析单点化到 `promptPresetAdapter`（排序、候选库丢弃与角色映射各只一处，Codec 新增可选能力 `readPresetPrompts`，未装载 Codec 时生态字段刻意降级为不入库）；预设实体收敛为 `PresetBundle` v3（Zod 校验、`promptConfig` 为唯一 Prompt 权威），存储读取经领域迁移入口接受 v1 记录并逐级降级修复，运行期只经唯一投影 `projectPresetActivation` 消费；`localDB` 冻结导出、`presetPromptConfig` shim 与预设路径上的历史 `any` 已清理，上述边界由架构守卫强制。编排链路与工作台已整块删除（含 v1/v2 编排快照的读取路径），导入 SillyTavern 预设不再自动切换运行模式，导入边界与运行期都会去掉与顶层 `mainPrompt`/`jailbreakPrompt` 同源的重复区块；SillyTavern 200+ 复杂大预设解析扩容至 2000 区块并实测 8 款真实社区预设 100% 导入导出通过；彻底修复采样滑块赋 custom 导致预设与活跃包脱钩、脏检查失效、保存按钮被禁用的缺陷，落地权威活跃预设解析 `resolveActivePresetBundle` 与历史 custom 脏 ID 自愈。聊天侧新增末尾候选分支：重掷末尾 AI 回复最多保留 5 条候选并支持翻页，候选推理随消息持久化，下一轮发送时自动固化释放空间且不失效该轮记忆；流式请求改为两阶段超时（首字等待 300s：缓冲型中转站整段生成期间不发字节，60s 会掐掉长回复且按既有策略不自动重试；数据块心跳 60s；超时自包含收口且不自动重试），全局错误处理与遥测 detail 补齐 message、stack 与 HTTP 状态提取。
- Tool 定义声明权限、风险、副作用、执行 Scope 和 `allow` / `deny` / `ask` 策略。`session.branch` 必须在聊天内“允许一次”后执行；拒绝、取消、超时、宿主不可用均 fail-closed，审批请求、决定、结果与失败进入同一 Agent Journal。聊天内只渲染待审批卡片，工具调用汇总与执行结果不再出现在聊天历史，静默保留在 Journal 与诊断数据中。
- 聊天请求的重试策略统一为「一切消耗 token 的请求都不自动重试」：首字超时、数据块心跳超时、响应体中途断流（`error decoding response body`）都只上报错误与诊断（目标主机、已接收字节数），绝不重发；首包未交付时保留用户消息，已交付部分内容时保留「内容 + 连接中断」标记，是否重发只由用户在聊天界面显式触发（`ChatStreamService`、`useSendMessage`、`useRerollMessage`）。
- API 通道档案编辑语义已修正（`domain/api/apiProfiles` 为唯一投影来源）：编辑 Base URL / API Key 不再静默取消当前档案选择，档案与表单不一致时显示「未保存」并提供「保存到当前通道」写回按钮，切换档案或切到临时配置前先确认。此前只有「另存」而没有写回路径，编辑后又会自动退回临时状态，再点「另存」就会复制出内容相同的第二条档案（表现为「两个 API 被合并」）。
- 生成等待期新增屏幕计时与分帧回放：首字未到达时气泡内显示「AI 正在构思… + 已等待秒数」（`GeneratingElapsed`，每秒只在自身组件内重渲染）。首字预算同时由 60s 放宽到 300s，缓冲型中转站的长回复/思考模型不再被误杀；真的挂死可用输入区「停止生成」立即结束。缓冲型到达（单次增量 ≥ 240 字符）不再整段喷出，改由显示层分帧回放（每 60ms 一拍、步长随积压自适应、总时长封顶 1.2s）；到达仍按原样累计，真流式小增量照旧即时显示，取消/切换会话/最终提交都会立刻终止回放。
- 音频 ASR 和视频关键帧处理器已作为受信 Runtime Plugin 贡献接入；Anthropic 原生音视频投影仍明确拒绝，不做静默降级。
- Compatibility Runtime 已从通用生产代码中隔离。`Base Agent` 不装载兼容插件，`Tavern Agent` 可装载、关闭、卸载和重载；旧 `session.variables` 只保留读取降级和插件内部瞬时投影。
- Profile 设置、复制、能力开关、跨 Profile 会话恢复和运行诊断已完成。“保存并开始”会先校验角色、行为预设和 Tool 精确版本，再通过一次性意图重载目标 Profile、创建新会话，并把角色与 Tool 可见性冻结到 Composition Snapshot；Agent 绑定的行为预设与采样只在这次启动时一次性套用，之后完全由用户自由切换，发送和重生成不再按快照改写提示词、编排或采样。快照畸形时仍 fail-closed。旧 `legacy.tavern.driver`、隐式全局 capability catalog 和默认注册路径已清理；任意 Runtime Plugin 安装仍关闭。
- External Tool Plugin 已完成本地 L2 闭环：严格校验 v1 Manifest 与 v2 `.mttool`、SHA-256、包路径/体积和 JSON Schema；支持声明式 HTTPS Tool、一次性受限 Worker、宿主网络配额、加密凭据注入、Agent Runtime 注册、新会话快照、即时权限撤销、停用、回滚清权与完整卸载。可选 `provenance.json` 通过 ECDSA P-256/SHA-256 验证插件身份与内容哈希，管理界面区分未验证、未知有效签名、可信签名和官方内置来源；来源等级只作风险提示，无签名包仍可安装，确认页会说明作者身份、代码审核和后续授权风险。验签失败或身份错配的证明仍拒绝，运行时权限、隔离和高风险单次审批不因来源等级放宽。仓库内作者 SDK 已提供 v2 Manifest/Worker 类型、确定性打包器和可直接导入的无权限文本工具箱示例；SDK 尚未独立发布。它与受信 Runtime Plugin、内置 Worker Plugin 和 `.mtplugin` 沙箱保持独立。
- 社区服务仓库代码已经包含 20 MB 上传限制、双哈希去重、评论限流、缩略图、管理员删除和时间戳记录；社区功能默认关闭，不在生产启用，也不纳入发布验收。
- GitHub Quality Gate 已执行**全仓 ESLint（`npm run lint:all`，仅错误）**与相对目标分支的改动文件 ESLint，`pre-commit` 已执行暂存 TS/TSX ESLint；`quality:push` 同步加入全仓 ESLint。全仓历史错误已清零，避免"只 lint 改动文件"导致债务潜伏（此前 `useSendMessage.ts` 超千行、`MemoryRecall.ts` 两条错误都是这样藏了很久）。Dependabot 和 PR 语义化标题校验已配置。`main` 分支保护的 required check 仍需仓库管理员在 GitHub 设置中启用。
- 聊天入口已改为并行准备角色、会话和最近消息，长消息使用虚拟列表底部锚定；历史页已接通 cursor 分页。触屏端关闭大面积毛玻璃和背景循环平移，图片分批请求与异步解码，键盘 viewport 同步不再触发主布局 React 重渲染。
- 全局确认/输入、角色编辑、会话管理、年表、角色详情、角色操作、本地扫描、记忆中心/片段编辑、主题编辑、Regex 编辑、社区上传/详情和运行诊断等交互遮罩已收敛到 Base UI Dialog/BottomSheet 语义；Android 返回键按遮罩、子页、主页分层处理，前台恢复会重新同步 Safe Area 与可视视口。
- 冷启动只保留一个 Web Splash 挂载源；Android 系统层、WebView 空白首帧与 Web Splash 统一为固定品牌底色和透明品牌前景，用户主题在进入主界面后再接管，避免 Logo 二次闪烁与底色拼接。
- 会话管理器已收敛为“全部／收藏／已归档”三分类：会话必须先归档才能永久删除；收藏会立即生成包含完整消息、角色卡快照、会话记忆、附件和 Agent Journal 的独立校验备份，源会话后续变化只标记“未更新”，并支持手动更新与恢复为新会话。
- 自定义主题编辑已迁入全屏主题工作室：编辑使用独立草稿和作用域预览，不再切换应用根主题；手机按分区编辑，宽屏并排展示固定演示预览，并区分“保存主题”与“保存并应用”。Theme 1.0/1.1、完整语义变量、自定义 CSS 和交互 JSON 继续兼容。
- UI 性能回归已覆盖桌面 Chromium 与 Pixel 5 尺寸的冷启动、Tab 冷/热切换、viewport resize、CLS、Long Animation Frame、触控目标、底栏键盘导航、横竖屏草稿/焦点和 Safe Area 恢复；长会话验收同时记录 heap、DOM、延迟与虚拟列表滚动帧间隔。Dialog 焦点圈定、Escape、焦点恢复以及触屏去模糊、减少动态、图片解码/懒加载和 Tab 分包均有独立回归守卫。Android 真机采样脚本已纳入仓库，等待已授权设备执行。全局环境光晕已改为预烘焙径向渐变，消除 `filter: blur()` + 无限脉冲造成的常驻重绘（真机对照：静置 8 秒 0 帧、交互滑动 0% 掉帧，修复前为常驻 ~61fps 与 11.84% 掉帧）。
- 外部能力通道 M1+M2a+M3a 已落地：除 M0 的协议中立契约、Connector 注册表、MCP driver（仅 Streamable HTTP，legacy/auto/modern 世代协商）与外部 Schema 收口外，来源配置使用独立 IndexedDB 存储，运行时服务把外部工具投影为既有 `AgentToolDefinition`（默认 `ask`、副作用 `external`、权限 `external.source.<id>`）并支持组合快照扩展与逐来源失败隔离；静态凭据（API Key / Bearer，可按来源自定义请求头）以 AES-GCM 加密分轨保存、连接期注入、状态查询不回传明文，删除来源连带删凭据；来源声明资源时派生只读工具 `resources.list`（allow、无副作用）与 `resources.read`（ask），读取白名单只接受连接期声明过的 URI；设置页插件分区新增「外部能力」子页（新增/启停/删除/探测能力/录入凭据）。**OAuth 2.1（M2b）、MRTR 与 ext-tasks（M4）尚未实现**；协议 driver 经动态 import 单独成 chunk（约 213 KB / gzip 58 KB），未配置来源的用户不会加载。外部来源配置与凭据不进入统一备份，与 Tool Plugin 等插件类数据口径一致。
- 工作台新增「扩展能力」聚合视界（`ToolCapabilitiesWidget`，MCP 与宿主 Tool 两个分签）：可一键巡检与逐来源测速、展开查看工具清单与连接诊断、删除来源，并内置「接入第三方 MCP」弹窗（粘贴 Claude Desktop / Cursor 的 `mcpServers` 配置或单个 URL、选用预置模板、手动添加三种入口，stdio 本地进程在移动端被显式拦截并给出原因）。鉴权头与鉴权方案随模板一路带出（`presetToFormValues` → `formValuesToCandidate` 是唯一转换入口，Brave 这类 `x-subscription-token: raw` 的预置不会再退化成 `Authorization: Bearer`），秘密仍只经加密凭据库落盘。单工具「测试调用」是**用户直连诊断入口**：单次、无审批链、不进 Agent Journal，但仍校验来源处于启用状态，撤销后立即失效（见[外部能力通道设计](external_capability_channel_design.md)）。首次挂载的加载带一次性守卫，避免依赖引用变化把加载放大成无限渲染环。

- 通用上下文来源缝 C0–C4 已落地（[设计](context_source_seam_design.md)）：协议中立的来源契约与注册表（并行读取、超时、空占位、稳定排序）、适配器经 `contextContributions` 接纳贡献、**记忆召回迁移为第一个来源**（`memory.recalled` 宏名保留，逐字节黄金对比守住输出）、审计泛化为上下文审计（记忆抽屉入口不变，未纳入且无问题的来源不占版面）、`compat.context-source` 死缝标注并加守卫（禁止长成第二条上下文路径，删除列为有条件清理）、通用输入框命令缝（`ComposerCommandService`）解除 M3b 阻塞并让 **MCP 提示词模板**可用（`/mcp.<source>.<prompt>` 只回填草稿）；顺带实现此前完全缺失的 SillyTavern 日期/时间宏（`{{time}}`/`{{date}}`/`{{weekday}}`/`{{isotime}}`/`{{isodate}}`，作为注册来源接入，格式对齐上游 `macros.js`）。改动提示词权威链的阶段均通过架构守卫与逐字节对比。


- 写入队列与聊天并发治理（P1）已落地：写队列从全局单链改为**按聚合分片**，并把合并语义显式拆成 `coalesceable`（幂等覆盖可共享结果）与 `must-complete`（提交类写入各自独立完成），修掉"提交被合并顶掉"的数据丢失路径，整库迁移（`replace-all` / `merge`）显式独占 `data-migration` 分片；聊天侧新鲜度判断统一收敛为 `TurnToken.isStale`；状态权威三类（authoritative / derived / ephemeral）写死在 [状态权威规范](state_authority.md) 并由守卫禁止视图层直连存储；四项数据路径性能预算（切会话 / ≈20MB 导入 / 记忆召回 P95 / SSE 首字节）随 `npm test` 断言，见 [WebView 界面与性能验收规范](ui_webview_performance.md)。

## 当前未完成事项

1. **External Tool Plugin 生态发布**：仓库内 SDK 尚未独立发布，也未开放公开第三方目录。签名者登记/轮换、SDK 私钥签名命令、远程版本撤回、后台服务和生态审核暂不实现，仅在公开分发规模产生真实治理需求时重新评估。任意 Runtime Plugin 安装仍关闭，External Tool 也不开放后台常驻和原生能力。
2. **质量治理外部项**：`main` 分支保护与 required check 需要仓库管理员在 GitHub 设置中启用；覆盖率门禁尚未配置。
3. **测试与平台**：Hook/跨组件契约测试仍需补强；Android UI 性能与 AR 兼容性待已授权真机复验；iOS 尚未开发或构建。
4. **主题工作室后续**：起点选择、多场景切换、颜色对比度、CSS 语法高亮/行列诊断、片段库，以及媒体/状态/规则的可视化构建器尚待完成；高级 JSON 在此期间继续作为无损兼容入口。

## 推荐执行顺序

1. 按实际需求继续补充 External Tool Plugin 能力实例；只有准备开放公开第三方目录时，再立项签名工具、密钥轮换、远程撤回和生态审核。
2. 在不阻塞 Agent/Tool 主线的前提下继续主题工作室后续，并同步补强跨组件回归测试。

## 权威入口

- 目标架构与阶段验收：[agent_plugin_runtime_roadmap.md](agent_plugin_runtime_roadmap.md)
- 模块边界：[runtime_boundaries.md](runtime_boundaries.md)
- 契约细节：[module_contracts.md](module_contracts.md)
- 活跃待办：[../../TODO.md](../../TODO.md)
- 历史记录：[../history/](../history/)
