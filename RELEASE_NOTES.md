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
