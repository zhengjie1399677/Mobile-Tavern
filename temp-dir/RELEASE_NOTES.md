# v1.3.1 Release Notes

## 🎉 新增功能 (New Features)
- **酒馆定制版 App 启动图标 (Cozy Tavern Icon Launcher)**:
  - 引入了专为 **Mobile Tavern** 设计的全新高清启动图标：包含温暖发光的琥珀色酒馆提灯与精致的霓虹聊天气泡设计，替换了之前的默认占位图，全面提升了移动端 App 的视觉品质和独特性。
  - 为所有支持的平台自动生成并重新适配了全尺寸图标，包括 Windows `.ico`、macOS `.icns` 以及 Android 和 iOS 的多种启动分辨率。

## 🐛 问题修复 与 构建优化 (Bug Fixes & Build Optimization)
- **无限闪屏卡死问题修复 (Infinite Splash Screen Fix)**:
  - 修复了 `showSplash` 状态初始化为 `true` 却从未在代码中被设为 `false` 的问题。在 [AppContext.tsx](file:///e:/modules/projects/Mobile-Tavern/src/contexts/AppContext.tsx) 中新增了自动延时机制，使闪屏在 App 加载 1.5 秒后自动关闭并淡出，解决应用一直卡在进入屏幕的缺陷。
- **GitHub Actions 构建工作流修复 (GitHub Workflows Build Fix)**:
  - 移除了工作流中因依赖已被删除文件（`decode_icon.cjs` 等）而导致运行失败的冗余 `Generate Tauri Icons` 步骤。
  - 优化并简化了 [package.json](file:///e:/modules/projects/Mobile-Tavern/package.json) 中的 `build:android` 打包脚本，改用标准的 Tauri v2 Android CLI 构建指令 (`npm run build && npx tauri android build --apk --target aarch64`)，限制为只编译 `aarch64` 单架构，大幅缩减 APK 安装包体积，保障了 CI 自动化流水线的顺畅与轻量化执行。

---

# v1.3.0 Release Notes

## 🎉 新增功能 与 架构重构 (New Features & Architecture)
- **免密直连与 STS 安全上报重构 (Direct STS Telemetry)**:
  - 遥测上报架构全新升级。前端客户端正式集成并启用阿里云官方 SDK (`@aliyun-sls/web-track-browser` 与 `@aliyun-sls/web-sts-plugin`)，实现直接向阿里云 SLS 服务端点直传带签名的 HTTPS POST 日志数据。
  - 废弃并移除本地 Server 中转的 SLS 日志代理接口 `/api/proxy/sls`，精简通信链路，显著降低请求延迟，提升高并发上报时的稳定性与可靠性。

## 🚀 性能与可靠性优化 (Performance & Reliability)
- **可靠同步与零丢包重试机制 (Zero Event Loss & Retry)**:
  - 重构了 `syncTelemetry` 方法。只有在 fetch 请求完全成功返回 (HTTP 200 OK) 时，才会安全地将已发送事件从本地待发送队列中清除，100% 解决由于网络波动造成的静默丢包问题。
  - 当由于网络断开或 STS Token 刷新异常导致发送失败时，日志事件将完整保存在本地内存队列中，并等待下一次 15 秒间隔同步时自动发起重试。
- **页面生命周期融合与优雅卸载 (Page Lifecycle & Unload Sync)**:
  - 新增对浏览器/移动端 App 的 `visibilitychange`（页面隐藏）以及 `beforeunload`（页面关闭）生命周期的监听。
  - 引入 `keepalive: true` 参数发送最后的日志，确保在用户快速关闭或切后台时，尚未发送的缓存事件依旧能被完整上传而不会被浏览器取消。
- **网络错误静默处理**:
  - 针对浏览器在 beforeunload/网络断开时产生的、无法避免的 `status 0` 等网络异常，在 console.error 中增加智能匹配过滤，避免输出 false alarms 警报，净化开发者控制台。

---

# v1.2.0 Release Notes

## 🎉 新增功能 (New Features)
- **自定义角色扮演 (RP) 模式开关 (Toggleable Roleplay Mode)**:
  - 在设置面板中引入了 "启用酒馆角色扮演模板 (RP Roleplay Mode)" 选项开关，提供精细化的提示词生成控制。
  - 允许用户灵活选择是否为当前对话应用 SillyTavern 风格的 RP 人设模板和 Jailbreak 越狱指令。
- **提示词生成器 (Prompt Builder) 智能降级**:
  - 重构了 Prompt 组装逻辑，在关闭 RP 模式时自动屏蔽所有的酒馆专用人设模板与额外格式，使大模型能够以最纯粹的直觉模式和通用对话模板来响应，扩大了应用场景的覆盖度。

## 🚀 性能与优化 (Enhancements)
- **人设模板与系统 Prompt 优化**:
  - 精心调整了默认的沉浸式 RP 系统提示词 (mainPrompt)，引导 AI 在扮演角色时生成更具画面感、细节丰富、张力十足的文字描写。

---

# v1.1.0 Release Notes

## 🎉 新增功能 (New Features)
- **阿里云 SLS 日志直传与代理 (Aliyun SLS Telemetry Proxy)**: 新增了具有高安全性、抗跨域 (CORS) 拦截的阿里云日志代理接口 `/api/proxy/sls`，无需前端浏览器暴露或直接包含敏感鉴权凭据，大幅扩增了移动端的日志和埋点支持。
- **STS 安全授权代理 (STS Delegation System)**:
  - 引入了 Aliyun STS (Security Token Service) 角色授权，增加 API 接口 `/api/sts/token` 以动态下发一次性临时凭据给合法的移动客户端。
  - 服务端配置 `ALIYUN_ROLE_ARN` 后自动进行角色扮演 (`AssumeRole`)，极大满足了最低特权的安全管控需求。

## 🚀 性能与优化 (Enhancements)
- **STS 凭据滑窗缓存 (Token Sliding Window Caching)**: 在服务端缓存 STS 取词结果，设定安全的 5 分钟滑窗提前更新窗口。避免高频、并发请求对阿里云 STS 控制层造成流量过载与速率限制拦截，大幅提升遥测代理响应性能。
- **WebTracking 动态降级 fallback**: 支持在云端未配置/没有权限访问 RAM 完整 SDK 时，智能降级为轻量 WebTracking POST 协议以继续提供无害日志回收能力，充分保证链路鲁棒性。
- **频控与风控保障 (Rate Limiting)**: 为所有的遥测上报与 STS 申请接口添加了单 IP 每分钟最多 100 次的节流限流中间件保护，防止网络骚扰与恶意 API 轰炸。

## 🐛 问题修复 (Bug Fixes)
- **修复 RAM/STS 鉴权限制**: 针对 RAM 子用户权限受限引起的 `Unauthorized` / `PostLogStoreLogs` 401 报错，升级其凭据判定逻辑，提供可控的诊断错误输出。
- **隐藏服务器内部配置敏感细节**: 屏蔽不应向外透传的项目名称与 SLS Region 指向，避免因客户端主动上报目标节点而产生 SSRF 漏洞威胁。

---

# v1.0.0 Release Notes

## 🎉 新增功能 (New Features)
- **核心交互**: 完成了与大语言模型的对话交互界面支持，包含聊天气泡、会话记录、角色卡片等。
- **角色卡系统**: 支持导入、导出和编辑角色卡片，自定义角色设定。
- **配置管理**: 完整的设置面板，支持配置 API Key、选取模型 (Gemini)、切换主题等。
- **历史记录**: 持久化保存聊天记录。

## 🚀 性能与优化 (Enhancements)
- **UI 优化**: 改进了深色/浅色主题的视觉体验与响应式布局。
- **本地存储**: 采用本地存储机制保障用户数据的隐私与安全。

## 🐛 问题修复 (Bug Fixes)
- 初始稳定版本发布，确保核心对话链路顺畅。
