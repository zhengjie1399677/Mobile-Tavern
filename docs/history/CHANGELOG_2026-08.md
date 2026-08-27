# 2026 年 8 月变更记录

- 2026-08-27：补齐 UI 规范的可执行证据：新增 Base UI Dialog 焦点圈定、Escape 与焦点恢复交互测试，并为触屏去模糊、减少动态、图片解码/懒加载和主 Tab 动态分包建立静态回归守卫；Android 采样脚本新增自定义 adb 路径、逐次慢帧/PSS 和前后台恢复存活报告。
- 2026-08-27：完成 APK/WebView UI 反向审计收口：触屏端统一历史原生控件、表单高度与可读字号下限，补齐插件与 Prompt 系列 Dialog 的 Android 返回键栈，并把主要 Tab 的全量可见控件尺寸及全部互动浮层纳入自动化守卫。
- 2026-08-27：补齐 APK/WebView UI 第二轮治理：聊天键盘检测按帧合并且只在状态转换时更新，旋转后重建高度基准；底栏支持 roving focus 与方向键，核心触控目标和紧凑 Button 尺寸统一；剩余交互遮罩迁入 Base UI Dialog，并新增横竖屏草稿、Safe Area 恢复和长会话滚动帧间隔回归。
- 2026-08-27：启动链路去除 Provider 就绪后的第二次 Web Splash，系统 Splash、WebView 首帧和 Web Splash 统一固定品牌底色 `#01091c`；新增由权威 Logo 确定性生成的透明 `splash-logo.png`，启动阶段不再随用户主题换色。
- 2026-08-27：完成首轮 APK/WebView UI 性能治理：历史会话接通分页，触屏端降低毛玻璃与循环背景动画，列表图片分批异步解码，键盘 resize 脱离 React 顶层重渲染；关键 Dialog/BottomSheet 统一焦点与 Escape 语义，Android 返回键、Safe Area 前台恢复和 Web/移动尺寸性能基线已接入。
- 2026-08-27：聊天主页进入流程改为并行准备角色与最近会话、预取最近消息后再切页；消息区增加明确的加载/重试状态，虚拟列表使用底部锚定稳定异步内容尺寸，并移除多轮定时滚动与 DOM 观察器，降低 WebView 首屏卡顿和闪烁。
- 2026-08-26：多模态附件改为图片、视频、音频独立入口和分类预览/消息展示；新增受控 Tool Plugin Manifest 管理面，支持 SHA-256 校验、来源审阅、逐项授权、停用、回滚清权与完整卸载，外部执行仍保持关闭。
- 2026-08-26：External Tool Plugin 补齐本地 L2：新增 `.mttool` v2 包、声明式 HTTPS Tool、一次性受限 Worker、宿主网络白名单与流量配额、加密凭据注入、Agent Runtime 注册和会话快照；权限或必需凭据撤销会立即阻止旧执行闭包，后台常驻、原生能力、签名来源与远程撤回仍未开放。
- 2026-08-26：Base/Tavern Profile 新增真实内置 `character.read` 与 `session.branch`；Tool 契约补充风险、副作用、执行 Scope 和 `allow` / `deny` / `ask`，聊天内支持一次性允许/拒绝，取消、超时与审批宿主不可用均 fail-closed，全部决定复用 Agent Journal 和 v6 备份。
- 2026-08-26：质量门禁新增相对目标分支/工作区的改动文件 ESLint、pre-commit 暂存 TS/TSX ESLint、PR 语义化标题校验，以及 npm/GitHub Actions Dependabot；远端 `main` 分支保护需仓库管理员在 GitHub 设置中启用。
