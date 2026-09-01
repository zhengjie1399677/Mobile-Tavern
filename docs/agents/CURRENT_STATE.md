# 当前状态

> 更新日期：2026-09-02。本文只记录当前产品基线、真实缺口和已知风险；历史过程进入
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
- LLM Provider 防腐层已集中到 Application：按解析后的端点与模型族裁剪参数、适配关闭思考与 `reasoning_content` 回放、归一化多种流式片段，并按完整 Base URL 与模型隔离运行时参数自愈；发送和重生成共用同一适配入口。
- Prompt 预设已使用 `promptPlan v1` 随预设保存明确运行模式与编排快照；SillyTavern `prompts + prompt_order` 经 Compatibility Codec 转为中立编排，无顺序容器时按原序降级保留。自由编排由单一管线执行场景覆盖、编译、请求整形与最终 Token 审计，发送和重生成只消费权威 `messages`。
- Tool 定义声明权限、风险、副作用、执行 Scope 和 `allow` / `deny` / `ask` 策略。`session.branch` 必须在聊天内“允许一次”后执行；拒绝、取消、超时、宿主不可用均 fail-closed，审批请求、决定、结果与失败进入同一 Agent Journal 并在聊天历史展示。
- 音频 ASR 和视频关键帧处理器已作为受信 Runtime Plugin 贡献接入；Anthropic 原生音视频投影仍明确拒绝，不做静默降级。
- Compatibility Runtime 已从通用生产代码中隔离。`Base Agent` 不装载兼容插件，`Tavern Agent` 可装载、关闭、卸载和重载；旧 `session.variables` 只保留读取降级和插件内部瞬时投影。
- Profile 设置、复制、能力开关、跨 Profile 会话恢复和运行诊断已完成。“保存并开始”会先校验角色、行为预设和 Tool 精确版本，再通过一次性意图重载目标 Profile、创建新会话，并把角色/Tool/行为/采样决定冻结到 Composition Snapshot；发送和重生成按该快照解析行为，引用丢失时 fail-closed。旧 `legacy.tavern.driver`、隐式全局 capability catalog 和默认注册路径已清理；任意 Runtime Plugin 安装仍关闭。
- External Tool Plugin 已完成本地 L2 闭环：严格校验 v1 Manifest 与 v2 `.mttool`、SHA-256、包路径/体积和 JSON Schema；支持声明式 HTTPS Tool、一次性受限 Worker、宿主网络配额、加密凭据注入、Agent Runtime 注册、新会话快照、即时权限撤销、停用、回滚清权与完整卸载。可选 `provenance.json` 通过 ECDSA P-256/SHA-256 验证插件身份与内容哈希，管理界面区分未验证、未知有效签名、可信签名和官方内置来源；来源等级只作风险提示，无签名包仍可安装，确认页会说明作者身份、代码审核和后续授权风险。验签失败或身份错配的证明仍拒绝，运行时权限、隔离和高风险单次审批不因来源等级放宽。仓库内作者 SDK 已提供 v2 Manifest/Worker 类型、确定性打包器和可直接导入的无权限文本工具箱示例；SDK 尚未独立发布。它与受信 Runtime Plugin、内置 Worker Plugin 和 `.mtplugin` 沙箱保持独立。
- 社区服务仓库代码已经包含 20 MB 上传限制、双哈希去重、评论限流、缩略图、管理员删除和时间戳记录；社区功能默认关闭，不在生产启用，也不纳入发布验收。
- GitHub Quality Gate 已执行相对目标分支的改动文件 ESLint，`pre-commit` 已执行暂存 TS/TSX ESLint；Dependabot 和 PR 语义化标题校验已配置。`main` 分支保护的 required check 仍需仓库管理员在 GitHub 设置中启用。
- 聊天入口已改为并行准备角色、会话和最近消息，长消息使用虚拟列表底部锚定；历史页已接通 cursor 分页。触屏端关闭大面积毛玻璃和背景循环平移，图片分批请求与异步解码，键盘 viewport 同步不再触发主布局 React 重渲染。
- 全局确认/输入、角色编辑、会话管理、年表、角色详情、角色操作、本地扫描、记忆中心/片段编辑、主题编辑、Regex 编辑、社区上传/详情和运行诊断等交互遮罩已收敛到 Base UI Dialog/BottomSheet 语义；Android 返回键按遮罩、子页、主页分层处理，前台恢复会重新同步 Safe Area 与可视视口。
- 冷启动只保留一个 Web Splash 挂载源；Android 系统层、WebView 空白首帧与 Web Splash 统一为固定品牌底色和透明品牌前景，用户主题在进入主界面后再接管，避免 Logo 二次闪烁与底色拼接。
- 会话管理器已收敛为“全部／收藏／已归档”三分类：会话必须先归档才能永久删除；收藏会立即生成包含完整消息、角色卡快照、会话记忆、附件和 Agent Journal 的独立校验备份，源会话后续变化只标记“未更新”，并支持手动更新与恢复为新会话。
- 自定义主题编辑已迁入全屏主题工作室：编辑使用独立草稿和作用域预览，不再切换应用根主题；手机按分区编辑，宽屏并排展示固定演示预览，并区分“保存主题”与“保存并应用”。Theme 1.0/1.1、完整语义变量、自定义 CSS 和交互 JSON 继续兼容。
- UI 性能回归已覆盖桌面 Chromium 与 Pixel 5 尺寸的冷启动、Tab 冷/热切换、viewport resize、CLS、Long Animation Frame、触控目标、底栏键盘导航、横竖屏草稿/焦点和 Safe Area 恢复；长会话验收同时记录 heap、DOM、延迟与虚拟列表滚动帧间隔。Dialog 焦点圈定、Escape、焦点恢复以及触屏去模糊、减少动态、图片解码/懒加载和 Tab 分包均有独立回归守卫。Android 真机采样脚本已纳入仓库，等待已授权设备执行。

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
