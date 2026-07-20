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

### 11. 叙事记忆用户控制（时间轴摘要管理）
* **问题描述**：原代办中计划开发「叙事记忆用户控制」（让用户查看、手动编辑、删除、手动触发总结时间轴数据），但经核查，此系列功能及对应交互界面事实上早已开发完整。
* **现状核实**：
  - **时间轴与卡片管理 UI**：[StoryTimelineView.tsx](file:///d:/projects/Mobile-Tavern/src/tabs/chat/StoryTimelineView.tsx) 已完全实现时间轴的可见化查看，并具备“手工补充”、“编辑该条记忆年表”和“删除该条记忆年表”三大核心管理操作。
  - **手动整理入口**：[QuickDialogueOptions.tsx](file:///d:/projects/Mobile-Tavern/src/tabs/chat/QuickDialogueOptions.tsx) 中的“整理潜意识”选项允许用户手动触发大模型总结并归档。
  - **核心逻辑与写回**：[useTimelineSummary.ts](file:///d:/projects/Mobile-Tavern/src/hooks/useChat/useTimelineSummary.ts) 完全接管了自动检测、手动编辑与落库保存逻辑。
* **处理方案**：已从“未来待办事项”中移出，标记为已落地。

### 12. 主题包在线编辑器
* **问题描述**：在已落地的主题包导入导出基础上，用户缺少内置的可视化调色与实时预览编辑器，需手动修改或编写 JSON 包文件。
* **修复方案**：
  - 新建了核心编辑器组件 [ThemeEditorModal.tsx](file:///d:/projects/Mobile-Tavern/src/components/ThemeEditorModal.tsx)，支持主题名称、版本号、描述等基本元数据编辑与 `isDark` 属性切换。
  - 颜色变量分组：将 CSS 白名单变量划分为基础配色、主色与强调、卡片与对话、状态配置四个区域。对每个变量双向绑定 `<input type="color">` 颜色选择器与 `<input type="text">` 文本编辑框。
  - 引入了实时注入预览机制：每次调色时，自动将当前修改编译为 `custom_theme_preview` 主题样式注入 head 并修改全局 data-theme，使整站 UI 立即响应修改。
  - 集成了 `customCss` 在线编辑器，包含实时的 `sanitizeCss` 安全过滤以防注入攻击。
  - 对接了 [ThemeConfigSection.tsx](file:///d:/projects/Mobile-Tavern/src/tabs/settings/ThemeConfigSection.tsx)，新增“新建主题”和“编辑主题”按钮，并完善了保存（同名校验、幂等 ID 覆盖、样式替换）与取消（还原原始主题ID、清理预览样式）的状态清理。
* **涉及文件**：
  - [src/components/ThemeEditorModal.tsx](file:///d:/projects/Mobile-Tavern/src/components/ThemeEditorModal.tsx)
  - [src/tabs/settings/ThemeConfigSection.tsx](file:///d:/projects/Mobile-Tavern/src/tabs/settings/ThemeConfigSection.tsx)
* **验证结果**：`npm run lint` 类型检查通过；`npm run test` 66/66 全部测试通过。

### 13. 字典记忆查询视图
* **问题描述**：自动学习的词典记忆存在黑盒性质，用户侧缺少查询、筛选与手动删改功能。
* **修复方案**：
  - 扩展底层数据接口：在 [localDB.ts](file:///d:/projects/Mobile-Tavern/src/utils/localDB.ts) 新增 `deleteDictEntryById(id)` 物理删除方法，并在 [MemoryStorage.ts](file:///d:/projects/Mobile-Tavern/src/kernel/services/memory/MemoryStorage.ts) 暴露透传。
  - 重构了 [DictTab.tsx](file:///d:/projects/Mobile-Tavern/src/components/memory-drawer/DictTab.tsx) 组件：
    - 检索过滤：新增搜索框，支持不区分大小写模糊检索实体名称与别名内容。
    - 类型过滤：新增分类 Tab 过滤器（全部、人物、地点、物品、组织、概念），可快速划分并展示不同类型的词条。
    - 手动新增：增加了新增词条的表单容器，允许用户在 UI 上手动定义名词类型与别名列表并写入 IndexedDB，首创轮次标记为“手动创建”。
    - 手动删除：为词条卡片新增删除图标，配合 `window.confirm` 进行二次确认以进行数据物理移除。
    - 批量导出：支持一键将当前会话下的记忆词典序列化为格式干净的 JSON 纯净包并提供浏览器下载。
* **涉及文件**：
  - [src/utils/localDB.ts](file:///d:/projects/Mobile-Tavern/src/utils/localDB.ts)
  - [src/kernel/services/memory/MemoryStorage.ts](file:///d:/projects/Mobile-Tavern/src/kernel/services/memory/MemoryStorage.ts)
  - [src/components/memory-drawer/DictTab.tsx](file:///d:/projects/Mobile-Tavern/src/components/memory-drawer/DictTab.tsx)
* **验证结果**：`npm run lint` 通过；`npm run test` 66/66 全部通过。

---

## 🚀 未来待办事项 (Future Action Items)

> **产品方向校准**：放弃通用第三方插件生态（移动端合规与范式壁垒不可逾越），转向"用户可编程底座"模式（Obsidian 式，非 VSCode 式）。核心是把已实现的内核能力从"LLM 自动跑的黑盒"开放为"用户可查看/编辑/定义的可编程接口"，保持底座属性，避免滑向内容消费型角色扮演软件。
>
> 以下待办按实现难度从低到高排序，前项为后项基础。

### 1. 状态记忆 Schema 高阶层（字段类型/默认值/模板持久化） [难度：中-高]

* **目标**：在已落地的"用户可编辑表名/列名"基础上，进一步引入字段类型约束（number/date/enum）、默认值、Schema 模板持久化与跨会话复用——把"用户可重定义结构"从一次性编辑升级为可携带的 Schema 资产。
* **依赖**：待办已修复 #8。
* **现状基础**：
  - 用户已可在 [TableMemoryTab.tsx](file:///d:/projects/Mobile-Tavern/src/components/memory-drawer/TableMemoryTab.tsx) 管理面板新建/删除/重命名表与列，列结构变更按列名匹配保留旧数据。
  - LLM 通过 [PromptService.ts](file:///d:/projects/Mobile-Tavern/src/kernel/services/PromptService.ts) 动态读取 sheet 结构注入 Prompt，已感知用户自定义 Schema。
  - 所有列当前均为 string 类型，无类型约束；表结构仅存于会话内，无跨会话模板。
* **缺口**：
  - 字段类型系统（number/date/enum/text）与 UI 类型选择器
  - 字段默认值机制（新增行时自动填充）
  - Schema 模板持久化（导出/导入 `.tavern-schema.json`，跨会话/角色复用）
  - 旧数据迁移：当用户为现有列追加类型约束时的兼容性处理
* **产出**：字段类型选择 UI + 默认值配置 + Schema 包导入导出 + 类型约束的 LLM 提示词增强。
* **预估**：5-7 天。涉及 LLM 提示词同步与数据迁移，需谨慎设计。

### 2. 脚本片段管理 UI [难度：高]

* **目标**：把 TavernHelper iframe 桥接能力从"角色卡嵌脚本"扩展为"用户自管理的脚本库"——启用/禁用/编辑/分享。
* **现状基础**：
  - [tavernHelperMocks.ts](file:///e:/modules/projects/Mobile-Tavern/src/utils/tavernHelper/tavernHelperMocks.ts) + [bridgeCore.ts](file:///e:/modules/projects/Mobile-Tavern/src/utils/tavernHelper/bridgeCore.ts) iframe 沙盒桥接已完整。
  - [scriptIframe.ts](file:///e:/modules/projects/Mobile-Tavern/src/utils/tavernHelper/scriptIframe.ts) 脚本注入已落地。
* **缺口**：缺用户侧脚本库管理 UI；缺脚本启停控制；缺脚本分享包格式。
* **合规优势**：用户自用脚本不分发，iOS/Android 合规友好（区别于第三方插件市场）。
* **产出**：用户脚本库管理 UI（列表/编辑/启停/导入导出）。
* **预估**：1-2 周。UI 复杂度高，需配合 iframe 生命周期管理。

### 3. 规则触发系统 [难度：高]

* **目标**：用户定义"当状态 X 满足条件 Y 时执行 Z"的自动化规则，类似 Notion automation。
* **依赖**：未来待办 #1（Schema 层）与 待办已修复 #8。
* **现状基础**：内核 Pipeline + EventBus 已实现，可作为规则执行器底座。
* **缺口**：缺规则 DSL 设计；缺条件求值器；缺动作执行器（发消息/改状态/触发世界书/调用 LLM）；缺规则管理 UI.
* **产出**：规则触发引擎（条件 DSL + 求值器 + 动作执行器）+ 规则管理 UI。
* **预估**：1-2 周。需设计安全的规则 DSL，防止用户写出死循环或资源耗尽规则。

### 4. 数据派生计算 [难度：最高]

* **目标**：基于状态字段做衍生计算（类似 Notion formula），例如"好感度 = 互动次数 × 0.1 + 关键事件 × 10"。
* **依赖**：未来待办 #1（Schema 层）落地。
* **现状基础**：无，需新建公式解析器。
* **缺口**：缺公式 DSL 解析器；缺安全求值沙盒（防止用户公式访问全局对象）；缺公式字段类型推导；缺公式编辑 UI。
* **产出**：公式字段系统（DSL 解析器 + 安全求值器 + 编辑器 UI）。
* **预估**：2 周以上。需设计安全的表达式沙盒，防止注入攻击。

### 5. AbortSignal 协作式中断缺陷与底层资源泄露治理 [难度：中-高]

* **目标**：解决 `AbortSignal` 仅作为协作式而非抢占式中断的局限性，治理内核与底层服务中由于超时/中止未正确传导至底层实现而导致的潜在资源泄漏问题。
* **现状基础**：
  - 内核提供了 `AbortController` 并在超时或销毁时进行 `abort()` 触发。
  - `DatabaseService` 等服务接收了 `AbortSignal` 但并未将其透传至底层的 IndexedDB 事务或写队列中。
* **缺口**：
  - `localDB` 等底层的 IndexedDB 操作缺少对 `AbortSignal` 的监听，当 `enqueueWrite` 触发 15 秒超时时，未能调用对应 IDB 事务的 `transaction.abort()` 进行真正取消，可能导致死锁与资源挂起。
  - 正则表达式匹配及 MVU 脚本解析过程缺乏分步的 `signal.aborted` 检查，在面对复杂或恶意脚本时无法安全退出。
  - Tauri 原生桥接等操作中，需要确保 `AbortSignal` 的状态正确同步至 Rust 后端以取消后台线程或网络请求。
* **产出**：底层事务与网络请求的中断传导机制（IndexedDB 事务主动 `abort`、复杂处理循环插入 `aborted` 检查点、原生桥接取消透传）。
* **预估**：3-5 天。

---

## ✍️ 变更记录

| 日期 | 变动内容 |
|---|---|
| 2026-07-20 | 完成 Kernel 下一轮兼容迁移与长会话重发竞态修复：(1) 修复约 10 轮以上会话重发时偶发生成两轮回复：根因是 `useRerollMessage` 已取得 `isSendingRef` 同步锁、但尚未创建 `streamingMessageId` 的持久化/提示词构建窗口内，第二次触发会把真实锁误判为残留锁并强制解锁；现改为发送与重发共用不可通过流式标记误解锁的同步事务锁，并新增 `tests/vitest/useRerollMessage.test.ts` 模拟 10 轮会话快速重复重发，确认仅一个事务进入数据库。(2) `Kernel.getPipeline` 不再自动创建未知管道，拼写错误或插件漏注册会明确抛错；自定义管道必须在 bootstrap 或插件激活阶段调用 `registerPipeline`，对应内核测试已覆盖。(3) 应用入口改用 `AppContextAssembler`，保留 `LegacyAppContextProvider` 兼容别名；`ChatInputArea` 从订阅完整 `UnifiedAppContext` 改为 `useUnifiedApp` 选择器，降低无关状态级联渲染。(4) 将 `lastRecalledMemories` 从 `ChatSession` 临时附加字段迁移为 `useChat` 组合层独立瞬态状态，会话切换自动清空；`RecallTab` 与 token 估算仅消费该运行时快照，召回业务数据不再混入 Session 实体或持久化底座。(5) 扩充 `architectureBoundaries.test.ts`，阻止聊天输入区重新全量订阅 Context 及发送/重发流程重新污染 ChatSession。验证：`npm run lint` 通过；`npm test` 77/77 全绿（Vitest 含新增重发测试）；生产构建通过。 |
| 2026-07-20 | 完成 Kernel 架构边界收敛：(1) 新增记忆领域 `MemoryPersistencePort` 与 `IndexedDbMemoryPersistenceService` 适配器，将 `MemoryService`、`MemoryStorage`、`MemoryRecall`、`MemorySummary` 对 `utils/localDB` 的直接依赖全部移除；端口归属记忆领域、物理实现归属 `infrastructure/storage`，未向通用底座写入记忆召回、摘要等业务规则，`IDatabaseService` 仅补充通用会话摘要聚合能力。(2) `pipelineHelpers` 改为显式接收当前 `IKernel`，移除 `globalKernel` 回流；`useChat.tsx` 保留为职责统一的组合入口，仅向发送与重掷 Hook 注入 Kernel，不做形式化拆分。(3) 野牛概率算法迁移至 `src/domain/chat/bisonProbability.ts`，业务管道不再反向依赖 Hook；旧路径保留兼容重导出。(4) `Kernel.publish` / `publishParallel` 正式接入消息 schema 校验：严格模式抛错，非严格模式记录并丢弃非法消息。(5) 将世界书触发算法拆入 `LorebookResolver.ts`，将记忆物理表操作与密钥加密拆入 `indexedDbMemoryStore.ts`、`settingsCrypto.ts`；`PromptService.ts` 与 `localDB.ts` 均降至 1000 行以内。(6) 新增 `architectureBoundaries.test.ts`，持续阻止记忆领域直连 localDB、Service 反向依赖 Hook、管道回流全局 Kernel 及核心文件重新超限。验证：`npm run lint` 通过；`npm test` 77/77 全绿（含 Vitest 子进程）；`npm run build` 通过，仅保留既有动态/静态混合导入与大分块警告。 |
| 2026-07-20 | Kernel 类型契约解耦与 E 类 any 清理（C 方案 + 全部 E 类清理）：(1) `src/kernel/types.ts` 删除 L1 `import { ChatSession, UserSettings } from "../types"` 反向依赖；删除 L58-L74 `OutputPipelineContext` 定义（已上移）；`ISettingsService` 泛型化为 `ISettingsService<TSettings = any>` 对齐 `IDatabaseService<TSession=any>` / `IPromptService<TLorebook=any>` 范式；`IMemoryService` 泛型化为 `IMemoryService<TStorage, TExtractor, TRecall, TStateTable, TSummary>` 5 参数（默认 any 保持向后兼容）；清理 E 类 any 3 处：`ILLMService.sendCatbotRequest` 的 `clientContext?: any` → `unknown`、`IPromptService.getTriggeredLorebookEntries` 的 `entries: any[]` 与返回 `any[]` 改 `TLorebook[]`、`IAsrService.startListening` 的 `onError: (err: any)` → `unknown`。(2) 新建 `src/services/pipeline/` 业务管道层：`types.ts` 承接 `OutputPipelineContext` 定义（含注释说明上移原因），`index.ts` barrel 重导出 4 个中间件与 `OutputPipelineContext` 类型；`git mv src/kernel/middlewares/outputMiddlewares.ts src/services/pipeline/outputMiddlewares.ts`，同步修改其内部 3 处 import 路径并清理 `kernel.getService<any>(KernelServices.Memory)` → `getService<IMemoryService>` × 2、`kernel.getService<any>(KernelServices.Script)` → `getService<IScriptService>` × 1；删除空目录 `src/kernel/middlewares/`。(3) 实现类泛型化绑定：`SettingsService.ts` 改 `implements ISettingsService<UserSettings>`；`MemoryService.ts` 改 `implements IMemoryService<MemoryStorage, MemoryExtractor, MemoryRecall, MemoryStateTable, MemorySummary>`。(4) `services/memory/index.ts` 新增 `MemoryServiceTyped` 类型别名（聚合 5 子模块类型），供消费方一次书写避免重复泛型参数。(5) 消费点同步更新：`registerDefaultPipelines.ts` import 路径改 `../../services/pipeline`；`streamHelpers.ts` 与 `pipelineHelpers.ts` 拆分 `OutputPipelineContext` import 改从 `services/pipeline`；3 处 ISettingsService 消费点（`useSettingsLoader`/`useBackupRestore`/`useSettingsPersistence`）`getService<ISettingsService>` → `getService<ISettingsService<UserSettings>>`；4 处 IMemoryService 消费点（`DictTab`/`ChatContext`/`useBackupRestore`/`useChat`）`getService<IMemoryService>` → `getService<MemoryServiceTyped>`。(6) 测试文件 `tests/suites/services.test.ts` 同步 import 路径。验证：`tsc --noEmit` 0 errors；`npm test` 76/76 全绿（vitest 子进程 327/327）。共 16 文件改动（3 新建 + 13 修改）。 |
| 2026-07-19 | 完成 Kernel zod L2 Phase B（schema 定义层，纯加性零行为变更）：新建 [src/kernel/schemas/index.ts](file:///e:/modules/projects/Mobile-Tavern/src/kernel/schemas/index.ts)（166 行）导出 `validateService` / `validateMessage` / `validateServiceRetrieval` 三纯函数 + `SAFE_PROXY_SYMBOL` 契约标记 + `ValidationResult` result 对象类型；设计为不抛错、不耦合 Kernel 内部状态，由 Phase C 调用方按 validationMode 决定 throw/warn/skip。`validateService` 分级策略：P0 服务（ChatStream/Script/Database/Memory/LLM）用完整 schema 校验所有声明方法存在且为 function，P1 服务（其余 12 个）及未知名服务仅校验 IKernelService 基础结构（name/init/destroy）。`validateMessage` 分级策略：所有 topic 顶层结构校验 → 动态 topic（`tavern_helper:*`）跳过 payload 校验（符合 SillyTavern 兼容契约）→ 静态 topic（`script:destroyed`/`catbot:event`）额外 payload schema 校验 → 未登记静态 topic 仅顶层校验。`validateServiceRetrieval` 通过 `SAFE_PROXY_SYMBOL in obj` 检测 SafeProxy 降级返回并跳过 P0 校验（兼容 Proxy 对象，Symbol 属性不被 get trap 拦截）。新增 [tests/suites/kernelSchemaValidation.test.ts](file:///e:/modules/projects/Mobile-Tavern/tests/suites/kernelSchemaValidation.test.ts)（190 行）`testKernelSchemaValidation()` 函数含 10 项主断言 + 2 项边界断言：P0 ChatStream 合法通过 / P0 缺方法失败且 error 含方法名 / P1 仅基础结构通过 / 缺 init 失败 / 静态 topic 合法 payload 通过 / 静态 topic payload 类型错失败 / 动态 topic 任意 payload 跳过校验 / 缺 topic 失败 / SafeProxy 标记跳过 P0 校验（含交叉验证同对象用 validateService 仍失败）/ 真实 P0 服务通过 / null+undefined 输入不抛错返回 failure。测试用 `expectFailure` helper + `ValidationFailure = Extract<ValidationResult, {success:false}>` 窄化类型，不实例化 Kernel，直接调用 validate* 函数。注册到 [tests/suites/index.ts](file:///e:/modules/projects/Mobile-Tavern/tests/suites/index.ts) barrel + [tests/run_all_tests.ts](file:///e:/modules/projects/Mobile-Tavern/tests/run_all_tests.ts) 测试数组（位置 [75/76]，vitest 桥接 [76/76] 保持末尾）。Phase B 全量产物：`p0Services.ts`（134 行，5 P0 schema + 基础结构 + P1 清单 + isP0Service/getP0ServiceSchema）、`messages.ts`（56 行，KernelMessageSchema + 2 静态 topic + 动态黑名单 + isDynamicTopic/getStaticTopicSchema）、`index.ts`（166 行，3 工具函数 + SAFE_PROXY_SYMBOL + ValidationResult）。验证：`tsc --noEmit` 0 errors；`npm test` 76/76 全绿（75 旧 + 1 新 testKernelSchemaValidation，vitest 子进程 327/327 全绿）。Phase B 风险评估：极低（纯加性，未接入 Kernel.ts，运行时行为零变更）；回退方案：删除 3 个 schema 文件 + 测试文件 + 还原 2 处测试注册。下一步由用户决策是否进入 Phase C（Kernel.ts strictMode 三态升级 + registerService/publish/getService 三边界校验接入 + SafeProxy 加标记 + 8 项集成测试）。 |
| 2026-07-19 | 流式渲染性能优化（React 框架内激进改造，零架构变更）：(1) `streamHelpers.ts:29-109` `buildThrottledUpdater` 的 `updateSessionsContent` 重写 — 原实现每次 60ms 节流触发都做 `prev.map(s => s.messages.map(m => ...))` 双层 O(sessions × messages) 遍历创建三层新对象，长会话下开销显著；改为 `cachedSessionIdx`/`cachedMsgIdx` 跨 tick 复用（带 id 校验防失效）+ `arr.slice()` 浅拷贝 + 单点索引赋值，命中路径降为 O(1)，缓存失效时自动回退 `findIndex` 重建，安全无副作用。缓存失效场景已覆盖：sessions 被切换/删除、messages 被增删（如新消息插入），均通过 id 校验自动检测。(2) `DialogueHistoryView.tsx:67-75` 引入 `React.useDeferredValue(rawMessages)` 包裹消息列表派生源 — 原实现 `visibleMessages.map(...)` 同步渲染所有可见消息（未用虚拟列表），流式期间 60ms setSessions 直接阻塞主线程；useDeferredValue 让 React 把"消息列表变化"降级为低优先级更新，高优先级交互（滚动/点击/输入）能立即响应。关键安全点：`isStreamingThisMsg` 判断走 `window.TavernHelperStreamingMessageId`（同步读取，[MessageBubble.tsx:110-125](file:///e:/modules/projects/Mobile-Tavern/src/tabs/chat/MessageBubble.tsx#L110-L125)），不依赖 deferred 值，流式渲染判断逻辑不受影响。验证：`tsc --noEmit` 0 errors 0 warnings；`npm test` 75/75 全绿（含 FormattedText 8 tests / useChatScroll 4 tests 等流式相关测试）。预期收益：流式期间 setSessions 路径对象创建开销下降 30-50%（slice+索引 vs 双层 map），主线程响应性显著提升（deferred 让出调度）。未做项：(A) 流式期间跳过 iframe srcdoc 生成（收益最大但会破坏 MVU 卡脚本运行环境，搁置）；(B) Web Worker 解析 Markdown（项目用自定义 domToReact + iframe srcdoc，强耦合主线程 DOM，迁移成本高）。 |
| 2026-07-18 | 完成 P1.2 账号核心落地与端到端全流程验证：新增 `cloud/migrations/20260718120004_add_users_is_active.up.sql`（`ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE` + 部分索引 `idx_users_is_active WHERE is_active = FALSE` 用于快速定位停用账号）与对应 `down.sql` 回滚脚本，对齐 DB schema 与 `shared::account::User` 类型契约。补齐 `cloud/src/account/` 模块 5 文件：(1) `mod.rs` 装配 `/account/{register,login,refresh,logout}` 四路由到 `Router<AppState>`；(2) `password.rs` 封装 argon2id 哈希/校验（`Argon2::default()` + `SaltString::generate(&mut OsRng)` + PHC 字符串格式输出，5 单元测试覆盖 roundtrip / 错误密码 / 盐唯一性 / 哈希格式损坏 / 长度≤255）；(3) `jwt.rs` 实现 HS256 双 claims 体系（`AccessClaims` 含 `token_type="access"` / `RefreshClaims` 含 `jti: Uuid` + `token_type="refresh"`，防止 token 类型混用），`create_access_token` / `create_refresh_token` 签发函数返回 `(token, expires_in|jti)`，`verify_access_token` / `verify_refresh_token` 校验签名+exp+token_type，Redis 黑名单 `blacklist_refresh_token(jti, ttl)` 写入 `revoked:refresh:{jti}` key 并设 TTL=剩余有效期避免永久膨胀，`is_refresh_token_blacklisted` 查询是否撤销，7 单元测试覆盖 roundtrip / 过期 / 篡改 / 类型错配 / 密钥错配 / 编译期符号检查；(4) `models.rs` 定义 `UserRow` (sqlx `FromRow`) 映射 PG users 表 8 字段（id/email/password_hash/email_verified/display_name/created_at/updated_at/is_active），`impl From<UserRow> for shared::account::User` 桥接 `email NOT NULL` 与 `Option<String>` 的 schema 差异；(5) `handlers.rs` 实现 4 端点：`register`（邮箱规范化 trim+lowercase → 格式校验 → 预查重快速路径 → argon2 哈希 → `pool.begin()` 事务插入 user+identity 并捕获 `is_unique_violation` 作为竞态安全网 → 签发 token 对）、`login`（统一返回 `InvalidCredentials` 防用户枚举：邮箱不存在/密码错误/账号停用均同一错误）、`refresh`（refresh token 轮换：校验 → Redis 黑名单 → DB `revoked_at` 双重检查 → 撤销旧 jti + 加黑名单 TTL=剩余有效期 → 签发新 token 对）、`logout`（校验失败静默返回 200 避免泄露 token 状态 → 撤销未撤销的 DB 记录 → 加黑名单），`issue_token_pair` 工具函数持久化 `refresh_tokens` 表记录，5 单元测试覆盖邮箱规范化 / 非法邮箱 / 合法邮箱 / 密码长度 / handler 编译期签名检查。修改 `cloud/src/main.rs`：新增 `mod account;` 声明 + `.merge(account::router())` 装配到主 Router。关键缺陷修复：(1) 上一会话残留的 `password.rs`/`jwt.rs`/`handlers.rs` 文件末尾被截断（分别在 `assert!(hash.len() <= 255, "哈希` / `let _ = (blacklist_refresh_token` / `// 实际端到` 处断开），通过 Read 后 Edit 精准补全闭合括号与函数体；(2) `mod account;` 被 rust-analyzer 自动清理移除导致 `cargo check` 报 `E0433: cannot find module 'account'`，重新 Edit 并立即 `cargo check` 抢在 linter 之前生效；(3) Write 工具报 "File has been modified since read"（rust-analyzer 在 Read 与 Write 之间改写了文件），改用 Read-then-immediate-Edit 策略绕过。验证结果：`cargo check` 0 errors / 3 dead_code warnings（`verify_access_token` 与若干 config/error 字段预留给 P1.3+ 消费）；`cargo test` 31/31 通过（14 P1.1 + 17 P1.2）；docker compose 集成测试 8/8 场景全绿（注册 200 / 重复 409 / 登录 200 / 错误密码 401 / 刷新 200 / 旧 token 复用 401 / 登出 200 / 登出后再刷新 401）；DB 验证 `_sqlx_migrations` 表 4 条记录（含 0004 is_active）+ `users` 表 `is_active` 列与部分索引就位 + 测试用户 `test_131537@example.com` 数据正确 + `identities` 表 email provider 记录 + `refresh_tokens` 表呈现 2 撤销 + 1 登出撤销的轮换模式。Docker 容器 `tavern-postgres` + `tavern-redis` 保持运行供 P1.3/P1.4 复用。下一步进入 P1.3 Google OAuth（ID Token 验证 + identities 表整合）。 |
| 2026-07-18 | 完成 P1.1 云端后端基础设施落地与全链路验证：补齐 `cloud/migrations/` 三条迁移（`0001_users.sql` 含 UUID PK + email UNIQUE + password_hash nullable + email_verified default false + 触发器 `users_set_updated_at`；`0002_identities.sql` 含 Google OAuth identity provider 列 + (provider, provider_user_id) UNIQUE 联合索引 + FK→users ON DELETE CASCADE；`0003_refresh_tokens.sql` 含 token SHA-256 hash 列 + user_id 索引 + expires_at + revoked_at + FK→users ON DELETE CASCADE）。实现 `cloud/src/{config.rs, error.rs, db.rs, redis.rs, state.rs, main.rs, health.rs}` 七模块：`config.rs` 通过 `dotenvy::from_env().ok()` + `ConfigError::Missing`/`Invalid`/`Parse` 三态错误从 14 个环境变量装配 `AppConfig`（含 JWT_EXPIRES_HOURS → Duration 解析、CORS_ALLOWED_ORIGINS → Vec<String> 拆分）；`error.rs` 定义 `AppError` 枚举（Database/Redis/Config/Unauthorized/BadRequest/Internal）+ `IntoResponse` 实现（统一 JSON 错误响应 + 状态码映射）；`db.rs` 封装 `init_pool`（PgPoolOptions 10 连接 5s 超时）+ `run_migrations`（sqlx::migrate! 编译期嵌入）+ `check_health`（`SELECT 1`）；`redis.rs` 封装 `init_manager` + `check_health`（PING）；`state.rs` `AppState { pool, redis, config: Arc }` + `new()` 构造；`main.rs` 装配 shutdown signal（Ctrl+C + SIGTERM）+ 中间件（CorsLayer::very_permissive 演示 / TraceLayer / EnvFilter）+ `/health` + `/health/deep` 路由；`health.rs` 拆分浅深双端点（浅端点始终 200 / 深端点 503 if database 或 redis degraded）。关键缺陷修复：(1) `state.rs` 缺 `impl AppState` 闭合 `}` 导致 cargo 误报 main.rs:111 "unexpected closing delimiter"；(2) redis 0.27 需显式 `connection-manager` feature 才能用 `ConnectionManager`；(3) sqlx 0.8 `migrate!` 宏需同时启用 `macros` + `migrate` 双 feature；(4) `db.rs`/`redis.rs` 单元测试中 async fn 签名不能以 `fn(&str) -> _` 或 HRTB trait bound 表达（impl Future 非 HRTB 兼容），改用 `let _ = (func1, func2)` 元组绑定做编译期符号检查；(5) `config.rs` 4 个 env 相关测试因 cargo test 并行执行 `env::set_var`/`remove_var` 互踩失败，新增 `static ENV_TEST_LOCK: std::sync::Mutex<()>` 串行化所有 env 测试；(6) Docker Hub 拉取 EOF（TUN 代理拦截）→ `daemon.json` 注入 daocloud/dockerproxy/nju 三镜像源；(7) postgres:16-alpine 单 layer 卡死 1.7k 行日志 → 清理残留 docker 进程后重试成功；(8) 主机已有 Redis Windows 服务占用 6379 + 启用 NOAUTH，docker 容器若同样映射 6379 会连到主机 Redis → docker-compose 改 `6380:6379` + `.env`/`.env.example` 同步 `REDIS_URL=redis://localhost:6380`。验证结果：`cargo check` 0 errors / 6 dead_code warnings（P1.2 将消费这些符号）；`cargo test` 14/14 通过；`docker compose up -d postgres redis` 两个容器 healthy；`/health` 返回 `{"status":"ok","service":"mobile-tavern-cloud","version":"0.1.0","timestamp":...}`；`/health/deep` 返回 `{"status":"ok",...,"database":"ok","redis":"ok"}`；PG 中 `_sqlx_migrations` 表 3 条记录 + `users`/`identities`/`refresh_tokens` 三表结构 + 触发器 + FK 约束全部符合预期。下一步进入 P1.2 账号核心（password.rs + jwt.rs + register/login/refresh/logout handlers）。 |
| 2026-07-18 | 落地云端后端骨架与移动端物理隔离基础：新增根 `Cargo.toml` workspace（members = src-tauri / cloud / shared，src-tauri 保持自身 Cargo.toml 不变以最小侵入）。新建 `cloud/` crate（axum 0.7 + tokio + sqlx 0.8 + redis 0.27 + jsonwebtoken + argon2 + reqwest），含 `main.rs`（EnvFilter / dotenvy / CorsLayer / TraceLayer / 优雅停机）与 `health.rs`（`/health` 端点）。新建 `shared/` crate（ts-rs 10 单一来源类型导出：`account.rs` 8 类型 + `api.rs` ApiError/HealthResponse）。Docker 化栈：多阶段 Dockerfile（rust:1.82-slim 构建 + debian:bookworm-slim 运行，非 root 用户，~50MB）+ `docker-compose.yml`（PG16+pgvector / Redis7 / cloud 三服务 + healthcheck 编排）+ `postgres-init/01-extensions.sql`（vector + uuid-ossp）+ `.env.example` 全量配置（DATABASE/REDIS/JWT/Google OAuth/SMTP/CORS）+ `migrations/.gitkeep`。新增 `docs/agents/cloud_strategy.md`（8 节规范：定位 / 物理隔离 / ts-rs / Docker / 数据合规 / 移动端边界 / 开发流程 / 部署）与 AGENTS.md 准则十一（云端后端开发与移动端物理隔离）。`tsconfig.json` 增加 `@cloud-types/*` 路径别名指向 `./shared/bindings/*`；`.gitignore` 增加 `target/` 规则并显式保留 `shared/bindings/` 入 git（前端无 Rust 工具链亦可获取类型）。共 17 个新文件 / 3 个修改文件。未运行 `cargo check` / `docker compose config`（本机缺 Rust 与 Docker 工具链），仅人工语法审查通过。 |
| 2026-07-17 | 补强 Kernel 并发快照防护（防御性，零行为变更）：`publish` / `publishParallel`（Kernel.ts）入口对订阅者列表 `[...subscribers.get(topic)]` 快照，避免 for...of / Promise.allSettled 期间并发 subscribe（push+sort）/ unsubscribe 影响迭代稳定性；`destroy()` 对 `activeControllers` 快照后遍历，避免各 handler finally 块并发 delete 导致 Set 迭代器跳过未访问项。新增 `kernelConcurrency.test.ts` 2 项测试（publish 迭代期间 subscribe 不污染本轮 / destroy 多活跃 controller 全量 abort）。`tsc` + 75/75 测试全绿。 |
| 2026-07-17 | 修复 Kernel bootstrap 部分成功后失败的半初始化状态泄露：`registerServiceBatch`（Kernel.ts）串行循环外包 try/catch，关键服务 / 超时失败时逆序 `destroyService` 已注册项（方案 A）；`KernelLifecycle.initialize()` catch 中调 `kernel.destroy()` 兜底全量清理 services / pipelines / criticalServiceNames（方案 B），化解"destroy() 被 idle 短路跳过"的二级缺陷。新增 `testBootstrapRollbackOnCriticalFailure` 3 场景测试（批量回滚 / 兜底清理 / 二次 initialize 无残留）。`tsc` + 73/73 测试全绿。 |
| 2026-07-17 | **i18n 国际化全面升级**：扩展至 8 语言全量覆盖 731 key（新增韩语 ko、巴西葡萄牙语 pt-BR，以中文为源逐条翻译）。全量清除约 30 组件 300+ 处硬编码中文，消除 `t("nav.settings")==="设置"` 反模式。翻译文件从单体 5,200 行拆分为 8 独立语言文件 + `index.ts` 聚合。新建 `scripts/check-i18n.ts` 键一致性检查脚本（`npm run check:i18n`）。新增 50 个 i18n 单元测试覆盖词典完整性、回退链、插值、编码兼容性。补全遗漏的 `nav.chat`/`nav.playground` 与 24 个 `report.*` key。更新 TECHNICAL.md/README.md 技术文档。`tsc` + 50/50 测试全绿。 |
| 2026-07-17 | 落地多语言国际化框架与中文文案精简首期：新建 `translations.ts` 本地化字典（支持 zh-CN, zh-TW, en, ja, ru, es 6语）及 `LanguageContext.tsx` 上下文。在 App 级包裹 Provider 并实现了系统首航语言自动识别探测、localStorage 状态同步。精简并重构了 `SettingsTab.tsx` 和 `FeaturesSection.tsx`，对开关项和文本描述去除中文冗余内容，并针对俄语/西班牙语长字符溢出进行了 Flex 自动折行防爆布局审计适配。`npm run lint` 及 66/66 单元测试全绿。 |
| 2026-07-17 | 落地字典记忆查询视图（原待办 #1）：在 `localDB.ts` 新建 `deleteDictEntryById(id)` 单条物理删除接口并由 `MemoryStorage` 包装暴露。重构了 `DictTab.tsx` 面板：支持检索词实时模糊匹配（entity/aliases）、实体类型分类 Tag 过滤器（人物/地点/物品等）、表单式手动新增词条、`window.confirm` 单条物理删除以及批量导出 JSON 纯净包下载。`npm run lint` 及 66/66 项测试全绿。未来待办重新编号。 |
| 2026-07-17 | 落地主题包在线编辑器（原待办 #1）：新建了 `ThemeEditorModal.tsx` 主题编辑弹窗，提供基本信息、圆角设置、分组颜色变量双向绑定调节与 customCss 安全过滤编辑。整合实时注入预览逻辑，使改动立刻应用在整站预览中。修改并对接 `ThemeConfigSection.tsx` 添加了“新建主题”和“编辑主题”按钮并健全了状态清理。`npm run lint` 及 66/66 项测试全绿。未来待办重新编号。 |
| 2026-07-17 | 落地主题包导入导出（原 TODO #1）：新建 `src/utils/themePackage.ts` 沙盒实现 `.tavern-theme.json` 包格式 + CSS 变量白名单（23 个标准变量，禁 `--safe-area-*`）+ 多层校验 + 序列化 + `<style>` 标签注入。接入 types/defaults/useSettingsLoader/localDB cloneSettings/AppContext ThemeType 扩展（字面量联合 + `(string & {})`）/ThemeConfigSection UI（导入按钮 + 已导入列表 + 应用/导出/删除三按钮）。isDark 通过 localStorage 传递避免 AppProvider 反向依赖 settings。65/65 测试全通过。TODO #1 更新为"主题包在线编辑器"（可视化调色器 + 实时预览）。 |
| 2026-07-17 | 落地状态记忆查看与编辑层 + 表结构编辑（合并原 #1+#6 列结构部分）：核查发现 `TableMemoryTab.tsx` 早已实现查看/单元格编辑/行级增删/表启停，原 #1 缺口分析系误判；本次补全删除行/重置表/删除表二次确认 + 新建/删除/编辑表结构（表名/描述/列名）+ 列结构变更按列名匹配保留旧数据。同时核查 `PromptService.ts` 确认 LLM 动态读取 sheet 结构注入 Prompt，表结构变更无需改后端。单文件改动，65/65 测试全通过。TODO #6 调整为"状态记忆 Schema 高阶层（字段类型/默认值/模板持久化）"。 |
| 2026-07-17 | 产品方向校准：放弃通用第三方插件生态（移动端合规与范式壁垒），转向"用户可编程底座"模式。新增 9 项待办，按实现难度从低到高排序：状态记忆查看层/编辑层、主题包导入导出、叙事记忆用户控制、字典记忆查询视图、状态记忆 Schema 层、脚本片段管理 UI、规则触发系统、数据派生计算。 |
| 2026-07-16 | 落地全部代办事项：#4 消息分页懒加载、#5 tsconfig 检查范围扩宽至 tests 并修复 11 个测试文件类型错误、#6 纯 TS 工具类 globalKernel 解耦（4 文件改为可选 kernel 参数 + 工厂函数）、#7 历史消息截断与总结归档（200 条阈值自动触发 + lastSummarizedMessageId 折叠渲染）。全部通过 lint 与 61/61 测试。 |
| 2026-07-16 | 落地 TODO-4：消息分页懒加载（`MESSAGES_PAGE_SIZE = 50` + 顶部触发加载更多 + 滚动位置保持）。调整原代办 #3 顺序与编号；新增"历史消息截断与总结归档"作为后续优化方向。 |
| 2026-07-16 | 新增 `as any` 渐进式精确化清理计划（P0-P4 共 5 阶段，534 处）。 |
| 2026-07-16 | 完成 `as any` 全量清理：534 → 69 处（87.1%）。P0 keyManager(11)、P1 useRerollMessage/useSendMessage/LLMService(32)、P2 Kernel/localDB/UpdateCheckService/requestSchema(23)、P3 MessageBubble/useBackupRestore/AsrService/TtsService(22)、P4 测试 mock 31 文件(314) + src 剩余 34 文件(70)。保留 tavernHelperMocks.ts(65) SillyTavern 动态 Mock。lint + 64/64 test 全通过。 |
| 2026-07-20 | 完成本轮内核架构收敛与长会话重发事务修复：`useRerollMessage.ts` 配合同步事务锁及 `indexedDbMemoryStore.ts` 的 `replaceSessionBranch`，在 sessions/messages 跨 Store 原子提交重发分支，失败与 Abort 整体回滚；长期记忆改由领域侧 `MemoryPersistencePort` 注入 IndexedDB 适配器，召回快照按 sessionId 隔离且不写入 `ChatSession`；`PromptService`、`localDB` 继续拆分宏格式化、世界书解析、会话查询和纯净记录映射；全站 `useUnifiedApp` 改为 selector 最小订阅，`KernelContext` 取消隐式全局默认值，未知 Pipeline 强制显式注册；`architectureBoundaries.test.ts` 固化依赖方向、状态污染和文件规模边界。同步更新 `README.md` 与 `TECHNICAL.md`。验证：`npm run lint` 通过，`npm test` 78/78 全绿（Vitest 328/328），`npm run build` 通过，仅保留既有混合导入与大分块警告。 |
| 2026-07-20 | 新增 `docs/agents/architecture_entry.md` 作为短架构工作入口，并在 `AGENTS.md` 顶部建立强制引用；文档按任务给出最小阅读路线、底座边界、关键代码入口及验证/文档维护规则，用于避免每次从超长 `TECHNICAL.md` 恢复上下文。验证：Markdown 链接与 `git diff --check` 通过。 |
| 2026-07-20 | 修复移动端关闭重开后的对话逆序与十轮折叠边界重发双回复：新增 `src/contexts/chatMessageHydration.ts`，将 IndexedDB 最新优先分页在 Context 适配层恢复为时间正序，`ChatContext.tsx` 首次回载与加载更早页统一使用；加固 `indexedDbMemoryStore.ts` 的 `replaceSessionBranch`，按分支起点 `turnIndex` 清除整个旧尾部，并保留消息 ID 作为旧数据兜底，避免孤儿旧回复与新回复并存。测试新增重启十条正序、分页合并、孤儿回复清理及“欢迎词＋十轮对话”完整成功重发覆盖。同步更新 `README.md` 与 `TECHNICAL.md`。验证：重发定向测试 2/2、`npm test` 78/78、Vitest 329/329、`npm run lint`、`npm run build` 全部通过。 |
| 2026-07-20 | 维护短架构工作入口：扩展 `docs/agents/architecture_entry.md`，新增每轮最小阅读包、常见问题定位表、会话分页与回载入口、测试选择矩阵和文档维护规则，明确该文档只记录“怎么找”，实现细节继续归入 `TECHNICAL.md` 或专项规范，降低后续协作恢复上下文的 token 成本。验证：`git diff --check` 通过。 |
