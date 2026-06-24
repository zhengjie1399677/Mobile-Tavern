# Mobile Tavern 代码与架构审查报告

*版本：1.0 | 审查日期：2026-06-24 | 审查范围：全项目核心模块*

> 本报告基于 AGENTS.md 核心行为准则对 Mobile Tavern 项目进行全面的代码与架构审查，涵盖核心内核架构、状态管理与数据流、网络通信与接口层、UI 组件与原生桥接四大模块，并包含完整的测试链建设规划与实施情况。

---

## 一、审查概述

### 1.1 项目定位

Mobile Tavern 是一个基于 Tauri + React + TypeScript 的纯移动端角色扮演容器，兼容 SillyTavern 生态，定位为"纯底层、无侵入的角色卡与世界设定兼容运行容器"。

### 1.2 审查范围

| 模块 | 核心目录 | 审查深度 |
|------|---------|---------|
| 核心内核架构 | `src/kernel/` | 深度审查（Kernel.ts + 9 个服务 + 中间件） |
| 状态管理与数据流 | `src/contexts/`、`src/hooks/` | 深度审查（4 个 Context + useChat 拆解） |
| 网络通信与接口层 | `src/utils/apiClient.ts`、`server.ts`、`serverless/` | 深度审查（防腐层 + SSRF + 遥测） |
| UI 组件与原生桥接 | `src/components/`、`src/tabs/`、`src/utils/tavernHelperBridge.ts` | 深度审查（移动端适配 + SillyTavern 兼容层） |

### 1.3 总体评价

| 维度 | 评级 | 说明 |
|------|------|------|
| 架构设计 | 🟢 良好 | 微内核 + 服务化 + 扩展点设计到位，为 50+ 插件演进预留空间 |
| 代码质量 | 🟢 良好 | 分层清晰，防御性设计完善，注释规范 |
| 安全性 | 🟢 良好 | SSRF 防御完备，AES-GCM 加密，CSS 注入防护 |
| 可维护性 | 🟡 一般 | UnifiedAppContext 上帝对象、代码重复、硬编码提示词 |
| 测试覆盖 | 🟡 一般 | 内核测试完善，但 UI/状态层覆盖不足 |
| 移动端适配 | 🟢 优秀 | 安全区、状态栏、大拇指原则全面落地 |

---

## 二、架构审查详情

### 2.1 核心内核架构

#### 2.1.1 架构设计

项目采用微内核架构，核心组件包括：

- **Kernel 容器**：服务注册表、管道表、消息总线、扩展点（SPI）、异步熔断池
- **9 个核心微服务**：DatabaseService、LLMService、PromptService、TelemetryService、TableMemoryService、ScriptService、AutoSummaryService、MultiMessageService、ChatStreamService
- **3 个内置管道**：input、output、settings
- **4 个 output 中间件**：tableMemory（100）、mvuScript（90）、bisonMode（80）、autoSummary（70）

#### 2.1.2 架构亮点

1. **拓扑排序批量注册**：`registerServiceBatch` 使用 Kahn 算法自动排序，新增服务只需声明 `dependencies`
2. **三态管道强校验**：区分 `next()`/`interrupt()`/未调用三态语义，开发模式直接抛错
3. **SafeProxy 开发期断言**：未注册服务在开发模式抛错，生产模式静默降级
4. **AbortController 全局熔断池**：`destroy()` 时强制 abort 所有异步任务
5. **LLMService.cleanRequestPayload 防腐层**：根据 baseUrl/modelName 动态剔除非标参数

#### 2.1.3 发现的问题

| 编号 | 问题 | 严重度 | 位置 |
|------|------|--------|------|
| K-01 | PromptService 硬编码行为引导提示词 | P0 | [PromptService.ts:374-375](file:///d:/projects/Mobile-Tavern/src/kernel/services/PromptService.ts#L374-375) |
| K-02 | AutoSummaryService 硬编码中英文匹配正则 | P0 | [AutoSummaryService.ts:158-162](file:///d:/projects/Mobile-Tavern/src/kernel/services/AutoSummaryService.ts#L158-162) |
| K-03 | ScriptService 缺失防腐隔离层 | P0 | [ScriptService.ts:3](file:///d:/projects/Mobile-Tavern/src/kernel/services/ScriptService.ts#L3) |
| K-04 | DatabaseService 直接耦合 localDB 实现 | P1 | [DatabaseService.ts:3](file:///d:/projects/Mobile-Tavern/src/kernel/services/DatabaseService.ts#L3) |
| K-05 | TelemetryService 模块级副作用变量 | P1 | [TelemetryService.ts:4](file:///d:/projects/Mobile-Tavern/src/kernel/services/TelemetryService.ts#L4) |
| K-06 | LLMService 缺失内网 IP 校验 | P1 | [LLMService.ts:51-59](file:///d:/projects/Mobile-Tavern/src/kernel/services/LLMService.ts#L51-59) |
| K-07 | DatabaseService.createBacktrackFromTimeline 硬编码中文文案 | P1 | [DatabaseService.ts:127-129](file:///d:/projects/Mobile-Tavern/src/kernel/services/DatabaseService.ts#L127-129) |
| K-08 | MultiMessageService 命名与职责不符 | P2 | [MultiMessageService.ts](file:///d:/projects/Mobile-Tavern/src/kernel/services/MultiMessageService.ts) |
| K-09 | ScriptService 生产环境 console.log 泄露 | P2 | [ScriptService.ts:23-25](file:///d:/projects/Mobile-Tavern/src/kernel/services/ScriptService.ts#L23-25) |
| K-10 | TableMemoryService 正则对嵌套大括号支持有限 | P2 | [TableMemoryService.ts:27](file:///d:/projects/Mobile-Tavern/src/kernel/services/TableMemoryService.ts#L27) |

### 2.2 状态管理与数据流

#### 2.2.1 架构设计

项目采用"分层 Context + 薄壳聚合 Hook + 微服务注入"的混合架构：

- **3 个 Context 层**：AppContext（UI 状态）、CharacterContext（角色卡）、ChatContext（会话）
- **LegacyAppContextProvider**：将所有 Context 与 Hook 合并为 UnifiedAppContext
- **useChat 薄壳聚合器**：通过 globalKernel 注入 5 个微服务，拆解为 7 个子 Hook
- **helpers 纯函数**：textParsing、suggestions、bisonProbability、streamHelpers

#### 2.2.2 发现的问题

| 编号 | 问题 | 严重度 | 位置 |
|------|------|--------|------|
| S-01 | UnifiedAppContext 上帝对象（90+ 字段） | P0 | [UnifiedAppContext.tsx:18-188](file:///d:/projects/Mobile-Tavern/src/UnifiedAppContext.tsx#L18-188) |
| S-02 | useSettings 巨型 settings 对象污染 | P0 | [useSettings.ts:266-330](file:///d:/projects/Mobile-Tavern/src/hooks/useSettings.ts#L266-330) |
| S-03 | useCatbot 全局单例状态绕过 React | P1 | [useCatbot.ts:27-47](file:///d:/projects/Mobile-Tavern/src/hooks/useCatbot.ts#L27-47) |
| S-04 | useCallback 依赖整个 params 对象 | P1 | useSessionManager/useSendMessage/useRerollMessage |
| S-05 | useEffect 依赖项不精确 | P1 | [useChatUI.ts:68-101](file:///d:/projects/Mobile-Tavern/src/hooks/useChat/useChatUI.ts#L68-101) |
| S-06 | TimelineSummary 编辑态扩散到全局 | P1 | [useTimelineSummary.ts:42-49](file:///d:/projects/Mobile-Tavern/src/hooks/useChat/useTimelineSummary.ts#L42-49) |
| S-07 | useCatbot 硬编码版本号 "1.5.8" | P1 | [useCatbot.ts:271](file:///d:/projects/Mobile-Tavern/src/hooks/useCatbot.ts#L271) |

### 2.3 网络通信与接口层

#### 2.3.1 架构设计

- **门面层**：apiClient.ts（薄门面）、telemetry.ts（薄门面）
- **Kernel Service 层**：LLMService、TelemetryService
- **基础设施层**：Rust 后端（遥测）、Express 代理（开发环境）
- **Serverless**：阿里云 FC（STS 凭证签发）

#### 2.3.2 架构亮点

1. **cleanRequestPayload 防腐层**：根据目标 API 差异化清洗参数
2. **SSRF 防御完备**：DNS Rebinding 防护 + IPv4/IPv6 私有地址全量检测
3. **遥测抗崩溃**：本地 JSONL 队列 + 指数退避重试
4. **日志脱敏**：sanitizeSensitiveData 屏蔽 API Key

#### 2.3.3 发现的问题

| 编号 | 问题 | 严重度 | 位置 |
|------|------|--------|------|
| N-01 | cleanRequestPayload 代码重复 | P1 | [apiClient.ts:28-69](file:///d:/projects/Mobile-Tavern/src/utils/apiClient.ts#L28-69) 与 [LLMService.ts:69-110](file:///d:/projects/Mobile-Tavern/src/kernel/services/LLMService.ts#L69-110) |
| N-02 | Catbot 端点缺少 SSRF 防护 | P2 | [server.ts:222](file:///d:/projects/Mobile-Tavern/server.ts#L222) |
| N-03 | 硬编码云端 URL 重复 | P2 | server.ts:227 与 LLMService.ts:305 |
| N-04 | server.ts Catbot 降级逻辑硬编码中文关键词 | P2 | [server.ts:257-310](file:///d:/projects/Mobile-Tavern/server.ts#L257-310) |
| N-05 | CORS 通配符风险 | P2 | server.ts:59-61、aliyun-fc-sts/index.js:30-32 |

### 2.4 UI 组件与原生桥接

#### 2.4.1 架构设计

- **原生桥接（AndroidThemeBridge）**：getSafeAreas、setStatusBarStyle、saveFile、saveFileBase64
- **SillyTavern 兼容层（tavernHelperBridge）**：2800+ 行 JS 模拟层，非原生桥接
- **IndexedDB 分轨存储**：characters、sessions、settings、lorebooks、worldbooks 独立 Store
- **移动端适配**：安全区三级 fallback、大拇指原则、visualViewport 键盘监听

#### 2.4.2 架构亮点

1. **安全区重试 + 事件订阅双轨同步**：150ms 间隔重试 20 次 + androidSafeAreasChanged 事件
2. **按需渲染（Zero-Intrusion）**：无表情配置时立绘层完全不存在于 DOM
3. **表情降级链**：规则匹配 → default/neutral → 数组首项 → 主头像
4. **CSS 沙盒化**：自定义 CSS 经 sanitizeCss 清洗，仅桌面端生效
5. **CDN 本地化**：jsdelivr.net 替换为 window.parent.TavernHelperMvuLibs

#### 2.4.3 发现的问题

| 编号 | 问题 | 严重度 | 位置 |
|------|------|--------|------|
| U-01 | 原生桥接调用逻辑重复粘贴 5 处 | P1 | useCharacters/useSettings/GlobalWorldbookTab |
| U-02 | 角色 avatar base64 与背景图污染 characters store | P1 | cardParser.ts:53、CharacterEditModal.tsx:409 |
| U-03 | FloatingCat 的 processImageForWeb 与 imageCompressor 重复 | P1 | [FloatingCat.tsx:8](file:///d:/projects/Mobile-Tavern/src/components/FloatingCat.tsx#L8) |
| U-04 | sessions.messages 数组无界增长 | P1 | [localDB.ts](file:///d:/projects/Mobile-Tavern/src/utils/localDB.ts) |
| U-05 | tavernHelperBridge.ts 单文件 2800+ 行 | P2 | [tavernHelperBridge.ts](file:///d:/projects/Mobile-Tavern/src/utils/tavernHelperBridge.ts) |
| U-06 | glowColors 情绪关键词硬编码 | P2 | [ChatTab.tsx:818-830](file:///d:/projects/Mobile-Tavern/src/tabs/ChatTab.tsx#L818-830) |

---

## 三、问题汇总与优先级划分

### 3.1 P0 严重问题（建议立即修复）

| 编号 | 问题 | 违反准则 | 影响范围 |
|------|------|---------|---------|
| K-01 | PromptService 硬编码 reasoningGuidancePrompt 与表格记忆提示词 | 准则二.1 | 系统强制生效不可移除的提示词 |
| K-02 | AutoSummaryService 硬编码 Location/Time/Condition 等正则 | 准则二.2 | 特定中英文匹配正则未外部化 |
| K-03 | ScriptService 缺失防腐隔离层 | 准则一.3 | tavernHelperBridge 脏数据可渗透核心层 |
| S-01 | UnifiedAppContext 上帝对象（90+ 字段） | 准则一.4 | 状态边界模糊，消费方重渲失控 |
| S-02 | useSettings 巨型 settings 对象污染 | 准则一.2 | 大段文本内联，序列化延时风险 |

### 3.2 P1 中等问题（建议近期修复）

| 编号 | 问题 | 违反准则 |
|------|------|---------|
| K-04 | DatabaseService 直接耦合 localDB 实现 | 准则一.2 |
| K-05 | TelemetryService 模块级副作用变量 | 准则一.4 |
| K-06 | LLMService 缺失内网 IP 校验 | 准则三.4 |
| K-07 | DatabaseService 硬编码中文文案 | 准则二.2 |
| S-03 | useCatbot 全局单例状态绕过 React | 准则一.4 |
| S-04 | useCallback 依赖整个 params 对象 | 准则一.4 |
| S-05 | useEffect 依赖项不精确 | 准则一.4 |
| S-06 | TimelineSummary 编辑态扩散到全局 | 准则一.4 |
| S-07 | useCatbot 硬编码版本号 | 准则六 |
| N-01 | cleanRequestPayload 代码重复 | DRY 原则 |
| U-01 | 原生桥接调用逻辑重复粘贴 | 准则六 |
| U-02 | 角色 avatar base64 污染 | 准则一.2 |
| U-03 | 图片处理重复实现 | 准则六 |
| U-04 | sessions.messages 无界增长 | 准则一.2 |

### 3.3 P2 轻微问题（建议择机修复）

| 编号 | 问题 |
|------|------|
| K-08 | MultiMessageService 命名与职责不符 |
| K-09 | ScriptService 生产环境 console.log 泄露 |
| K-10 | TableMemoryService 正则嵌套大括号支持有限 |
| N-02 | Catbot 端点缺少 SSRF 防护 |
| N-03 | 硬编码云端 URL 重复 |
| N-04 | server.ts Catbot 降级逻辑硬编码关键词 |
| N-05 | CORS 通配符风险 |
| U-05 | tavernHelperBridge.ts 单文件过大 |
| U-06 | glowColors 情绪关键词硬编码 |

---

## 四、测试链建设

### 4.1 测试基础设施现状

| 项目 | 现状 |
|------|------|
| 测试框架 | 自定义测试运行器（`tsx tests/run_all_tests.ts`） |
| 测试风格 | `assert` + `console.log` 简单风格 |
| 测试脚本 | `npm test`（运行全部）、`npm run test:bridge`、`npm run test:zod` |
| 测试文件 | 17 个测试文件（`tests/` 目录） |
| 测试覆盖 | 内核层完善，UI/状态层不足 |

### 4.2 现有测试覆盖情况

#### 4.2.1 已覆盖模块（24 个测试函数）

| 模块 | 测试函数 | 覆盖点 |
|------|---------|--------|
| SSRF 防御 | testSsrfGuard | 15 个 blocked/allowed 用例 |
| DB 队列 | testDbQueue | 串行化与错误恢复 |
| Prompt 构建 | testPromptBuilder | 宏替换、Lorebook 触发 |
| PNG 卡片 | testPngCardParser | 元数据注入与回环解析 |
| API 清洗 | testApiCleanRequestPayload | 7 种 API 端点差异化清洗 |
| SSE 流式 | testSSEStreamWithReasoning | reasoning_content 解析 |
| 内核故障隔离 | testKernelFaultIsolation | 9 个子测试（SafeProxy、熔断等） |
| 内核管道 | testKernelPipeline | 洋葱模型、优先级、阻断 |
| 内核加固 | testKernelPipelineHardening | 动态注销、异常隔离、遗忘 next |
| 内核 P0-P3 | testKernelHardeningP0ToP3 | 消息总线、原子注册、销毁 |
| 内核 V2 修复 | testKernelKernelV2Fixes | B-1/B-2/B-4/C-1/C-2 |
| 内核 V3 修复 | testKernelV3Fixes | 逆序销毁、Symbol 拦截、超时 |
| 内核 V4 | testKernelV4AbortAndInterrupt | interrupt()、AbortSignal、destroy |
| 扩展点 | testKernelExtensionRegistry | SPI 注册、优先级、替换 |
| 野牛模式 | testBisonModeProbability | 性格联动、情绪联动 |
| 预设集成 | testPresetAndWorldbookIntegration | mainPrompt、世界书触发 |
| 建议解析 | testSuggestionsRobustness | 7 种格式降级解析 |
| 多消息服务 | testMultiMessageService | 入队、占位符过滤 |
| 数据库 CRUD | testDatabaseServiceCrud | 新建、分支、回溯 |
| 输出管道 | testOutputPipeline | 4 中间件链式执行 |
| 聊天流 | testChatStreamService | AsyncGenerator 消费 |
| API Key 加密 | testApiKeyEncryption | AES-GCM、错误兜底 |
| CSS 清洗 | testCssSanitization | 5 种注入防护 |
| 日志脱敏 | testServerLogDesensitization | 3 种 Key 格式 |

#### 4.2.2 本次新增测试（4 个测试函数）

| 测试函数 | 覆盖模块 | 覆盖点 |
|---------|---------|--------|
| testTableMemoryService | TableMemoryService | updateRow 双参数/单参数、insertRow、deleteRow、宽松 JSON、多指令、静默降级 |
| testPromptServiceRedosProtection | PromptService | ReDoS 危险正则降级、正常正则匹配 |
| testLLMServiceUrlValidation | LLMService | 合法/非法 URL 校验、尾部斜杠规范化 |
| testAutoSummaryMetadataParsing | AutoSummaryService | 元数据解析（Location/Time/Condition 等）、免 Key 降级 |

### 4.3 测试覆盖空白

| 模块 | 空白原因 | 建议补充方式 |
|------|---------|-------------|
| ScriptService | 依赖 tavernHelperBridge（操作 window） | 重构为依赖注入后单测，或 E2E 测试 |
| UI 组件层 | 需浏览器环境 | 集成测试（React Testing Library） |
| 状态管理（Context） | 需 React 渲染环境 | 集成测试 + E2E 测试 |
| tavernHelperBridge | 2800+ 行，需 iframe 环境 | E2E 测试（Tauri WebView） |
| localDB v6 迁移 | 需 IndexedDB 环境 | 集成测试（fake-indexeddb） |
| imageCompressor | 需 Canvas 环境 | 集成测试（jsdom + canvas） |

### 4.4 测试链规划

#### 4.4.1 单元测试层（已建设）

**目标**：覆盖纯函数与无副作用服务

**现状**：24 个测试函数，覆盖内核层核心逻辑

**新增**：4 个内核服务覆盖测试（TableMemoryService、PromptService ReDoS、LLMService URL、AutoSummaryService 元数据）

**运行命令**：`npm test`

#### 4.4.2 集成测试层（规划中）

**目标**：覆盖多模块协作与 React 组件渲染

**建议框架**：Vitest + React Testing Library + fake-indexeddb

**规划测试点**：
1. Context 层级集成测试（AppProvider + CharacterProvider + ChatProvider 协作）
2. useChat 发送消息全流程（prompt 组装 → LLM 调用 → 流式更新 → 管道执行）
3. localDB v6 迁移逻辑（旧版数据结构 → 新版分轨存储）
4. imageCompressor 图片压缩（Canvas 环境）
5. FormattedText 按需渲染（enableAsteriskFormatting 开关）
6. 原生桥接调用封装（mock AndroidThemeBridge）

#### 4.4.3 端到端测试层（规划中）

**目标**：覆盖完整用户流程与 Tauri 原生交互

**建议框架**：Tauri WebDriver + WebdriverIO

**规划测试点**：
1. 角色卡导入 → PNG 元数据解析 → IndexedDB 存储 → UI 渲染
2. 消息发送 → SSE 流式响应 → 表格记忆更新 → MVU 变量同步
3. 主题切换 → AndroidThemeBridge.setStatusBarStyle → 状态栏变色
4. 文件导出 → AndroidThemeBridge.saveFile → /Download 文件验证
5. ScriptService MVU 脚本执行（需 iframe 沙盒环境）

### 4.5 测试结果

#### 4.5.1 测试执行结果

```
测试命令：npm test
退出码：0
测试结果：全部通过

测试统计：
- 原有测试函数：24 个
- 新增测试函数：4 个
- 总测试函数：28 个
- 通过：28 个
- 失败：0 个
```

#### 4.5.2 Lint 检查结果

```
检查命令：npm run lint
退出码：0
结果：无错误
```

#### 4.5.3 新增测试文件

| 文件 | 路径 | 说明 |
|------|------|------|
| 内核服务覆盖测试 | [tests/test_kernel_services_coverage.ts](file:///d:/projects/Mobile-Tavern/tests/test_kernel_services_coverage.ts) | 4 个测试函数，覆盖 TableMemoryService、PromptService ReDoS、LLMService URL、AutoSummaryService 元数据 |

---

## 五、改进建议与实施路径

### 5.1 P0 问题实施路径（建议优先）

#### 5.1.1 K-01/K-02：硬编码提示词外部化

**实施步骤**：
1. 在 `src/defaults/` 目录新建 `promptTemplates.ts`，将 reasoningGuidancePrompt、表格记忆提示词、Location/Time 正则等外部化
2. 在 `useSettings.ts` 的 DEFAULT_SETTINGS 中增加对应字段，提供 UI 编辑入口
3. PromptService/AutoSummaryService 从 settings 读取，而非硬编码
4. UI 提供开关允许用户关闭/编辑

**预计影响**：PromptService.ts、AutoSummaryService.ts、useSettings.ts、SettingsTab.tsx

#### 5.1.2 K-03：ScriptService 防腐隔离层

**实施步骤**：
1. 在 ScriptService 内建立 `cleanMvuPayload` 纯函数
2. 对 tavernHelperBridge 的返回值进行结构转换与字段校验
3. 将 `notifyVariablesUpdated` 改为通过消息总线发布事件，而非直接调用

**预计影响**：ScriptService.ts、tavernHelperBridge.ts（轻量调整）

#### 5.1.3 S-01：UnifiedAppContext 拆分

**实施步骤**：
1. 将 UnifiedAppContext 拆分为 ChatUIContext、SessionContext、SettingsContext
2. 消费方使用 selector 按需订阅精确切片
3. 迁移到已存在但未使用的 `unifiedAppStore`（Zustand）
4. TimelineSummary 编辑态限制在局部 Context

**预计影响**：UnifiedAppContext.tsx、LegacyAppContextProvider.tsx、所有消费组件

### 5.2 P1 问题实施路径（建议近期）

#### 5.2.1 代码去重

| 问题 | 实施步骤 |
|------|---------|
| N-01 cleanRequestPayload 重复 | 删除 apiClient.ts 中的实现，统一从 LLMService 导出 |
| U-01 原生桥接重复 | 新建 `src/utils/nativeBridge.ts`，封装 saveFile/saveFileBase64/setStatusBarStyle/getSafeAreas |
| U-03 图片处理重复 | 合并 FloatingCat.processImageForWeb 到 imageCompressor |

#### 5.2.2 数据分轨存储

| 问题 | 实施步骤 |
|------|---------|
| U-02 avatar base64 污染 | 新建 `character_assets` Store，avatar/backgroundImageUrl 按 characterId 异步检索 |
| U-04 sessions.messages 无界增长 | 实施消息分片存储，按 50 条/片分割 |
| S-02 settings 大对象 | 将 mainPrompt/bisonModePrompt 等大段文本分离到独立 Store |

#### 5.2.3 安全加固

| 问题 | 实施步骤 |
|------|---------|
| K-06 LLMService 内网 IP 校验 | 增加 127.0.0.1/10.*/172.16-31.*/192.168.*/169.254.* 黑名单 |
| N-05 CORS 通配符 | 公网部署时收紧为前端域名白名单 |

### 5.3 P2 问题实施路径（建议择机）

| 问题 | 实施步骤 |
|------|---------|
| K-08 MultiMessageService 命名 | 重命名为 MessageQueueService 或扩展为真正多消息队列 |
| U-05 tavernHelperBridge 拆分 | 拆分为 tavernHelperMock.ts、mvuPreprocess.ts、iframeSrcDoc.ts |
| K-10 TableMemoryService 正则 | 使用栈式解析器替代正则，支持嵌套大括号 |

---

## 六、测试链自动化建设建议

### 6.1 CI/CD 集成

```yaml
# 建议 .github/workflows/test.yml 配置
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run lint
      - run: npm test
```

### 6.2 测试覆盖率监控

建议引入 `c8` 或 `istanbul` 进行覆盖率统计：

```bash
# 安装
npm install -D c8

# 运行带覆盖率
c8 --all npm test
```

**目标覆盖率**：
- 内核层（src/kernel/）：≥ 85%
- 工具层（src/utils/）：≥ 70%
- Hooks 层（src/hooks/）：≥ 50%（需集成测试补充）
- UI 组件层（src/components/）：≥ 40%（需 E2E 补充）

### 6.3 测试分层自动化

| 层级 | 触发时机 | 运行环境 | 预期耗时 |
|------|---------|---------|---------|
| 单元测试 | 每次 commit | Node.js | < 10s |
| 集成测试 | 每次 PR | Node.js + jsdom | < 30s |
| E2E 测试 | 每日定时 / 发版前 | Tauri WebView | < 5min |

---

## 七、附录

### 7.1 审查文件清单

**核心内核**：
- [src/kernel/Kernel.ts](file:///d:/projects/Mobile-Tavern/src/kernel/Kernel.ts)
- [src/kernel/types.ts](file:///d:/projects/Mobile-Tavern/src/kernel/types.ts)
- [src/kernel/index.ts](file:///d:/projects/Mobile-Tavern/src/kernel/index.ts)
- [src/kernel/services/](file:///d:/projects/Mobile-Tavern/src/kernel/services/)（9 个服务文件）
- [src/kernel/middlewares/outputMiddlewares.ts](file:///d:/projects/Mobile-Tavern/src/kernel/middlewares/outputMiddlewares.ts)

**状态管理**：
- [src/UnifiedAppContext.tsx](file:///d:/projects/Mobile-Tavern/src/UnifiedAppContext.tsx)
- [src/contexts/](file:///d:/projects/Mobile-Tavern/src/contexts/)（4 个 Context 文件）
- [src/hooks/useChat.tsx](file:///d:/projects/Mobile-Tavern/src/hooks/useChat.tsx)
- [src/hooks/useChat/](file:///d:/projects/Mobile-Tavern/src/hooks/useChat/)（7 个子 Hook + helpers）

**网络通信**：
- [src/utils/apiClient.ts](file:///d:/projects/Mobile-Tavern/src/utils/apiClient.ts)
- [server.ts](file:///d:/projects/Mobile-Tavern/server.ts)
- [server/security.ts](file:///d:/projects/Mobile-Tavern/server/security.ts)
- [serverless/aliyun-fc-sts/index.js](file:///d:/projects/Mobile-Tavern/serverless/aliyun-fc-sts/index.js)

**UI 与桥接**：
- [src/utils/tavernHelperBridge.ts](file:///d:/projects/Mobile-Tavern/src/utils/tavernHelperBridge.ts)
- [src/utils/localDB.ts](file:///d:/projects/Mobile-Tavern/src/utils/localDB.ts)
- [src/components/MainLayout.tsx](file:///d:/projects/Mobile-Tavern/src/components/MainLayout.tsx)
- [src/tabs/ChatTab.tsx](file:///d:/projects/Mobile-Tavern/src/tabs/ChatTab.tsx)

**测试文件**：
- [tests/run_all_tests.ts](file:///d:/projects/Mobile-Tavern/tests/run_all_tests.ts)（主测试入口）
- [tests/test_kernel_services_coverage.ts](file:///d:/projects/Mobile-Tavern/tests/test_kernel_services_coverage.ts)（新增覆盖测试）

### 7.2 准则符合性总评

| AGENTS.md 准则 | 符合度 | 主要违反点 |
|---------------|--------|-----------|
| 准则一：超大规模扩展性与底座解耦 | 🟢 良好 | UnifiedAppContext 上帝对象、ScriptService 缺防腐层 |
| 准则二：SillyTavern 生态兼容 | 🟡 一般 | PromptService/AutoSummaryService 硬编码提示词 |
| 准则三：纯移动端战略 | 🟢 优秀 | 安全区、状态栏、大拇指原则全面落地 |
| 准则四：禁止浏览器自动化 | 🟢 符合 | 未发现违规 |
| 准则五：Markdown 全中文 | 🟢 符合 | 本报告全中文表述 |
| 准则六：版本号同步 | 🟡 一般 | useCatbot.ts 硬编码版本号 |
| 准则七：冲突处理 | N/A | 本次为审查任务 |
| 准则八：AI 协作物理隔离 | 🟢 符合 | 新增测试遵循单兵测试原则 |
| 准则九：身份隔离 | 🟢 符合 | 本报告保持专业工程助理口吻 |

---

*报告结束*
