# 当前状态

> 更新日期：2026-08-27。本文只记录当前产品基线、真实缺口和已知风险；历史过程进入
> `docs/history/`，可执行事项统一维护在 [TODO.md](../../TODO.md)。

## 产品与架构基线

- Mobile Tavern 当前是本地优先、多模态、可组合的移动端 Agent Host。
- `Tavern Agent` 默认保持 SillyTavern 兼容体验；`Base Agent` 在关闭 Compatibility Runtime 后仍提供通用聊天、多模态附件和 Agent Runtime 底座。
- `src/kernel/` 只承载通用运行时机制。Agent、聊天、媒体、角色、Prompt、存储、插件和平台适配均位于应用、领域或基础设施层。
- 三条信任边界保持独立：随 App 分发的受信 Runtime Plugin、受控 Worker Plugin，以及用户安装的 `.mtplugin` Sandbox App Plugin。

## 已完成的当前验收范围

- Runtime Profile、Capability Slot、Provider Binding、Contribution 和会话级 Composition Snapshot 已接入组合根。
- Message Content V2、独立附件库、图片/视频/音频分入口选择、分类预览与消息展示、重启恢复、重发/分支、备份恢复和媒体引用生命周期已完成；OpenAI-compatible 图片投影在视觉能力未明确时默认拒绝。
- AgentHandle、Turn、取消、Provider、Tool Registry、有限 Tool Loop 和 Agent Journal 已完成。Base/Tavern Profile 均实际注册只读 `character.read` 与本地写入 `session.branch`；旧会话继续按自己的 Composition Snapshot 冻结 Tool 集合。
- Tool 定义声明权限、风险、副作用、执行 Scope 和 `allow` / `deny` / `ask` 策略。`session.branch` 必须在聊天内“允许一次”后执行；拒绝、取消、超时、宿主不可用均 fail-closed，审批请求、决定、结果与失败进入同一 Agent Journal 并在聊天历史展示。
- 音频 ASR 和视频关键帧处理器已作为受信 Runtime Plugin 贡献接入；Anthropic 原生音视频投影仍明确拒绝，不做静默降级。
- Compatibility Runtime 已从通用生产代码中隔离。`Base Agent` 不装载兼容插件，`Tavern Agent` 可装载、关闭、卸载和重载；旧 `session.variables` 只保留读取降级和插件内部瞬时投影。
- Profile 设置、复制、能力开关、跨 Profile 会话恢复和运行诊断已完成。旧 `legacy.tavern.driver`、隐式全局 capability catalog 和默认注册路径已清理；任意 Runtime Plugin 安装仍关闭。
- External Tool Plugin 已完成本地 L2 闭环：严格校验 v1 Manifest 与 v2 `.mttool`、SHA-256、包路径/体积和 JSON Schema；支持声明式 HTTPS Tool、一次性受限 Worker、宿主网络配额、加密凭据注入、Agent Runtime 注册、新会话快照、即时权限撤销、停用、回滚清权与完整卸载。它与受信 Runtime Plugin、内置 Worker Plugin 和 `.mtplugin` 沙箱保持独立。
- 社区服务仓库代码已经包含 20 MB 上传限制、双哈希去重、评论限流、缩略图、管理员删除和时间戳记录；线上最新二进制是否部署必须单独复验。
- GitHub Quality Gate 已执行相对目标分支的改动文件 ESLint，`pre-commit` 已执行暂存 TS/TSX ESLint；Dependabot 和 PR 语义化标题校验已配置。`main` 分支保护的 required check 仍需仓库管理员在 GitHub 设置中启用。
- 聊天入口已改为并行准备角色、会话和最近消息，长消息使用虚拟列表底部锚定；历史页已接通 cursor 分页。触屏端关闭大面积毛玻璃和背景循环平移，图片分批请求与异步解码，键盘 viewport 同步不再触发主布局 React 重渲染。
- 全局确认/输入、角色编辑、会话管理、年表、角色详情、角色操作、本地扫描、记忆中心/片段编辑、主题编辑、Regex 编辑、社区上传/详情和运行诊断等交互遮罩已收敛到 Base UI Dialog/BottomSheet 语义；Android 返回键按遮罩、子页、主页分层处理，前台恢复会重新同步 Safe Area 与可视视口。
- 冷启动只保留一个 Web Splash 挂载源；Android 系统层、WebView 空白首帧与 Web Splash 统一为固定品牌底色和透明品牌前景，用户主题在进入主界面后再接管，避免 Logo 二次闪烁与底色拼接。
- UI 性能回归已覆盖桌面 Chromium 与 Pixel 5 尺寸的冷启动、Tab 冷/热切换、viewport resize、CLS、Long Animation Frame、触控目标、底栏键盘导航、横竖屏草稿/焦点和 Safe Area 恢复；长会话验收同时记录 heap、DOM、延迟与虚拟列表滚动帧间隔。Dialog 焦点圈定、Escape、焦点恢复以及触屏去模糊、减少动态、图片解码/懒加载和 Tab 分包均有独立回归守卫。Android 真机采样脚本已纳入仓库，等待已授权设备执行。

## 当前未完成事项

1. **External Tool Plugin 来源治理**：L2 本地执行、精确版本依赖检查和生命周期已完成；尚无签名/可信来源、远程版本撤回、生态审核与官方 SDK。任意 Runtime Plugin 安装仍关闭，External Tool 也不开放后台常驻和原生能力。
2. **社区生产对齐**：本地实现与线上部署存在版本差异，需服务器权限、管理员令牌和真实公网验收。
3. **质量治理外部项**：`main` 分支保护与 required check 需要仓库管理员在 GitHub 设置中启用；覆盖率门禁尚未配置。
4. **测试与平台**：Hook/跨组件契约测试仍需补强；Android UI 性能与 AR 兼容性待已授权真机复验；iOS 尚未开发或构建。

## 推荐执行顺序

1. 先完成社区线上版本对齐（外部发布条件满足时执行）。
2. 接续 External Tool Plugin 的签名/可信来源、远程版本撤回、生态审核与 SDK。
3. 阶段 D 稳定后再进入 Tool Plugin SDK 与生态试运行。
4. 同步补强跨组件回归测试并评估覆盖率门禁。

## 权威入口

- 目标架构与阶段验收：[agent_plugin_runtime_roadmap.md](agent_plugin_runtime_roadmap.md)
- 模块边界：[runtime_boundaries.md](runtime_boundaries.md)
- 契约细节：[module_contracts.md](module_contracts.md)
- 活跃待办：[../../TODO.md](../../TODO.md)
- 历史记录：[../history/](../history/)
