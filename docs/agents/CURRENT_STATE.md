# 当前状态

- 日期：2026-07-30。
- 主线：移动端底座解耦、聊天链路稳定性、Kernel 边界收敛、Tauri AR 插件与手势权限联调。
- 最近完成：落地 Zod 运行时与服务检索校验，实现 SafeProxy 契约标记；补全消息懒加载、并发事务控制与 Abort 信号底层句柄自愈测试。长期记忆升级为事件型片段与可审计记忆包，重发分支、会话删除与统一备份同步覆盖独立 `memory_fragments` Store。Tauri AR 插件（tavern-ar）完成底层单参数授权反射、瞬态 checkAvailability 轮询和精细化 Session 错误分流。
- 架构进展：Kernel 已收敛为纯运行时机制；仓库内 `localDB` 生产调用清零，业务存储统一走 Service 或领域端口；角色初始化、会话分页与存删流程迁入 `application/useCases`。三条适配边界正式命名为 SillyTavern Compatibility Runtime、Plugin Host RPC、Native Adapter，并由回归守卫阻止互相导入或业务回流 Context。行为指导已改用稳定规则标识和两级按需阅读，默认入口不再承载低频豁免、排障与维护细节。
- 产品进展：平行分支宇宙与记忆脉络图已接入会话管理；长期记忆新增实体关系图谱与可审计时态事实；世界书支持 MVU/会话条件表达式过滤；Plugin Host RPC 以声明权限提供脱敏上下文读取、动作注入和 AI 发送。
- 当前进展：角色卡与内置游戏首页目录已改为轻量加载；完整角色数据和游戏资源仅在用户操作时按需载入，完整备份不受轻量目录影响。`FormattedText`、`SystemReportSection` 与 `MessageBubble` 已按渲染运行时、诊断展示和消息展示职责拆分，并以组件契约回归守卫保持边界。
- 稳定性进展：2026-07-30 完成推送质量门禁和全面回归；84 个测试入口全部通过，其中 Vitest 62 个文件、560 条断言通过，20 项 Playwright E2E、TypeScript 严格检查、八语言一致性、社区 Rust 5 项测试、Web/Node 与 Android APK 构建均通过。
- 当前风险：
  1. 顶层功能继续使用 `React.lazy` 按需分包；页签提交已改为 React Transition，快速加载不再闪烁局部加载态，弱性能设备上的长耗时加载仍需继续观察。
  2. **AR 模式真机硬件兼容风险（已暂缓上线）**：原生 ARCore 插件在真机上运行实例化时，国内部分未通过谷歌 SafetyNet 认证的机型（如 OPPO A97 5G，型号 PFTM10）在底座就绪后仍会抛出 `UnavailableDeviceNotCompatibleException` 硬件级不兼容报错。由于无法跑通最终测试，已在前端默认隐去 AR 📦 调试入口，本功能作暂缓上线处理。
  3. 社区代码已增加双 SHA-256 去重、纯文字评论限流和管理员快捷治理，但线上仍是旧版本；需部署最新二进制，并在具备管理员清理令牌后复验完整生产闭环。
- 产品决策：不建设独立的通用规则触发系统、数据派生计算引擎或移动端脚本代码编辑器；世界书条件引擎仅执行只读布尔过滤，不修改变量。变量更新以角色卡 MVU、`mvu_zod`、`UpdateVariable` 和既有沙盒桥接为唯一兼容链路。AR 降级虚拟背景房间方案暂不推进，保持主线包体轻量。
- 平台范围：Android 通用 Debug APK 已成功构建；当前未连接设备，真机安装与交互冒烟待有设备时补验。iOS 当前不开发、不构建、不纳入验收。
- 下一步：
  1. 体验验收《星渊终焉》与《夜雨试剑》的横屏触控、性能和战斗节奏；后续评估面向非开发者的 AI 插件创作层，以双角色或多 NPC 模板生成气泡交互、游戏状态和 LLM 对话。
  2. AR 模式原生与 TS 桥接代码在仓库中完整保留，等后续有完全兼容的测试机时再重新验收上线。

---

## 2026-08-02/03 更新：社区缩略图上线与线上修复

### 已上线（服务器 173.254.203.206）
- 社区服务新增封面缩略图：上传 PNG 角色卡自动生成最长边 256px JPEG（`/thumbnails/<id>.jpg`），列表接口返回 `thumbnailUrl`；新增 `backfill-thumbnails` 子命令为旧卡回填，3 张旧 PNG 卡已回填完成。
- 线上修复两个"图片无法加载"根因：
  1. 服务器 nginx 主配置补 `include /etc/nginx/mime.types;`（此前 PNG 以 text/plain+nosniff 输出导致 WebView 拒绝渲染）。
  2. 清除 Cloudflare 边缘缓存的旧 text/plain 响应（用服务器 acme.sh 凭据 purge）。
- 补上缺失的 `/health/deep` nginx 路由。
- 端到端验证通过：上传→自动缩略图→nginx 200 image/jpeg→管理员删除并清理。

### 仓库未提交改动（本次功能相关）
- `cloud/minimal-community/`：Cargo.toml（+image）、src/thumbnails.rs（新）、src/backfill.rs（新）、cards.rs（thumbnailUrl 三链路）、database.rs（thumbnail_file_name 迁移）、main.rs、README.md、deploy/nginx.conf.example
- 前端：src/domain/community/api.ts、src/tabs/CommunityTab.tsx（封面优先缩略图+原图兜底）、tests/vitest/CommunityTab.test.tsx、Cargo.lock
- 另有此前一批未提交改动（文档清理、AES 密钥注入、MvuVariables 类型收紧等），均未提交。

### 待办
1. 重新构建 App：当前线上 App 版本不认识 `thumbnailUrl`，封面仍加载完整 PNG；新版本才会走缩略图。
2. 方案 C（网络加速）：Cloudflare 对国内线路慢的问题未解决，建议接国内 CDN 香港节点或换友好线路，需用户域名/CDN 侧操作。
3. 未提交改动整理提交（含补 v1.7.5 changelog、同步本文件）。
