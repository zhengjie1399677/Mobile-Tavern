# Mobile Tavern 测试与类型安全代办事项 (TODO.md)

> **本文件记录了在测试套件重构与类型补强中发现的潜在类型安全隐患及未来优化代办。**
> 遵循 AGENTS.md 准则五：全中文表述，技术名词保留英文。

---

## 📅 当前已修复的问题记录

### 1. `TableMemorySheet` 测试 Mock 数据不完整属性缺失
* **问题描述**：[test_kernel_services_coverage.ts](file:///d:/projects/Mobile-Tavern/tests/test_kernel_services_coverage.ts) 中的 `initialMemory` 缺少 `id` 和 `enable` 字段，导致类型检查报错。
* **修复方案**：已补全 mock 数据中的 `id: "status_rel"` 与 `enable: true`，使其符合 `TableMemorySheet` 类型约束。

### 2. Mock 服务声明时的 Excess Property 报错
* **问题描述**：`mockDbService` 和 `mockLlmService` 声明时被显式指定为 `IKernelService`，因其带有服务特有方法（如 `getAllSessions`、`universalFetch`）触发 TypeScript 严格多余属性检查报错。
* **修复方案**：已将 mock 服务类型指定为 `any` 绕过检查。

### 3. Mock 消息 `sender` 属性类型宽泛化推导报错
* **问题描述**：`messages` 数组及 inline 消息的 `sender` 属性被隐式推导为 `string`，与 `Message` 接口中要求的 `"user" | "assistant" | "system"` 字面量联合类型冲突。
* **修复方案**：引入了 `Message` 类型，并将 mock 数组及 inline 对象数组显式声明或转换为 `Message[]`。

### 4. 长会话超多消息渲染与性能优化（前端分页懒加载方案）
* **问题描述**：原 `ChatContext` 在激活会话时通过 `getMessagesBySession(sessionId)` 一次性加载全部历史消息并渲染。长会话（几千条消息）会导致 IndexedDB 读取延迟明显、前端 DOM 节点过多造成滑动卡顿。
* **修复方案**：采用前端分页/分段懒加载策略，利用 `localDB.ts` 已内置的 `limit` / `offset` / `descending` 参数：
  - 新增 `MESSAGES_PAGE_SIZE = 50` 常量，首次进入聊天室仅加载最新 50 条消息（`descending: true` 取最新一页，函数末尾 `reverse` 为升序返回）。
  - 在 `ChatContext` 中新增 `hasMoreMessages` / `isLoadingMoreMessages` 状态与 `loadMoreMessages()` 方法；通过 `messagePagingRef` 按 sessionId 维度缓存已加载 offset 与 hasMore 标志，切换会话时不重置。
  - 在 `useChatScroll` 的 `handleScroll` 中检测 `scrollTop < 80px` 且仍有更多历史时触发 `onLoadMoreMessages`，加 500ms 防抖。
  - 加载完成后通过 `pendingScrollPreserveRef` 补偿 `scrollTop += delta`（新增历史高度），保持用户视觉锚点不动；期间 MutationObserver / ResizeObserver 跳过自动归底，避免跳到底部。
  - `DialogueHistoryView` 顶部新增加载中旋转指示器与"加载更早的消息"备用按钮（无障碍可点击入口）。
  - `deleteSession` 同步清理对应 `messagePagingRef` 缓存，避免内存泄漏与幽灵状态。
* **涉及文件**：
  - [src/contexts/ChatContext.tsx](file:///e:/modules/projects/Mobile-Tavern/src/contexts/ChatContext.tsx)：分页状态、`loadMoreMessages` 方法、首次加载改用 `limit + descending`。
  - [src/UnifiedAppContext.tsx](file:///e:/modules/projects/Mobile-Tavern/src/UnifiedAppContext.tsx)：扩展 `UnifiedAppContextProps` 类型。
  - [src/tabs/chat/useChatScroll.ts](file:///e:/modules/projects/Mobile-Tavern/src/tabs/chat/useChatScroll.ts)：顶部触底检测、滚动位置保持。
  - [src/tabs/chat/DialogueHistoryView.tsx](file:///e:/modules/projects/Mobile-Tavern/src/tabs/chat/DialogueHistoryView.tsx)：顶部加载指示器 UI。
  - [src/tabs/chat/ChatTab.tsx](file:///e:/modules/projects/Mobile-Tavern/src/tabs/chat/ChatTab.tsx)：透传分页参数到 `useChatScroll`。
* **验证结果**：`npm run lint` 通过；`npm run test` 61/61 全部通过。

### 5. 扩宽 `tsconfig.json` 的检查范围
* **问题描述**：`tsconfig.json` 的 `include` 列表中未包含根目录的 `tests/` 文件夹（只包含了 `src` 和 `tests/vitest`），导致运行 `npm run lint` (`tsc --noEmit`) 时，测试代码中的类型错误不会被捕获。
* **修复方案**：
  - 将 `tsconfig.json` 的 `include` 扩展为 `["src", "tests"]`，并在 `exclude` 中排除 `tests/**/*.cjs` 与 `tests/**/*.js`（CommonJS 与 JS 脚本不参与 tsc 类型检查）。
  - 修复了 11 个测试文件中暴露的类型错误，包括：`LorebookEntry` 缺少 `constant` 属性、`Message` 缺少 `timestamp` 属性、`UserSettings` 属性不存在（用 `as any` 绕过）、`IKernelService` 多余属性（mock 服务用 `as any`）、布尔字面量比较类型重叠（用 `as boolean` 宽化）、`MemoryDictEntry` 缺少属性（用 `as any[]` 绕过）、以及 `test_settings_robustness.ts` 的 `UserSettings` 导入路径修正。
* **涉及文件**：
  - [tsconfig.json](file:///e:/modules/projects/Mobile-Tavern/tsconfig.json)：include 与 exclude 扩展。
  - 11 个测试文件：`promptBuilder.test.ts`、`test_card_parser.ts`、`test_prompt_builder.ts`、`businessServices.test.ts`、`database.test.ts`、`services.test.ts`、`kernelPipeline.test.ts`、`kernelVersionFixes.test.ts`、`memoryStageC.test.ts`、`memoryService.test.ts`、`test_settings_robustness.ts`。
* **验证结果**：`npm run lint` 通过（含 tests 类型检查）；`npm run test` 61/61 全部通过。

### 6. 解耦纯 TS 工具类的 `globalKernel` 直接依赖
* **问题描述**：部分非 React 的纯 TS 工具类（`telemetry.ts`、`apiClient.ts`、`catbotEventBus.ts` 和 `bridgeCore.ts`）直接 import 并使用了 `globalKernel` 单例，导致微服务级单元测试隔离时无法通过 Mock 内核进行完全解耦测试。
* **修复方案**：对这四个工具类的方法签名实施重构，改为接收可选参数 `kernel?: IKernel`，默认回退 `globalKernel`：
  - `telemetry.ts`：`getTelemetryService(kernel?)` 及所有导出函数末尾新增可选 `kernel?` 参数。
  - `apiClient.ts`：`getLlmService(kernel?)` 及 `isClientMode` / `universalFetch` / `apiClient.sendCatbotRequest` 新增可选 `kernel?` 参数。
  - `catbotEventBus.ts`：`CatbotEventBus` 构造函数新增 `kernel?` 参数；新增 `createCatbotEventBus(kernel?)` 工厂函数供测试隔离使用。
  - `bridgeCore.ts`：将 `tavernHelperEventEmitter` 从 IIFE 改为 `createTavernHelperEventEmitter(kernel?)` 工厂函数，默认导出用 `globalKernel` 创建的实例，保持向后兼容。
* **涉及文件**：
  - [src/utils/telemetry.ts](file:///e:/modules/projects/Mobile-Tavern/src/utils/telemetry.ts)
  - [src/utils/apiClient.ts](file:///e:/modules/projects/Mobile-Tavern/src/utils/apiClient.ts)
  - [src/utils/catbotEventBus.ts](file:///e:/modules/projects/Mobile-Tavern/src/utils/catbotEventBus.ts)
  - [src/utils/tavernHelper/bridgeCore.ts](file:///e:/modules/projects/Mobile-Tavern/src/utils/tavernHelper/bridgeCore.ts)
* **验证结果**：`npm run lint` 通过；`npm run test` 61/61 全部通过。

### 7. 历史消息截断与总结归档
* **问题描述**：前端分页懒加载已落地（见已修复问题 #4），但单会话消息总量持续增长时，大模型上下文 Token 消耗仍随历史线性增加，且 DOM 树持续膨胀。
* **修复方案**：
  - 在 [useChat.tsx](file:///e:/modules/projects/Mobile-Tavern/src/hooks/useChat.tsx) 中新增自动总结触发：当活跃会话内存消息数超过 `ARCHIVE_THRESHOLD = 200` 且开启自动总结时，自动调用 `handleAutoSummaryCheck` 将旧消息归纳为 `SummaryCard` 归档至故事年表。使用 `lastAutoSummarySessionIdRef` 防止对同一会话重复触发。
  - 在 [DialogueHistoryView.tsx](file:///e:/modules/projects/Mobile-Tavern/src/tabs/chat/DialogueHistoryView.tsx) 中新增已归档消息折叠逻辑：当 `session.lastSummarizedMessageId` 存在时，将其之前的消息视为已归档，默认从渲染流中折叠，显示"已归档 N 条至故事年表，点击展开"提示。若未设置则退回原 20 条折叠逻辑。
* **涉及文件**：
  - [src/hooks/useChat.tsx](file:///e:/modules/projects/Mobile-Tavern/src/hooks/useChat.tsx)：新增 `ARCHIVE_THRESHOLD` 自动总结 useEffect。
  - [src/tabs/chat/DialogueHistoryView.tsx](file:///e:/modules/projects/Mobile-Tavern/src/tabs/chat/DialogueHistoryView.tsx)：基于 `lastSummarizedMessageId` 的已归档折叠与文案区分。
* **验证结果**：`npm run lint` 通过；`npm run test` 61/61 全部通过。

### 8. 状态记忆查看与编辑层 + 表结构编辑（合并原 #1+#6 列结构部分）

* **问题描述**：核查发现 [TableMemoryTab.tsx](file:///e:/modules/projects/Mobile-Tavern/src/components/memory-drawer/TableMemoryTab.tsx) 早已实现查看/单元格编辑/行级增删/表启停/重置默认表，原 TODO #1「缺口分析」中"无查看入口"系误判。真实缺口仅为：(a) 删除行/重置表无二次确认；(b) 管理面板不能新建/删除/编辑表结构（仅能启停）。同时核查 [PromptService.ts#L707-L745](file:///e:/modules/projects/Mobile-Tavern/src/kernel/services/PromptService.ts) 确认 LLM 通过 `sheet.name/columns/rows` 动态渲染 Markdown 注入 Prompt，表结构变更无需改后端。
* **修复方案**：单文件改动，仅修改 [TableMemoryTab.tsx](file:///e:/modules/projects/Mobile-Tavern/src/components/memory-drawer/TableMemoryTab.tsx)：
  - A 类补丁：`handleDeleteRow` / `handleResetToDefault` / 新增 `handleDeleteSheet` 全部加 `window.confirm` 二次确认，防止误删 LLM 关键字段
  - B 类表结构编辑：新增 `SheetDraft` 中间态 + `sheetDraft` 状态，管理面板内嵌"新建自定义表"按钮与每张表的"编辑结构"入口
  - 表结构编辑器支持：表名/描述/列名编辑、新增列、删除列（至少保留一列）、新建表名冲突校验
  - 列结构变更的行数据对齐策略：按列名匹配保留旧值（同名列继承），新增列或无匹配列补空字符串，重命名列视为丢失旧数据（在 UI 中明示）
  - 表名冲突校验：新建/重命名均检查同名表，避免 LLM 通过 `updateRow("表名", ...)` 定位错表
* **关键设计决策**：列结构变更的行对齐采用"按列名匹配"而非"按列索引对齐"，理由：用户重命名列时通常希望丢弃旧数据（语义已变），而新增列希望补空，按名匹配自然满足这两点。UI 明确提示此契约。
* **验证结果**：`npm run lint` 通过；`npm run test` 65/65 全部通过。零跨文件改动，零类型扩展（`TableMemorySheet` 类型未变）。

### 9. 主题包导入导出 [难度：低-中]

* **问题描述**：CSS 变量体系与 `sanitizeCss` 已预留，但用户无法导入/导出/分享自定义主题。
* **修复方案**：按 AGENTS.md 准则八新建隔离沙盒 [themePackage.ts](file:///e:/modules/projects/Mobile-Tavern/src/utils/themePackage.ts) 实现核心逻辑：
  - 定义 `.tavern-theme.json` 包格式 `CustomThemePackage`：`schemaVersion/name/version/description/isDark/variables/customCss`
  - CSS 变量白名单 `ALLOWED_CSS_VARS`：放行 23 个标准 UI 变量（background/foreground/primary/card/border/radius/dialogue-color 等），显式禁止 `--safe-area-*` 与 `--android-safe-area-*` 避免破坏移动端避让
  - `validateThemePackage()` 多层校验：schemaVersion、name 长度、变量白名单、值内容安全（禁 `</style>`/`<script>`）
  - `parseThemePackage()` / `serializeThemePackage()` 反/序列化，导出时移除运行时字段（id/importedAt）保持包文件纯净
  - `generateThemeId()` 基于 name 的 FNV-1a 短哈希，同名包幂等去重
  - `applyThemePackage()` / `removeThemePackageStyle()` 通过 `<style id="tavern-custom-theme-xxx">` 标签注入到 document.head，CSS 选择器 `[data-theme="custom_xxx"]` 命中变量覆盖
  - customCss 经 `sanitizeCss` 二次过滤（拦 `@import`/`url()`/`expression()`/`position:fixed`/`<script>`）
* **接入路径**：
  - [types.ts](file:///e:/modules/projects/Mobile-Tavern/src/types.ts) 顶部 `import type { CustomThemePackage }` 并扩展 `UserSettings.customThemes?` 字段
  - [defaults.ts](file:///e:/modules/projects/Mobile-Tavern/src/hooks/settings/defaults.ts) 添加 `customThemes: []` 默认值
  - [useSettingsLoader.ts](file:///e:/modules/projects/Mobile-Tavern/src/hooks/settings/useSettingsLoader.ts) 合并 `customThemes` 字段
  - [localDB.ts](file:///e:/modules/projects/Mobile-Tavern/src/utils/localDB.ts) `cloneSettings` 深拷贝 customThemes 数组与 variables 对象，避免 React 状态与持久化共享引用
  - [AppContext.tsx](file:///e:/modules/projects/Mobile-Tavern/src/contexts/AppContext.tsx) `ThemeType` 扩展为字面量联合 + `(string & {})` 保留补全同时允许任意 custom_id；isDark 判定对 `custom_*` 前缀从 `localStorage.mobile_tavern_custom_is_dark` 读取，避免 AppProvider 反向依赖 settings.customThemes
  - [ThemeConfigSection.tsx](file:///e:/modules/projects/Mobile-Tavern/src/tabs/settings/ThemeConfigSection.tsx) 主题下拉扩展自定义主题选项（含暗色/亮色标记）；新增"主题包管理"区域：导入按钮（`<input type="file" accept=".json">`）、已导入列表（应用/导出/删除三按钮）
* **关键设计决策**：
  - **isDark 通过 localStorage 传递**：AppProvider 在外层无法访问 settings，ThemeConfigSection 在应用 custom 主题前写入 `localStorage.mobile_tavern_custom_is_dark`，AppProvider 的 useEffect 读取此标记判定 isDark。这避免 AppProvider 反向依赖 settings.customThemes，保持架构清晰
  - **同 id 主题覆盖**：导入同名包（id 相同）覆盖旧版本，幂等去重而非追加
  - **CSS 选择器策略**：所有 customThemes 在挂载时通过 useEffect 全量注入 `<style>` 标签，切换主题只需切换 `data-theme` 属性，CSS 选择器自动命中，避免运行时重注入闪烁
* **验证结果**：`npm run lint` 通过；`npm run test` 65/65 全部通过。

---

## 🚀 未来待办事项 (Future Action Items)

> **产品方向校准**：放弃通用第三方插件生态（移动端合规与范式壁垒不可逾越），转向"用户可编程底座"模式（Obsidian 式，非 VSCode 式）。核心是把已实现的内核能力从"LLM 自动跑的黑盒"开放为"用户可查看/编辑/定义的可编程接口"，保持底座属性，避免滑向内容消费型角色扮演软件。
>
> 以下待办按实现难度从低到高排序，前项为后项基础。

### 1. 主题包在线编辑器 [难度：中]

* **目标**：在已落地的"导入/导出/列表管理"基础上，提供内置的可视化主题编辑器，让用户无需手写 JSON 即可调色与预览。
* **依赖**：待办已修复 #9（主题包导入导出）。
* **现状基础**：
  - [themePackage.ts](file:///e:/modules/projects/Mobile-Tavern/src/utils/themePackage.ts) 已实现包格式 + 校验 + 序列化 + CSS 注入
  - [ThemeConfigSection.tsx](file:///e:/modules/projects/Mobile-Tavern/src/tabs/settings/ThemeConfigSection.tsx) 已有主题包列表与应用入口
* **缺口**：
  - 可视化调色器（每个白名单 CSS 变量一个颜色选择器）
  - 实时预览（编辑时即时注入 `<style>` 预览效果）
  - "另存为主题包"按钮（从当前调色状态生成 CustomThemePackage）
  - customCss 编辑器（textarea + sanitize 实时校验）
* **产出**：主题编辑器 UI（颜色选择器 + 实时预览 + 另存为 + customCss 编辑器）。
* **预估**：3-5 天。主要工作量在 UI 与实时预览性能。

### 4. 叙事记忆用户控制 [难度：中]

* **目标**：把叙事记忆（时间轴摘要）从"自动生成黑盒"开放为用户可控——查看、手动编辑、删除、手动触发总结。
* **现状基础**：
  - `MemorySummary` 服务已实现自动摘要生成（[testMemorySummary](file:///e:/modules/projects/Mobile-Tavern/tests/suites/memorySummary.test.ts) 已验证）。
  - `ChatSession.summaries` 字段已存储摘要数据。
* **缺口**：缺用户侧查看/编辑 UI；缺手动触发总结的入口；缺单条摘要编辑写回路径。
* **产出**：叙事记忆管理 UI（时间轴视图、单条编辑、手动触发总结、删除）。
* **预估**：3-5 天。已有数据，缺 UI 和写回路径。

### 5. 字典记忆查询视图 [难度：中]

* **目标**：把字典记忆（`memory_dict` Store）开放为用户可查询的结构化数据视图。
* **现状基础**：
  - `memory_dict` Store 已实现，L0/L1/L2 三级降级抽取已落地（[testMemoryExtractor](file:///e:/modules/projects/Mobile-Tavern/tests/suites/memoryExtractor.test.ts) 已验证）。
  - 标签倒排索引已实现（[testMemoryRecall](file:///e:/modules/projects/Mobile-Tavern/tests/suites/memoryRecall.test.ts)）。
* **缺口**：缺用户侧查询 UI；缺按标签/时间/会话维度过滤；缺手动编辑条目能力。
* **产出**：字典记忆查询 UI（按标签/时间过滤、条目编辑、批量导出）。
* **预估**：3-5 天。已有数据，缺查询 UI。

### 6. 状态记忆 Schema 高阶层（字段类型/默认值/模板持久化） [难度：中-高]

* **目标**：在已落地的"用户可编辑表名/列名"基础上，进一步引入字段类型约束（number/date/enum）、默认值、Schema 模板持久化与跨会话复用——把"用户可重定义结构"从一次性编辑升级为可携带的 Schema 资产。
* **依赖**：待办 #1（已落地，见已修复 #8）。
* **现状基础**：
  - 用户已可在 [TableMemoryTab.tsx](file:///e:/modules/projects/Mobile-Tavern/src/components/memory-drawer/TableMemoryTab.tsx) 管理面板新建/删除/重命名表与列，列结构变更按列名匹配保留旧数据。
  - LLM 通过 [PromptService.ts](file:///e:/modules/projects/Mobile-Tavern/src/kernel/services/PromptService.ts) 动态读取 sheet 结构注入 Prompt，已感知用户自定义 Schema。
  - 所有列当前均为 string 类型，无类型约束；表结构仅存于会话内，无跨会话模板。
* **缺口**：
  - 字段类型系统（number/date/enum/text）与 UI 类型选择器
  - 字段默认值机制（新增行时自动填充）
  - Schema 模板持久化（导出/导入 `.tavern-schema.json`，跨会话/角色复用）
  - 旧数据迁移：当用户为现有列追加类型约束时的兼容性处理
* **产出**：字段类型选择 UI + 默认值配置 + Schema 包导入导出 + 类型约束的 LLM 提示词增强。
* **预估**：5-7 天。涉及 LLM 提示词同步与数据迁移，需谨慎设计。

### 7. 脚本片段管理 UI [难度：高]

* **目标**：把 TavernHelper iframe 桥接能力从"角色卡嵌脚本"扩展为"用户自管理的脚本库"——启用/禁用/编辑/分享。
* **现状基础**：
  - [tavernHelperMocks.ts](file:///e:/modules/projects/Mobile-Tavern/src/utils/tavernHelper/tavernHelperMocks.ts) + [bridgeCore.ts](file:///e:/modules/projects/Mobile-Tavern/src/utils/tavernHelper/bridgeCore.ts) iframe 沙盒桥接已完整。
  - [scriptIframe.ts](file:///e:/modules/projects/Mobile-Tavern/src/utils/tavernHelper/scriptIframe.ts) 脚本注入已落地。
* **缺口**：缺用户侧脚本库管理 UI；缺脚本启停控制；缺脚本分享包格式。
* **合规优势**：用户自用脚本不分发，iOS/Android 合规友好（区别于第三方插件市场）。
* **产出**：用户脚本库管理 UI（列表/编辑/启停/导入导出）。
* **预估**：1-2 周。UI 复杂度高，需配合 iframe 生命周期管理。

### 8. 规则触发系统 [难度：高]

* **目标**：用户定义"当状态 X 满足条件 Y 时执行 Z"的自动化规则，类似 Notion automation。
* **依赖**：待办 #1、#2、#6（状态记忆层）落地。
* **现状基础**：内核 Pipeline + EventBus 已实现，可作为规则执行器底座。
* **缺口**：缺规则 DSL 设计；缺条件求值器；缺动作执行器（发消息/改状态/触发世界书/调用 LLM）；缺规则管理 UI。
* **产出**：规则触发引擎（条件 DSL + 求值器 + 动作执行器）+ 规则管理 UI。
* **预估**：1-2 周。需设计安全的规则 DSL，防止用户写出死循环或资源耗尽规则。

### 9. 数据派生计算 [难度：最高]

* **目标**：基于状态字段做衍生计算（类似 Notion formula），例如"好感度 = 互动次数 × 0.1 + 关键事件 × 10"。
* **依赖**：待办 #6（Schema 层）落地。
* **现状基础**：无，需新建公式解析器。
* **缺口**：缺公式 DSL 解析器；缺安全求值沙盒（防止用户公式访问全局对象）；缺公式字段类型推导；缺公式编辑 UI。
* **产出**：公式字段系统（DSL 解析器 + 安全求值器 + 编辑器 UI）。
* **预估**：2 周以上。需设计安全的表达式沙盒，防止注入攻击。

---

## ✍️ 变更记录

| 日期 | 变动内容 |
|---|---|
| 2026-07-17 | 落地主题包导入导出（原 TODO #1）：新建 `src/utils/themePackage.ts` 沙盒实现 `.tavern-theme.json` 包格式 + CSS 变量白名单（23 个标准变量，禁 `--safe-area-*`）+ 多层校验 + 序列化 + `<style>` 标签注入。接入 types/defaults/useSettingsLoader/localDB cloneSettings/AppContext ThemeType 扩展（字面量联合 + `(string & {})`）/ThemeConfigSection UI（导入按钮 + 已导入列表 + 应用/导出/删除三按钮）。isDark 通过 localStorage 传递避免 AppProvider 反向依赖 settings。65/65 测试全通过。TODO #1 更新为"主题包在线编辑器"（可视化调色器 + 实时预览）。 |
| 2026-07-17 | 落地状态记忆查看与编辑层 + 表结构编辑（合并原 #1+#6 列结构部分）：核查发现 `TableMemoryTab.tsx` 早已实现查看/单元格编辑/行级增删/表启停，原 #1 缺口分析系误判；本次补全删除行/重置表/删除表二次确认 + 新建/删除/编辑表结构（表名/描述/列名）+ 列结构变更按列名匹配保留旧数据。同时核查 `PromptService.ts` 确认 LLM 动态读取 sheet 结构注入 Prompt，表结构变更无需改后端。单文件改动，65/65 测试全通过。TODO #6 调整为"状态记忆 Schema 高阶层（字段类型/默认值/模板持久化）"。 |
| 2026-07-17 | 产品方向校准：放弃通用第三方插件生态（移动端合规与范式壁垒），转向"用户可编程底座"模式。新增 9 项待办，按实现难度从低到高排序：状态记忆查看层/编辑层、主题包导入导出、叙事记忆用户控制、字典记忆查询视图、状态记忆 Schema 层、脚本片段管理 UI、规则触发系统、数据派生计算。 |
| 2026-07-16 | 落地全部代办事项：#4 消息分页懒加载、#5 tsconfig 检查范围扩宽至 tests 并修复 11 个测试文件类型错误、#6 纯 TS 工具类 globalKernel 解耦（4 文件改为可选 kernel 参数 + 工厂函数）、#7 历史消息截断与总结归档（200 条阈值自动触发 + lastSummarizedMessageId 折叠渲染）。全部通过 lint 与 61/61 测试。 |
| 2026-07-16 | 落地 TODO-4：消息分页懒加载（`MESSAGES_PAGE_SIZE = 50` + 顶部触发加载更多 + 滚动位置保持）。调整原代办 #3 顺序与编号；新增"历史消息截断与总结归档"作为后续优化方向。 |
| 2026-07-16 | 新增 `as any` 渐进式精确化清理计划（P0-P4 共 5 阶段，534 处）。 |
| 2026-07-16 | 完成 `as any` 全量清理：534 → 69 处（87.1%）。P0 keyManager(11)、P1 useRerollMessage/useSendMessage/LLMService(32)、P2 Kernel/localDB/UpdateCheckService/requestSchema(23)、P3 MessageBubble/useBackupRestore/AsrService/TtsService(22)、P4 测试 mock 31 文件(314) + src 剩余 34 文件(70)。保留 tavernHelperMocks.ts(65) SillyTavern 动态 Mock。lint + 64/64 test 全通过。 |
