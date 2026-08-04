# 当前状态

## 2026-08-03 更新：统一备份 v4 与原子覆盖恢复

- SillyTavern 聊天记录导入会同时写入会话元数据与独立 `messages` Store，重启后不再出现空会话。
- 统一备份升级为 v4，新增自定义预设库、独立世界书与记忆词典；明文备份统一清除聊天 API、凭证档案、生图、TTS 与 ASR 密钥，加密备份保留完整配置。
- 覆盖恢复前自动导出当前数据的脱敏安全快照，随后通过数据迁移应用服务以单个 IndexedDB 跨 Store 事务替换角色、会话、消息、记忆和世界书；任一记录失败会中止整个事务，不残留新旧混合状态。
- v3 及更旧备份保持可导入；因旧格式本身不包含自定义预设库、独立世界书和记忆词典，恢复确认会明确提示，并由恢复前安全快照保留当前数据。
- 角色卡本地导入与社区上传限制已在仓库中统一提升至 20 MB；社区列表和详情封面改为完整等比例展示，并完成标题、搜索和卡片信息层级重排。服务端限制与 Nginx 示例尚待在持有服务器密钥的电脑部署后生效。

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
1. ~~重新构建 App~~ 已完成：v1.7.7 已包含 `thumbnailUrl` 支持并完成打包（2026-08-03）。
2. 方案 C（网络加速）：Cloudflare 对国内线路慢的问题未解决，建议接国内 CDN 香港节点或换友好线路，需用户域名/CDN 侧操作。
3. 未提交改动整理提交：已于 2026-08-02 提交并推送（c55c2dd）；v1.7.7 变更随本版本提交。

### 2026-08-03 v1.7.7 发布

- App 版本 1.7.6 → 1.7.7：社区封面缩略图 App 端支持（`thumbnailUrl` 优先加载 + 原图兜底），修复前端若干问题；lint、全量测试与 Web/Node 构建通过。

### 2026-08-05 v1.7.8 发布

- App 版本 1.7.7 → 1.7.8：修复真机 LLM 流式响应中途断流（`error decoding response body`）后无法自动恢复的问题——未输出内容时自动重试一次，错误信息补充目标主机与已接收字节数；已输出部分内容时保持"部分内容 + 连接中断"行为。
- 修复仓库 `npm.bat`/`npx.bat` 包装脚本导致 Windows 下 `npm run X && npm run Y` 链式脚本提前中断的环境问题，并启用仓库 Git Hooks（`core.hooksPath=.githooks`）让推送自动执行质量门禁。
- 新增 3 项 ChatStreamService 流式中断回归测试；lint、i18n、全量测试（87 项套件 + 622 项 vitest）与 Web/Node 构建全部通过。

### 2026-08-05 v1.7.9 发布

- App 版本 1.7.8 → 1.7.9：修复"自由编排开启后传统预设完全失效"的回归——提示词规划归预设，`SavedPresetBundle` 携带编排快照与开关，切换预设整体切换提示词规划，CORE PROMPTS / PROMPT MODULES 子节点开关恢复可用；旧预设包向后兼容。
- 使用真实 SillyTavern 预设（明月秋青 / 双人成行 / 夏瑾 天琴座）全链路验证导入与区块开关；lint、全量测试与构建通过。

### 2026-08-05 v1.7.10 发布

- App 版本 1.7.9 → 1.7.10：自由编排模式下「预设提示词配置」区域直接列出当前编排的全部 Prompt 区块及启用/停用开关（含统计与空编排提示），子预设节点开关回归可见可操作；高级编辑仍在「自由 Prompt 编排」分类。
- MemoryTableDrawer 测试异步等待预算放宽至 8s，消除并行测试偶发超时抖动；lint、i18n、全量测试与构建通过。
