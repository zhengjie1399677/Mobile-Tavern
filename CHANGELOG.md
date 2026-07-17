# 变更日志 (CHANGELOG)

本项目所有重要变更均记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本 (Semantic Versioning)](https://semver.org/lang/zh-CN/)。

---

## [1.7.0] - 2026-07-15

### 新增
- **完整 i18n 国际化体系**：6 种语言（简体中文、繁体中文、English、日本語、Русский、Español）全线补齐 710+ 翻译 key，覆盖全部 UI 组件。支持运行时语言切换与三级回退链降级。
- 快捷继续功能：在聊天输入区快捷操作面板中新增"继续"按钮。允许用户一键发送"继续"指令，指示 AI 续写接下来的剧情，且当会话流式发送中或无活跃会话时按钮会自动置灰禁用。
- 原生桥接与 Zod 校验增强：实现了 Zod schema mock 工具（支持 SillyTavern MVU 元组校验），并进一步集成了核心 Native 桥接服务。

### 优化与修复
- 优化了 MVU 脚本中间件执行逻辑。
- 修复了多场景下的资源泄漏与逻辑 bug，进一步优化了事件通知机制。
- 新增多类单元测试，并修复与稳固了 E2E 测试用例。
- 优化了快速对话选项（QuickDialogueOptions）的 useEffect 依赖和 TTS 播放检测逻辑。
- 优化了流式聊天体验与变量同步机制。
- 版本升级：使用一键脚本同步升级应用发布版本号至 `1.7.0`。

## [1.6.5] - 2026-07-11

### 优化与修复
- 修复了 Android 原生 WebView 的一系列兼容性与适配问题。
- 优化了内存和消息服务（Memory / Message Services），并完成了会话轮次索引一致性（Turn Index Consistency）测试套件的开发。

## [1.6.4] - 2026-07-07

### 优化与修复
- 多维记忆中心整合：合并原聊天界面头部的“记忆档案柜”和“剧本对白/故事年表”子 Tab 切换器为统一的纯文字“记忆”Dropdown 菜单，极大净化了聊天界面布局。
- 故事年表多维一体化：在多维认知记忆中心抽屉（`MemoryTableDrawer`）中新增“故事年表”标签页，支持直接在抽屉内查看、补充、编辑和进行年表分支推写，规避多重滚动条或冗余边距。
- 语音朗读 Markdown 消毒：在 TTS 服务中加入了自动文本清洗机制，剔除粗斜体星号（`*`）、下划线（`_`）以及可能引发发音读错或异常停顿的引号（`"`、`“` 等），防止语音朗读时读出“星号”或“双引号”等符号。
- 变量修改安全保护：修复了在执行 MVU 脚本时由于核心未注册 database 服务导致 SafeProxy 拦截抛错的问题，加入了 hasService 安全守护。
- 一键版本号同步：升级应用发布版本号至 `1.6.4`，已覆盖 package 描述、Tauri 构建、Rust 后端及文档说明。

## [1.6.3] - 2026-07-06

### 新增
- 语音交互生态：新增 TTS 语音合成（支持 Web SpeechSynthesis 和 OpenAI TTS）与 ASR 语音识别（支持 Web Speech API 和 OpenAI Whisper），实现完全浸入式语音对白扮演。
- AI 绘图生图组件：新增 DALL-E-3 绘图支持，配合外观与上下文，支持后台自动生成高内聚的英文画质绘图 Prompt。
- 自适应上下文引擎：移除了硬编码的 12k 上限。增加已知主流模型特性表（Gemini 2M, Claude/GPT/DeepSeek 1M）并解耦渲染器，支持用户在设置中自定义上下文上限与强制 XML / Markdown 输出格式。
- 野牛连连看回复模式（Bison Mode）：支持基于触发概率计算的自动多消息队列连续生成，深度丰富场景细节。
- RPG 看板与状态表引擎：支持角色卡内嵌 UpdateVariable/initvar 表格状态控制，规范化 updateRow/insertRow 数据库行为，删除了低效矛盾的优先级提示词。

### 优化与修复
- 思维链（CoT）防污染：对 `DEFAULT_REASONING_GUIDANCE_PROMPT` 进行 100% 中文汉化规训，加入视角隔离（严禁在 think 内以第一人称扮演）与剧本草稿阻断限制，防止思维链污染正文。
- 移除了冗余的时空领航格式维持预设（`FORMAT_PRESERVATION_BUNDLE`），并在设置加载层加入数据库自动清除机制，平滑老用户版本迁移。
- 一键版本号同步：将应用发布版本号同步更新至 `1.6.3`，覆盖 package 描述、Tauri 构建、Rust 后端及文档说明。

---

## [1.6.0] - 2026-06-26

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
