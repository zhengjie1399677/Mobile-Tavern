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

---

## 🚀 未来待办事项 (Future Action Items)

### 1. 扩宽 `tsconfig.json` 的检查范围 [优先级：中]
* **当前隐患**：`tsconfig.json` 的 `include` 列表中未包含根目录的 `tests/` 文件夹（只包含了 `src` 和 `tests/vitest`）。这导致运行 `npm run lint` (`tsc --noEmit`) 时，**测试代码中的类型错误不会被捕获**，只能靠 IDE 内部提示。
* **优化方向**：将根目录的 `tests` 纳入 TypeScript 静态类型检查的范围，确保在 CI/CD 或本地 commit 拦截时能自动捕获测试用例的类型失效。
* **技术难点**：需要确保 `tests/` 中的 Node 相关 API（如 `process.argv` 等）与前端 Tauri `dom` 编译环境的配置在同一 `tsconfig` 下不冲突；或者在 `tests/` 下建立独立的 `tsconfig.json` 单独做类型校验。

### 3. 解耦纯 TS 工具类的 `globalKernel` 直接依赖 [优先级：低]
* **当前隐患**：为了简便，部分非 React 的纯 TS 工具类（如 `telemetry.ts`、`apiClient.ts`、`catbotEventBus.ts` 和 `bridgeCore.ts`）直接 import 并使用了 `globalKernel` 单例。这在进行微服务级单元测试隔离时，会导致被测试的工具类被迫与全局单例绑定，无法通过 Mock 内核来进行完全解耦测试。
* **优化方向**：对这些纯 TS 工具类的方法签名实施重构，改为接收可选参数 `kernel?: IKernel = globalKernel`。如此一来，既能向后兼容当前的单例调用模式，又能让测试环境在调用时传入隔离的 Mock 实例，实现物理隔离测试。

### 4. 长会话超多消息渲染与性能优化 [优先级：高]
* **当前隐患**：会话加载时直接通过 `getMessagesBySession(activeSessionId)` 一次性获取所有历史消息并渲染。当单会话积累几千条消息时，会导致 IndexedDB 读取延迟明显，前端挂载过多的 DOM 节点导致滑动卡顿，且大模型上下文 Token 消耗过大。
* **优化方向**：
  1. **前端分页/分段懒加载**：利用 `localDB.ts` 已内置的 `limit`、`offset` 及 `descending` 参数，限制首次进入聊天室仅加载最新 50 条消息。用户滚动到顶部时，异步加载并头部追加更多历史消息。
  2. **历史消息截断与总结归档**：当活跃会话消息数超过阈值（如 200 条）时，自动触发 `MemorySummary` 生成故事年表并归档。聊天流中仅渲染活跃段落，历史记录归入“故事年表”抽屉，配合 `MemoryRecall` 检索服务按需唤醒长线记忆，实现 DOM 树减重与 LLM Token 成本缩减。

---

## ✍️ 变更记录

| 日期 | 变动内容 |
|---|---|
| 2026-07-16 | 创建 `TODO.md` 并更新。添加类型修复记录；新增 `tsconfig` 范围扩宽、非 React 纯 TS 类解耦、以及长会话超多消息分页/归档优化等 3 项未来代办。 |
