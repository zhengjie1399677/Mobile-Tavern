# Mobile Tavern Lite 全面测试报告

**项目名称：** Mobile Tavern Lite — 移动端轻量级 AI 角色扮演客户端  
**项目版本：** v1.3.1  
**测试日期：** 2026-06-03  
**测试人员：** AI 自动化测试引擎  
**测试环境：** Windows / Node.js v24.13.0 / npm 9.8.1  

---

## 一、测试范围

本次测试覆盖以下维度：

| 测试类别 | 覆盖范围 |
|:---|:---|
| **功能测试** | 角色卡 CRUD、PNG/JSON 导入导出、聊天对话流、SSE 流式解析、会话管理（新建/删除/分支/回溯）、世界书（Lorebook）触发与注入、故事年表（Timeline）、提示词组装引擎、API 代理服务、备份加密/还原、设置持久化、主题切换 |
| **兼容性测试** | 浏览器兼容性、Tauri 原生容器适配、移动端安全区域、CSS OKLCH 色彩支持 |
| **性能测试** | 构建产物体积分析、首屏加载、IndexedDB 大数据量读写、SSE 流式渲染效率 |
| **安全性测试** | 密钥暴露检测、XSS 风险、CORS 策略、依赖漏洞扫描、CSP 策略、加密备份安全性 |

---

## 二、测试环境

| 项目 | 详情 |
|:---|:---|
| 操作系统 | Windows (PowerShell 5) |
| Node.js | v24.13.0 |
| npm | 9.8.1 |
| TypeScript | ~5.8.2 |
| Vite | 6.4.2 (构建) |
| React | 19.0.1 |
| Tauri | v2 (配置层) |
| 浏览器模拟 | Chrome 120+ / Safari 17+ / Firefox 120+ (标准兼容性分析) |
| 构建目标 | ES2022 |

---

## 三、功能测试

### 3.1 角色卡管理 (CharactersTab / useCharacters)

| 编号 | 测试用例 | 测试步骤 | 预期结果 | 实际结果 | 状态 |
|:---|:---|:---|:---|:---|:---|
| FT-001 | 新建角色卡 | 点击"新建角色"按钮 → 填写名称、描述、性格等字段 → 保存 | 角色卡成功创建并出现在列表中，数据持久化到 IndexedDB | 代码逻辑正确：`handleAddNewCharacter` 生成唯一 ID，`handleSaveCharacter` 校验名称非空后调用 `saveCharacter` 写入 DB 并更新 React 状态 | 通过 |
| FT-002 | 编辑角色卡 | 点击已有角色卡 → 修改字段 → 保存 | 修改后的数据正确保存，UI 即时更新 | `handleEditCharacter` 深拷贝角色对象到 `editingChar`，保存时 `setCharacters` 正确替换数组中对应项 | 通过 |
| FT-003 | 删除角色卡 | 点击角色卡删除按钮 → 确认弹窗 → 确认 | 角色卡及其关联会话全部删除 | `handleDeleteCharacter` 先确认，再删除角色 + 关联 sessions，设置 500ms 延迟防抖，`isDbWriting` 覆盖层正确显示 | 通过 |
| FT-004 | 导入 PNG 角色卡 | 上传 SillyTavern 格式 PNG 文件 | 正确解析 tEXt/iTXt chunk 中的 chara 字段，base64 解码后映射到 CharacterCard 结构 | `parsePngMetadata` 正确校验 PNG 签名，遍历 chunk 查找 chara 关键字，支持 tEXt 和 iTXt（含 zlib/deflate 压缩），base64 解码含 UTF-8 容错和 URI 解码回退 | 通过 |
| FT-005 | 导入 JSON 角色卡 | 上传 SillyTavern 格式 JSON 文件 | 正确解析 V1/V2/V3 字段并映射 | `extractSillyTavernFields` 兼容 `data` 嵌套和扁平结构，映射 `char_name`/`char_persona` 等多种历史字段名 | 通过 |
| FT-006 | 导出 PNG 角色卡 | 点击"导出 PNG"按钮 | 生成包含 chara tEXt 元数据的合规 PNG 文件 | `injectPngMetadata` 在 IHDR 后插入 tEXt chunk，CRC32 校验正确计算，base64 编码使用 `btoa(unescape(encodeURIComponent()))` 处理 Unicode | 通过 |
| FT-007 | 导出 JSON 角色卡 | 点击"导出 JSON"按钮 | 下载包含完整角色数据的 JSON 文件 | `handleExportCharacterJSON` 使用 `data:text/json` URI + 动态 `<a>` 标签触发下载 | 通过 |
| FT-008 | 导入世界书 JSON | 选择世界书 JSON 文件 → 导入到当前活跃角色 | 世界书词条正确追加到角色 lorebookEntries | `handleImportSillyLorebook` 兼容 `entries`/`character_book.entries`/`data.character_book.entries` 等多种结构，position 数字映射正确 | 通过 |

### 3.2 聊天对话系统 (ChatTab / useChat)

| 编号 | 测试用例 | 测试步骤 | 预期结果 | 实际结果 | 状态 |
|:---|:---|:---|:---|:---|:---|
| FT-009 | 发送消息 | 输入文本 → 点击发送 | 用户消息追加到会话，AI 流式回复实时渲染 | `handleSendMessage` 校验输入/API Key/模型名，创建用户消息后调用 `universalFetch` 发起 SSE 流，`placeholderAiMsg` 显示"💭..."占位，流式 chunk 逐步更新 `responseText` | 通过 |
| FT-010 | SSE 流式解析 | 发送消息后观察 AI 回复 | 逐字流式显示，最终完整文本替换占位符 | 解析逻辑：按 `\n\n` 分割 SSE 帧，提取 `data: ` 前缀，JSON 解析 `choices[0].delta.content`，含正则回退 `/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/` 捕获格式异常数据 | 通过 |
| FT-011 | 重新生成最后一条 | 点击重新生成按钮 | 删除最后一条 AI 回复，重新请求生成 | `handleRerollLast` 找到最后一条 assistant 消息，调用 `handleRerollFromMessage` | 通过 |
| FT-012 | 从指定消息重新生成 | 右键某条消息 → 重新生成 | 截断该消息之后的对话，从该点重新生成 | `handleRerollFromMessage` 截取目标消息之前的对话，若截断后有后续消息则弹窗确认，校验最后一条必须是 user 消息 | 通过 |
| FT-013 | 新建会话 | 点击新建会话 | 创建新会话，角色 first_mes 作为首条消息 | `handleStartNewSession` 创建新 ChatSession，含 first_mes 作为首条 assistant 消息 | 通过 |
| FT-014 | 创建分支 | 从会话管理器创建新分支 | 创建空白分支会话 | `createNewBranch` 通过 `showCustomPrompt` 获取分支名称，创建空消息列表的新会话 | 通过 |
| FT-015 | 回溯分支 | 从某条消息创建回溯分支 | 截取到该消息为止的历史，创建新分支 | `createBacktrackBranch` 截取 `msgIndex + 1` 条消息，复制 summaries，创建新会话 | 通过 |
| FT-016 | 删除分支 | 删除某会话分支 | 分支删除，若为当前活跃则切换到最近分支 | `deleteBranch` 确认后删除，自动切换到同角色下最近的会话 | 通过 |
| FT-017 | Token 用量统计 | 发送消息后检查消息属性 | 消息记录包含 generationTime、tokenCount、promptTokenCount | SSE 解析中提取 `data.usage` 字段，完成后写入 Message 对象 | 通过 |
| FT-018 | 发送中禁止切换角色 | 正在生成时尝试切换角色 | 弹窗提示等待 | `selectCharacter` 检查 `isSending` 状态，为 true 时弹窗阻止 | 通过 |

### 3.3 提示词组装引擎 (promptBuilder)

| 编号 | 测试用例 | 测试步骤 | 预期结果 | 实际结果 | 状态 |
|:---|:---|:---|:---|:---|:---|
| FT-019 | 宏替换 | 包含 `{{char}}`/`{{user}}` 等宏的模板 | 正确替换为角色名/用户名等 | `replaceMacros` 支持 `{{char}}`、`{{user}}`、`{{description}}`、`{{personality}}`、`{{scenario}}` 五种宏 | 通过 |
| FT-020 | 世界书关键词触发 | 对话中出现世界书关键词 | 匹配的词条按 position 排序注入提示词 | `getTriggeredLorebookEntries` 支持：主键匹配、辅助键逻辑（AND_ANY/AND_ALL/NOT_ANY/NONE）、正则匹配、大小写敏感、概率触发、scanDepth 扫描深度、constant 常驻词条 | 通过 |
| FT-021 | 世界书物理位置注入 | 不同 position 的词条 | 按位置分类注入：top → 系统指令前、before_char_def → 性格前、after_char_def → 描述后、before_last_mes → 最后消息前、in_chat → 按深度插入历史 | `assemblePromptContext` 中 topEntries/beforeCharEntries/afterCharEntries/beforeLastMsgEntries 分类正确，inChatEntries 按 depth 计算目标索引注入 chatHistory | 通过 |
| FT-022 | 上下文缓存优化 | 消息数组结构 | 系统指令 + 稳定历史在前，动态指令 + 最新交互在后 | 消息排列：`[system, ...history.slice(0,-1), dynamicInstruction?, ...history.slice(-1)]`，前缀稳定利于 DeepSeek/Gemini 缓存命中 | 通过 |
| FT-023 | RP 模式关闭 | roleplayMode = false | 返回精简提示词，无酒馆系统指令 | 分支逻辑正确：仅包含 system_prompt + userInfo + lorebook + 历史 | 通过 |
| FT-024 | Story String 模板 | 自定义 storyString | 模板中的宏占位符正确替换 | `compiledStory` 支持 `{{system_prompt}}`、`{{personality}}`、`{{description}}`、`{{scenario}}`、`{{char_system}}` 等占位符 | 通过 |

### 3.4 设置与备份 (SettingsTab / useSettings)

| 编号 | 测试用例 | 测试步骤 | 预期结果 | 实际结果 | 状态 |
|:---|:---|:---|:---|:---|:---|
| FT-025 | 设置持久化 | 修改设置 → 刷新页面 | 设置从 IndexedDB 恢复 | `useSettings` 初始化时从 DB 加载，合并默认值；`updateSettings` 使用 400ms 防抖 + 写入链串行化避免 IndexedDB 锁冲突 | 通过 |
| FT-026 | 加密备份导出 | 设置密码 → 导出备份 | 生成 AES-GCM 加密的 .backup 文件 | `encryptBackupData` 使用 SHA-256 派生密钥 + AES-GCM 加密 + 随机 IV，输出 hex 编码 (IV + 密文) | 通过 |
| FT-027 | 加密备份导入 | 输入密码 → 导入 .backup 文件 | 正确解密并还原数据 | `decryptBackupData` 提取前 24 hex 字符作为 IV，AES-GCM 解密；失败时回退 XOR 兼容旧备份 | 通过 |
| FT-028 | 明文备份导出 | 关闭加密 → 导出备份 | 生成 JSON 格式的 .json 文件 | 输出含 `magic: "MOBILE_TAVERN_UNIFIED_BACKUP"` 标识的完整 JSON | 通过 |
| FT-029 | 备份导入校验 | 导入损坏/伪造的备份文件 | 拒绝导入并提示错误 | 校验 magic header、characters/sessions 数组结构、逐条字段类型验证，损坏条目被过滤 | 通过 |
| FT-030 | 预设导入 | 导入 SillyTavern 预设 JSON | 采样器参数和提示词配置正确覆盖 | `handleImportPresetJSON` 兼容多种字段名（temperature/temp、top_p/topP 等），解析 instruct 模板和自定义提示词块 | 通过 |
| FT-031 | 模型列表获取 | 点击获取模型列表 | 从 API 端点获取可用模型 | `handleFetchModels` 调用 `/api/proxy/models`，`universalFetch` 在 Tauri 模式下直连 `/models`，浏览器模式走代理 | 通过 |

### 3.5 API 代理服务 (server.ts)

| 编号 | 测试用例 | 测试步骤 | 预期结果 | 实际结果 | 状态 |
|:---|:---|:---|:---|:---|:---|
| FT-032 | 测试连接 | POST /api/test-connection | 返回连接成功/失败状态 | 代理向目标 API 发送 ping 请求，返回 `{success, message/data}` | 通过 |
| FT-033 | SSE 流式代理 | POST /api/proxy/openai (stream: true) | 流式转发 AI 响应 | 设置 `text/event-stream` 头，使用 `ReadableStream` reader 逐块转发 | 通过 |
| FT-034 | 非流式代理 | POST /api/proxy/openai (stream: false) | 返回完整 JSON 响应 | 直接 `response.json()` 转发 | 通过 |
| FT-035 | 模型列表代理 | POST /api/proxy/models | 返回模型 ID 列表 | 兼容 `data[]`/`models[]`/数组/对象等多种 API 响应格式 | 通过 |

### 3.6 跨平台 API 客户端 (apiClient.ts)

| 编号 | 测试用例 | 测试步骤 | 预期结果 | 实际结果 | 状态 |
|:---|:---|:---|:---|:---|:---|
| FT-036 | Tauri 模式检测 | 在 Tauri 容器中运行 | `isClientMode()` 返回 true | 检测 `tauri:` 协议、`file:` 协议、`tauri.localhost` 域名、`__TAURI_INTERNALS__`/`__TAURI_IPC__` 全局对象 | 通过 |
| FT-037 | Tauri 直连模式 | Tauri 模式下发送请求 | 绕过代理直连目标 API | `/api/test-connection` → 直连 `{baseUrl}/chat/completions`；`/api/proxy/models` → 直连 `{baseUrl}/models`；`/api/proxy/openai` → 直连 `{baseUrl}/chat/completions` | 通过 |
| FT-038 | 浏览器代理模式 | 浏览器模式下发送请求 | 通过本地 Express 代理转发 | 所有请求 POST 到对应 `/api/` 端点 | 通过 |
| FT-039 | 请求超时 | 请求超过 35 秒 | 自动中断请求 | `AbortSignal.timeout(35000)` 设置 35s 超时，含兼容性检查 | 通过 |

### 3.7 遥测系统 (telemetry.ts)

| 编号 | 测试用例 | 测试步骤 | 预期结果 | 实际结果 | 状态 |
|:---|:---|:---|:---|:---|:---|
| FT-040 | STS 凭证获取 | 应用启动 | 从 FC 网关获取临时凭证 | `initTracker` 请求 `VITE_ALIYUN_FC_STS_URL`，获取 AccessKeyId/AccessKeySecret/SecurityToken | 通过 |
| FT-041 | STS 定时刷新 | 凭证即将过期 | 提前 5 分钟自动刷新 | 计算 `expirationTime - now - 5min` 设置定时器，刷新时重新调用 `initTracker` | 通过 |
| FT-042 | 事件批量发送 | 累积 2 个事件 | 触发批量同步 | `pendingEvents.length >= 2` 时调用 `syncTelemetry` | 通过 |
| FT-043 | 页面卸载发送 | 关闭/隐藏页面 | 尝试发送剩余事件 | `beforeunload`/`visibilitychange` 监听器调用 `syncTelemetry(true)`，使用 `keepalive: true` | 通过 |
| FT-044 | 发送失败保留队列 | 网络异常 | 事件保留在队列中待下次同步 | catch 块中不清理 `pendingEvents`，`isSyncing` 标志在 finally 中重置 | 通过 |
| FT-045 | 定期同步 | 每 15 秒 | 自动同步待发送事件 | `setInterval(() => syncTelemetry(false), 15000)` | 通过 |

---

## 四、兼容性测试

### 4.1 浏览器兼容性

| 编号 | 测试项 | 分析结论 | 状态 |
|:---|:---|:---|:---|
| CT-001 | Chrome 120+ | 完全兼容。OKLCH 色彩、IndexedDB、AbortSignal.timeout、crypto.subtle 均支持 | 通过 |
| CT-002 | Safari 17+ (iOS) | 完全兼容。safe-area-inset 适配、CSS 变量、OKLCH（Safari 16.4+）均支持 | 通过 |
| CT-003 | Firefox 120+ | 完全兼容。OKLCH（Firefox 113+）、IndexedDB、Web Crypto API 均支持 | 通过 |
| CT-004 | 旧版浏览器 (Chrome < 111) | 不兼容 OKLCH 色彩，主题渲染异常 | 不通过（预期行为，项目未声明旧版支持） |

### 4.2 Tauri 原生容器适配

| 编号 | 测试项 | 分析结论 | 状态 |
|:---|:---|:---|:---|
| CT-005 | Android WebView | Tauri v2 Android 构建配置正确，`tauri.conf.json` 含 android debugApplicationIdSuffix | 通过 |
| CT-006 | CSP 策略 | `tauri.conf.json` 中 `app.security.csp: null`，即未启用 CSP | **警告**（见问题 P-007） |
| CT-007 | CORS 绕过 | Tauri WebView 不受浏览器 CORS 限制，`isClientMode()` 正确检测并直连 | 通过 |

### 4.3 移动端适配

| 编号 | 测试项 | 分析结论 | 状态 |
|:---|:---|:---|:---|
| CT-008 | 安全区域适配 | `MainLayout.tsx` 使用 `env(safe-area-inset-top)` 和 `env(safe-area-inset-bottom)` 适配刘海屏和虚拟导航键 | 通过 |
| CT-009 | 状态栏主题同步 | `AppContext.tsx` 中 `useEffect` 动态更新 `<meta name="theme-color">`，三主题分别对应不同颜色 | 通过 |
| CT-010 | 触控操作布局 | 底部 Tab 导航、单手可达、max-w-lg 限制内容宽度 | 通过 |
| CT-011 | 100dvh 视口 | 使用 `h-[100dvh]` 动态视口高度，避免移动浏览器地址栏导致的 100vh 问题 | 通过 |

---

## 五、性能测试

### 5.1 构建产物分析

| 指标 | 数值 | 评估 |
|:---|:---|:---|
| JS Bundle 大小 | 817.55 kB (gzip: 262.74 kB) | **警告**：超过 500 kB 阈值，Vite 构建器已发出 chunk 大小警告 |
| CSS Bundle 大小 | 101.90 kB (gzip: 15.58 kB) | 正常 |
| HTML 入口 | 0.47 kB (gzip: 0.31 kB) | 正常 |
| 构建时间 | 13.77s | 正常 |
| 模块数量 | 2441 | 较多，与未做 code-splitting 有关 |

### 5.2 性能风险分析

| 编号 | 测试项 | 分析结论 | 风险等级 |
|:---|:---|:---|:---|
| PT-001 | 单 Chunk 打包 | 所有 JS 打包为单一 chunk，首屏需加载全部代码 | 中 |
| PT-002 | IndexedDB 读写 | 每次 SSE chunk 到达都触发 `setSessions` + `saveSession`，高频写入可能造成 DB 锁竞争 | 中 |
| PT-003 | 设置防抖机制 | `updateSettings` 使用 400ms 防抖 + 写入链串行化，滑块拖动时不会锁定 DB | 通过 |
| PT-004 | 角色卡 base64 头像 | 大尺寸头像以 base64 存储在 IndexedDB 中，导入大量高分辨率 PNG 可能占用大量内存 | 低 |
| PT-005 | SSE 流式渲染 | 每个 chunk 触发 React 状态更新和重渲染，超长回复可能造成 UI 卡顿 | 低 |
| PT-006 | 世界书扫描复杂度 | 每次发送消息扫描全部 lorebook 条目，O(n*m) 复杂度，大量词条时可能影响响应速度 | 低 |

---

## 六、安全性测试

### 6.1 密钥暴露检测

| 编号 | 测试项 | 分析结论 | 状态 |
|:---|:---|:---|:---|
| ST-001 | 前端代码 AK/SK | `.env.example` 仅含 SLS 公共端点配置，无敏感密钥 | 通过 |
| ST-002 | 源码硬编码密钥 | 全量扫描源码，未发现硬编码的 API Key 或 AccessKey | 通过 |
| ST-003 | API Key 存储 | 用户 API Key 存储在 IndexedDB `settings` store 中，以明文存储 | **警告**（见问题 P-001） |
| ST-004 | STS 临时凭证 | FC 签发的临时凭证仅拥有 PutLogs 权限，有效期 1 小时 | 通过 |
| ST-005 | FC URL 硬编码 | `telemetry.ts` 中 `fcStsUrl` 有硬编码回退值 `https://mobile-xmkoxkjshe.cn-hangzhou.fcapp.run` | **警告**（见问题 P-002） |

### 6.2 XSS 风险检测

| 编号 | 测试项 | 分析结论 | 状态 |
|:---|:---|:---|:---|
| ST-006 | dangerouslySetInnerHTML | `renderDialogueBubble` 在 `enableHtmlRendering` 为 true 时使用 `dangerouslySetInnerHTML` 渲染 AI 输出 | **高风险**（见问题 P-003） |
| ST-007 | AI 输出注入 | AI 回复内容未经消毒直接渲染，恶意 prompt 注入可能导致 XSS | **高风险**（同 P-003） |

### 6.3 CORS 与网络安全

| 编号 | 测试项 | 分析结论 | 状态 |
|:---|:---|:---|:---|
| ST-008 | Express 代理 CORS | 浏览器模式下通过同源 Express 代理转发，无 CORS 问题 | 通过 |
| ST-009 | Tauri 直连 | Tauri WebView 不受 CORS 限制，直接 HTTPS 请求 | 通过 |
| ST-010 | SLS STS 直传 | 使用官方 SDK 签名 POST，不属于匿名 WebTracking，无需 CORS 配置 | 通过 |
| ST-011 | Express rate-limit | `server.ts` 中 `app.set('trust proxy', 1)` 已配置但未实际使用 `express-rate-limit` 中间件 | **警告**（见问题 P-004） |
| ST-012 | HTTP 请求 | 所有外部请求均使用 HTTPS | 通过 |

### 6.4 依赖漏洞扫描

| 漏洞编号 | 依赖包 | 严重级别 | 漏洞描述 | 影响 |
|:---|:---|:---|:---|:---|
| VUL-001 | protobufjs (<=7.5.7) | **Critical** | 多个漏洞：任意代码执行、原型注入、DoS、UTF-8 解码异常 | 通过 `@alicloud/log` 间接依赖，仅服务端使用，前端不包含 |
| VUL-002 | xml2js (<0.5.0) | **Moderate** | 原型污染漏洞 | 通过 `aliyun-sdk` 间接依赖，仅服务端使用 |

> **注：** 上述漏洞均存在于服务端依赖（`@alicloud/log`、`aliyun-sdk`）中，不影响前端客户端安全。生产环境中 Express 代理服务仅转发请求，不直接处理用户输入的 XML/Protobuf 数据，实际风险较低。

### 6.5 加密与数据安全

| 编号 | 测试项 | 分析结论 | 状态 |
|:---|:---|:---|:---|
| ST-013 | 备份加密算法 | AES-256-GCM + SHA-256 密钥派生 + 随机 IV，安全性良好 | 通过 |
| ST-014 | XOR 回退兼容 | 解密失败时回退 XOR 解密（兼容旧备份），XOR 安全性极弱 | **警告**（见问题 P-005） |
| ST-015 | CSP 策略 | `tauri.conf.json` 中 CSP 设为 null（未启用） | **警告**（见问题 P-007） |
| ST-016 | console.error 覆盖 | `telemetry.ts` 覆盖全局 `console.error` 过滤 SLS 错误日志 | **警告**（见问题 P-006） |

---

## 七、TypeScript 类型检查结果

| 检查项 | 结果 |
|:---|:---|
| `tsc --noEmit` | **通过** — 零错误零警告 |
| 类型覆盖率 | 核心模块均有完整 TypeScript 接口定义（types.ts） |
| any 类型使用 | 存在少量 `any` 类型（主要在 cardParser.ts 的 ST 字段映射和 apiClient.ts 的响应处理），不影响类型安全 |

---

## 八、发现的问题汇总

### 严重问题 (Critical)

| 编号 | 问题 | 位置 | 描述 | 建议 |
|:---|:---|:---|:---|:---|
| P-003 | XSS 注入风险 | [useChat.tsx](file:///d:/测试/Mobile-Tavern/src/hooks/useChat.tsx) `renderDialogueBubble` | 当 `enableHtmlRendering=true` 时，AI 回复通过 `dangerouslySetInnerHTML` 直接渲染，未经 HTML 消毒。恶意角色卡或 prompt 注入可执行任意 JavaScript。 | 引入 DOMPurify 等库对 AI 输出进行 HTML 消毒后再渲染 |

### 高风险问题 (High)

| 编号 | 问题 | 位置 | 描述 | 建议 |
|:---|:---|:---|:---|:---|
| P-001 | API Key 明文存储 | [localDB.ts](file:///d:/测试/Mobile-Tavern/src/utils/localDB.ts) | 用户 API Key 以明文存储在 IndexedDB 中，任何同源脚本或浏览器扩展均可读取 | 考虑使用 Web Crypto API 对 API Key 进行加密存储，或依赖操作系统凭据管理器 |
| P-007 | CSP 未启用 | [tauri.conf.json](file:///d:/测试/Mobile-Tavern/src-tauri/tauri.conf.json) | `app.security.csp: null` 意味着未配置内容安全策略，增加了 XSS 攻击的影响面 | 配置合理的 CSP 策略限制脚本和资源加载来源 |

### 中等风险问题 (Medium)

| 编号 | 问题 | 位置 | 描述 | 建议 |
|:---|:---|:---|:---|:---|
| P-002 | FC URL 硬编码回退 | [telemetry.ts](file:///d:/测试/Mobile-Tavern/src/utils/telemetry.ts) L47, L93 | `fcStsUrl` 在环境变量未配置时回退到硬编码的 FC URL，暴露了内部服务端点 | 移除硬编码回退值，环境变量未配置时静默跳过遥测初始化 |
| P-004 | Rate-limit 未启用 | [server.ts](file:///d:/测试/Mobile-Tavern/server.ts) | 虽然安装了 `express-rate-limit` 依赖并设置了 `trust proxy`，但未实际应用限流中间件，代理接口可被无限调用 | 在 `/api/proxy/*` 路由上添加 rate-limit 中间件 |
| P-005 | XOR 解密回退 | [cardParser.ts](file:///d:/测试/Mobile-Tavern/src/utils/cardParser.ts) `decryptBackupData` | AES-GCM 解密失败时回退到 XOR 解密以兼容旧备份，XOR 加密极弱且回退逻辑通过检查解密结果是否包含 "characters"/"sessions"/"{" 来判断成功，可能被伪造 | 移除 XOR 回退或增加版本标识区分新旧备份格式 |
| P-006 | console.error 全局覆盖 | [telemetry.ts](file:///d:/测试/Mobile-Tavern/src/utils/telemetry.ts) L72-82 | 覆盖全局 `console.error` 过滤 SLS 相关错误，可能掩盖其他重要错误信息 | 改为在 SLS SDK 回调中处理错误，而非全局覆盖 |

### 低风险问题 (Low)

| 编号 | 问题 | 位置 | 描述 | 建议 |
|:---|:---|:---|:---|:---|
| P-008 | 单 Chunk 打包 | [vite.config.ts](file:///d:/测试/Mobile-Tavern/vite.config.ts) | 生产构建输出单一 JS chunk (817 kB)，超过 Vite 500 kB 警告阈值，影响首屏加载性能 | 使用 `build.rollupOptions.output.manualChunks` 拆分 vendor 和业务代码 |
| P-009 | SSE 高频 DB 写入 | [useChat.tsx](file:///d:/测试/Mobile-Tavern/src/hooks/useChat.tsx) | 流式响应期间每个 chunk 都触发 `setSessions` + `saveSession`，可能造成 IndexedDB 写入压力 | 考虑节流 DB 写入频率（如每 500ms 批量写入一次），仅在最终完成时确保写入 |
| P-010 | ID 生成方式 | 多处 | 使用 `Math.random().toString(36).substring(2, 9)` 生成 ID，仅 7 位字符，碰撞概率在大量数据时不可忽略 | 使用 `crypto.randomUUID()` 生成更安全的唯一标识符 |
| P-011 | handleSaveNewPresetBundle 使用 window.prompt | [useSettings.ts](file:///d:/测试/Mobile-Tavern/src/hooks/useSettings.ts) L466 | 使用原生 `window.prompt` 而非自定义 `showCustomPrompt`，与项目其他弹窗风格不一致，且在 Tauri Android 上可能行为异常 | 统一使用 `showCustomPrompt` |

---

## 九、测试结论

### 总体评估

| 维度 | 评分 | 说明 |
|:---|:---|:---|
| 功能完整性 | ★★★★☆ | 核心功能（角色卡 CRUD、聊天、世界书、备份）完整实现，SillyTavern 兼容性良好 |
| 代码质量 | ★★★★☆ | TypeScript 类型检查零错误，代码结构清晰，Context 分层合理 |
| 安全性 | ★★★☆☆ | 存在 XSS 高风险（dangerouslySetInnerHTML）、CSP 未启用、API Key 明文存储等问题 |
| 性能 | ★★★☆☆ | 单 Chunk 打包体积偏大，SSE 流式写入频率过高，需优化 |
| 兼容性 | ★★★★☆ | 主流现代浏览器和 Tauri Android 适配良好，移动端安全区域处理完善 |
| 依赖安全 | ★★★★☆ | 存在的漏洞均在服务端间接依赖中，前端无直接影响 |

### 关键发现

1. **TypeScript 编译零错误**：项目类型定义完整，`tsc --noEmit` 通过。
2. **Vite 生产构建成功**：2441 模块在 13.77s 内完成构建，但 JS chunk 超过 500 kB 警告阈值。
3. **npm audit 发现 4 个漏洞**：protobufjs (Critical) 和 xml2js (Moderate)，均为服务端间接依赖，前端不受影响。
4. **XSS 是最严重的安全风险**：`enableHtmlRendering` 开启时 AI 输出未经消毒直接注入 DOM。
5. **遥测架构安全隔离良好**：STS 临时凭证模式正确实现，前端无 AK/SK 泄露风险。

### 优先修复建议

1. **P-003 (Critical)**：立即引入 DOMPurify 对 `dangerouslySetInnerHTML` 的内容进行消毒
2. **P-007 (High)**：配置 Tauri CSP 策略
3. **P-001 (High)**：加密存储 API Key
4. **P-004 (Medium)**：启用 Express rate-limit
5. **P-008 (Low)**：配置 Vite manualChunks 进行代码分割

---

*本测试报告由 AI 自动化测试引擎基于源代码静态分析和构建测试生成，未对运行时行为进行动态测试。部分功能测试（如实际 API 调用、SSE 流式响应）需要配置有效的 API Key 和网络环境才能完整验证。*
