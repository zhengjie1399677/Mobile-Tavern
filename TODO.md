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

---

## 🚀 未来待办事项 (Future Action Items)

> 当前无高优先级待办。以下为低优先级优化方向，可按需实施。

### 1. 测试 Mock 数据类型进一步完善 [优先级：低]
* **当前状态**：部分测试文件中的 mock 数据使用了 `as any` 或 `as any[]` 绕过严格类型检查。
* **优化方向**：未来可逐步补全 mock 数据的完整属性（如 `MemoryDictEntry` 的 `id`、`sessionId`、`firstSeenMsgId` 等），将 `as any` 降级为精确类型，提升测试代码的类型安全性。

---

## ✍️ 变更记录

| 日期 | 变动内容 |
|---|---|
| 2026-07-16 | 落地全部代办事项：#4 消息分页懒加载、#5 tsconfig 检查范围扩宽至 tests 并修复 11 个测试文件类型错误、#6 纯 TS 工具类 globalKernel 解耦（4 文件改为可选 kernel 参数 + 工厂函数）、#7 历史消息截断与总结归档（200 条阈值自动触发 + lastSummarizedMessageId 折叠渲染）。全部通过 lint 与 61/61 测试。 |
| 2026-07-16 | 落地 TODO-4：消息分页懒加载（`MESSAGES_PAGE_SIZE = 50` + 顶部触发加载更多 + 滚动位置保持）。调整原代办 #3 顺序与编号；新增"历史消息截断与总结归档"作为后续优化方向。 |
| 2026-07-16 | 创建 `TODO.md` 并更新。添加类型修复记录；新增 `tsconfig` 范围扩宽、非 React 纯 TS 类解耦、以及长会话超多消息分页/归档优化等 3 项未来代办。 |
