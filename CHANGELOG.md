# 变更日志 (CHANGELOG)

本项目所有重要变更均记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本 (Semantic Versioning)](https://semver.org/lang/zh-CN/)。

---

## [1.5.9] - 2026-06-26

### 新增
- 微内核架构（Kernel）：Kahn 拓扑排序批量装配 + AbortController 全回收
- 防腐层（Anti-Corruption Layer）：cleanRequestPayload / cleanLLMResponse 字段白名单
- 写队列背压机制：key 合并 + 深度上限安全网
- 快速通道优化：L1 管道旁路 / L2 内容预扫描 / L3 AutoSummary 索引缓存
- 安全加固：SSRF 全网段防御 + CSS 消毒 + 原型污染清洗

### 修复
- P0-1：ChatContext 全量加载 sessions 改为分页加载（IndexedDB v7 + createdAt 索引）
- P0-2：AutoSummaryService 全量 getAllSessions 改为 getSessionById 单条直查
- P0-3：cleanRequestPayload 防腐层从 apiClient.ts 迁移至 requestSchema.ts
- P0-4：getAllCharacters 全量反序列化缓解（getCharacterById 缓存）
- P1-7：SSE 连接 60 秒 idle timeout + AbortSignal 清理
- P1-8：Bison setTimeout 改用 bisonChainTimerRef 四点回收
- P1-9：cleanLLMResponse 响应字段白名单清洗
- P1-10：角色卡 extensions 递归过滤原型污染键
- P1-11：写队列 key 合并机制（同 key 仅保留最新 operation）
- P1-12：ChatHistoryTab 三次 reduce 合并到 useMemo
- P1-13：移除 useCharacters 两处 500ms 人工延迟
- 安全：UpdateCheckService 客户端硬编码 HMAC 密钥移除，改为服务端 IP 限流 + 时间戳防重放

### 变更
- 上帝 Hook useChat 退化为 223 行薄壳聚合器
- IndexedDB 物理分轨存储：settings / lorebooks / worldbooks 独立 store

### 延后
- P1-4/5/6：角色卡 avatar/description/lorebookEntries 大字段分轨存储（需 DB v8 迁移）

---

## [1.5.7] - 2026-06

### 新增
- AGENTS.md 核心行为指导手册（10 条准则）
- Tauri Android 原生桥接插件（AndroidThemeBridge）
- 遥测集成架构（Tauri Rust 后端 + 阿里云 SLS）

---

## 版本号物理同步点

每次版本升级需同步修改以下文件（参见 AGENTS.md 准则六）：
1. [package.json](file:///d:/projects/Mobile-Tavern/package.json) `"version"` 字段
2. [tauri.conf.json](file:///d:/projects/Mobile-Tavern/src-tauri/tauri.conf.json) `"version"` 字段
3. [Cargo.toml](file:///d:/projects/Mobile-Tavern/src-tauri/Cargo.toml) `version` 字段
4. [public/version](file:///d:/projects/Mobile-Tavern/public/version) `"pkgVersion"` 键值
5. [server.ts](file:///d:/projects/Mobile-Tavern/server.ts) 两处硬编码版本默认值
6. [README.md](file:///d:/projects/Mobile-Tavern/README.md) 徽章标识
7. [docs/index.html](file:///d:/projects/Mobile-Tavern/docs/index.html) 三处版本号声明
