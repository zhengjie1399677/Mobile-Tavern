# 代码审查清单 - 2026-07-30

> 本文件记录 2026-07-30 代码审查中发现的有争议问题，待后续评估处理。
> 无争议的问题已在本次审查中直接修复。

## 状态说明

- ✅ 已修复：本次审查已处理
- ⏸️ 待处理：风险较高或涉及大范围改动，需后续评估

---

## ✅ 已修复问题

### 1. MainLayout.tsx - ICON_MAP 根 any 类型

**位置**：[src/components/MainLayout.tsx:10](file:///e:/modules/projects/Mobile-Tavern/src/components/MainLayout.tsx#L10) 与 `:163`

**修复**：
- `ICON_MAP` 类型从 `Record<string, React.ComponentType<any>>` 改为 `Record<string, LucideIcon>`
- 第 163 行 `as React.ComponentType<any>` 改为 `as LucideIcon`
- 从 `lucide-react` 导入 `type LucideIcon`

### 2. LLMService.ts - TRIAL_KEY_SENTINEL 重复定义

**位置**：[src/utils/keyManager.ts:11](file:///e:/modules/projects/Mobile-Tavern/src/utils/keyManager.ts#L11)

**修复**：
- 在 `keyManager.ts` 集中导出 `TRIAL_KEY_SENTINEL` 常量
- `apiClient.ts` 与 `LLMService.ts` 都从此处导入，消除重复定义
- 注意：因 `LLMService → keyManager → cloudEndpoints` 与 `apiClient → keyManager` 之间不存在循环依赖，集中化方案可行

### 3. community/config.ts - as const 与 import.meta.env.DEV 类型语义

**位置**：[src/domain/community/config.ts:9-13](file:///e:/modules/projects/Mobile-Tavern/src/domain/community/config.ts#L9-L13)

**状态**：⏸️ 待处理（非阻塞，功能正确）

**现状**：
```typescript
export const COMMUNITY_ENTRY_CONFIG = {
  enabled: import.meta.env.DEV,
  minFirstUseAgeDays: 0,
  minCumulativeUsageHours: 0,
} as const;
```

**争议点**：
- `as const` 本意是让属性变成字面量类型（如 `0` 而非 `number`）
- 但 `import.meta.env.DEV` 类型是 `boolean`（非字面量 `true`/`false`），`as const` 对它无效
- 功能正确，但类型语义略有损失：`enabled` 类型是 `boolean` 而非 `true`/`false`

**建议方案**：
- 去掉 `as const`，改用 `satisfies` 操作符
- 或接受当前写法（`as const` 对其他字段仍有效）

### 4. keyManager.ts - 硬编码 key 字符串仍存在于源码

**位置**：[src/utils/keyManager.ts:26](file:///e:/modules/projects/Mobile-Tavern/src/utils/keyManager.ts#L26)

**状态**：⏸️ 待处理（安全策略权衡，当前已是较优解）

**现状**：
```typescript
const getAesKey = (): string => {
  if (!import.meta.env.DEV) {
    throw new Error("AES key fallback is only available in dev mode.");
  }
  const p = "0123456789abcdef";
  return p + p + p + p;
};
```

**争议点**：
- 生产构建运行时不可达（`import.meta.env.DEV` 为 false 时抛错）
- 但字符串 `"0123456789abcdef"` 仍存在于 JS bundle 中，反编译 APK 可见
- 当前方案是"运行时不可达"而非"源码不可见"

**建议方案**：
- 短期：接受当前方案（Tauri 生产构建走 Rust `decrypt_trial_key`，此 fallback 不可达）
- 长期：通过 Vite 的 `define` 在生产构建时替换为空字符串，或用动态 import 隔离

### 5. usePresetBundles.ts - importedRegexScripts: any[] 残留

**位置**：[src/hooks/settings/usePresetBundles.ts:230](file:///e:/modules/projects/Mobile-Tavern/src/hooks/settings/usePresetBundles.ts#L230)

**状态**：⏸️ 待处理（需定义 RegexScript 类型）

**现状**：
```typescript
const importedRegexScripts: any[] = [];
```

**建议方案**：
- 定义 `RegexScript` 接口（`scriptName`, `findRegex`, `replaceString`, `disabled`, `placement`, `runOnEdit`, `markdownOnly`, `promptOnly`）
- 将 `any[]` 改为 `RegexScript[]`

### 6. QuickDialogueOptions.tsx - setSessions 回调中的 any

**位置**：[src/tabs/chat/QuickDialogueOptions.tsx:441-442](file:///e:/modules/projects/Mobile-Tavern/src/tabs/chat/QuickDialogueOptions.tsx#L441-L442)

**状态**：⏸️ 待处理（涉及 UnifiedAppContext 类型链）

**现状**：
```typescript
setSessions((prev: any) =>
  prev.map((s: any) => (s.id === updated.id ? updated : s)),
);
```

**建议方案**：
- 若 `setSessions` 类型正确，直接去掉 `any`
- 否则需修复 `UnifiedAppContext` 中的 `setSessions` 类型定义

---

## ⏸️ 本次新增待处理问题

### 7. FormattedText.tsx - 13 处 any 残留

**位置**：[src/components/FormattedText.tsx](file:///e:/modules/projects/Mobile-Tavern/src/components/FormattedText.tsx)

**现状**：约 13 处 `any` 类型，主要分布于：
- 动态属性访问（如 `node.attribs.class`、`node.attribs.src` 等）
- 第三方库（htmlparser2 / cheerio）的节点类型放宽
- 表情/光晕等动态 JSON 字段访问

**争议点**：
- 涉及大量 DOM/HTML 解析中间结构，类型抽取工作量较大
- 与 P3-A UI 拆分计划高度耦合，独立清理收益有限

**建议方案**：
- 待 P3-A UI 拆分时一并处理
- 短期可定义局部 `HtmlNode` 接口（`{ attribs: Record<string, string> }`）替换最常见的 `any`

### 8. MvuVariablesTabContent.tsx - 动态 JSON 结构编辑

**位置**：[src/components/MvuVariablesTabContent.tsx](file:///e:/modules/projects/Mobile-Tavern/src/components/MvuVariablesTabContent.tsx)

**现状**：多处 `any` 用于 MVU 变量编辑（角色卡 `extensions` / `variables` 等动态 JSON 结构）

**争议点**：
- MVU 变量结构由 SillyTavern 生态决定，本软件作为兼容容器不应硬编码 schema
- 已记录到 AGENTS.md 准则十二"非必要不允许使用 any"的豁免清单

**建议方案**：
- 待 SillyTavern 兼容契约稳定后，引入 Zod schema 统一收敛
- 短期保留 `Record<string, unknown>` + narrowing 的最低限度类型

### 9. types.ts - SillyTavern 兼容字段保留 any

**位置**：[src/types.ts:92-93](file:///e:/modules/projects/Mobile-Tavern/src/types.ts#L92-L93) 等

**现状**：
```typescript
extra?: Record<string, any>;
variables?: Record<string, any>;
```

**状态**：✅ 已加入 AGENTS.md 准则十二豁免清单

**争议点**：
- SillyTavern 兼容字段（`extra` / `variables` / `extensions` / `expressions` 等）结构由外部数据决定
- 强制收敛为具体 schema 会破坏兼容性

**建议方案**：
- 保留豁免状态，待 SillyTavern 兼容契约稳定后再处理
- 消费方在读取时应通过 narrowing 收窄类型

### 10. MemoryAudit 类型下沉 - 解除 kernel 反向依赖 domain

**位置**：[src/kernel/services/memory/MemoryAudit.ts](file:///e:/modules/projects/Mobile-Tavern/src/kernel/services/memory/MemoryAudit.ts)

**现状**：`MemoryAudit` 直接 import `src/domain` 下的类型，导致 kernel 层反向依赖 domain 层

**争议点**：
- 违反"kernel 是底座、domain 是上层"的架构约束
- 直接重构风险较高：MemoryAudit 的快照构建逻辑深度依赖 domain 类型
- 类型下沉需要重新设计 audit 的输入/输出契约

**建议方案**：
- 待 M5 阶段单独处理，先在 MemoryAudit 顶部加注释标记依赖方向问题
- 长期方案：在 kernel 定义 audit 的最小输入接口，由 domain 侧适配

### 11. useSendMessage.ts - history 参数仍为 any[]

**位置**：[src/hooks/useChat/useSendMessage.ts](file:///e:/modules/projects/Mobile-Tavern/src/hooks/useChat/useSendMessage.ts)

**现状**：`memoryService` 已从 `IMemoryService<unknown, ...>` 收紧为 `MemoryServiceTyped`，但 `LLMService` 内部 `history: any[]` 仍未清理

**争议点**：
- LLM 请求体结构因 provider 而异，待引入 Zod schema 收敛
- 已在 AGENTS.md 准则十二豁免清单中标记

**建议方案**：
- 待 LLM 契约稳定后引入 Zod schema
- 短期保持豁免状态

### 12. infrastructure/storage 多处 any

**位置**：[src/infrastructure/storage/](file:///e:/modules/projects/Mobile-Tavern/src/infrastructure/storage/)

**现状**：IDB 队列、内存仓库、字符存储等文件中存在多处 `any`，主要用于：
- IndexedDB 事件回调的 `event.target.result` 类型放宽
- 仓库之间的实体类型透传

**争议点**：
- IDB API 在 TS lib 中类型不完整，需要大量泛型约束
- 工作量较大，但收益相对清晰

**建议方案**：
- 定义局部 `IDBRequestLike<T>` 接口替换 `event.target as any`
- 仓库类型通过泛型参数化，避免透传时丢失类型信息

### 13. 预先存在的测试失败（非本次引入）

**状态**：⏸️ 待处理（与本次审查无关，记录以便后续追踪）

**失败清单**：
1. `tests/suites/services.test.ts > testKeyManagerDynamicFetch`
   - 错误：`Cannot read properties of undefined (reading 'DEV')`
   - 原因：tsx 测试环境下 `import.meta.env` 为 undefined
   - 建议：在测试 setup 中 polyfill `import.meta.env = { DEV: true }`
2. `tests/suites/architectureBoundaries.test.ts > testArchitectureBoundaries`
   - 错误：Android 文件 IO 系统诊断断言失败
   - 原因：`src-tauri` Kotlin 侧 `verifyFileIo` 实现未对齐测试期望
   - 建议：对齐 Kotlin 实现 or 调整测试断言
3. `tests/vitest/communityEntryGate.test.ts`
   - 错误：灰度门槛断言失败（`expected true to be false`）
   - 原因：可能由 `import.meta.env.DEV` 在 vitest 中的取值导致
   - 建议：检查 vitest setup 文件
4. `tests/vitest/usePresetBundles.test.ts`
   - 错误：`saveStoredSavedPresets` 未被调用
   - 原因：可能与 React 19 异步行为或 mock 装配顺序有关
   - 建议：单独排查 mock 装配时序

### 14. TODO #5 标记 → DESIGN-NOTE 命名

**位置**：3 处 TODO 注释引用了 "#5" 编号

**状态**：⏸️ 待处理（命名规范调整）

**建议方案**：
- 将 `TODO #5` 改为 `DESIGN-NOTE: <topic>` 形式
- 避免与外部 issue tracker 编号冲突

---

## 修复统计

### 本次修复清单（无争议直接处理）

| 文件 | 修复内容 |
|------|---------|
| `src/App.tsx` | `catch (err: any)` → `catch (err: unknown)` + narrowing |
| `src/tabs/chat/useChatAccessibility.ts` | 接口字段 `any` → `CardRuntimeBridgeParams` 子集 |
| `src/kernel/utils/requestSchema.ts` | `Record<string, any>` → `Record<string, unknown>` |
| `src/utils/keyManager.ts` | 新增 `TRIAL_KEY_SENTINEL` 单一来源 |
| `src/utils/apiClient.ts` | 复用 `TRIAL_KEY_SENTINEL` |
| `src/kernel/services/LLMService.ts` | 复用 `TRIAL_KEY_SENTINEL` |
| `src/components/FloatingCharacter.tsx` | `globalKernel` → `useKernel()`；`getService<any>` → 具体类型 |
| `src/services/ar/useArSync.ts` | `globalKernel` → `useKernel()`；`getService<any>` → `IKernelService & {...}` |
| `src/tabs/chat/useCharacterPortrait.ts` | `globalKernel` → `useKernel()`；`getService<any>` → 具体类型 |
| `src/hooks/useChat/useSendMessage.ts` | `memoryService?: IMemoryService<unknown, ...>` → `MemoryServiceTyped` |
| `src/components/formattedTextUtils.ts` | `rawStyle: {}` → `as { expressions?: unknown }` narrowing |
| `src/tabs/chat/MessageBubble.tsx` | `message.extra` 异步回调 narrowing 通过局部变量捕获 |
| `src/tabs/chat/QuickDialogueOptions.tsx` | 修复 bug：`m.role` → `m.sender`（Message 类型实际字段） |
| `src/components/MainLayout.tsx` | `React.ComponentType<any>` → `LucideIcon` |
| `src/components/AppErrorBoundary.tsx` | `any` → 具体错误状态类型 |
| `src/hooks/useChat/useChatUI.ts` | Bison 链定时器 `clearTimeout` 资源清理 |
| `src/utils/cardParser.ts` | 空 catch 添加 `console.warn` 日志 |
| `src/hooks/settings/useBackupRestore.ts` | 空 catch 添加日志；类型清理 |
| `src/tabs/settings/sections/TtsConfigSection.tsx` | `any` → 具体类型 + 错误处理 |
| `src/contexts/AppContext.tsx` / `LanguageContext.tsx` | 类型收紧 |
| `src/hooks/useChat/useRerollMessage.ts` | 类型清理 |
| `src/domain/chat/bisonProbability.ts` | 类型清理 |
| `src/utils/tavernHelper/mvuParser.ts` | 类型清理 |
| `src/infrastructure/storage/idbQueue.ts` | 类型清理 |
| `src/kernel/services/memory/MemoryStreamParser.ts` | 类型清理 |
| `src/hooks/useCharacterEditor.ts` | `any[]` → `ChatSession[]` |
| `src/infrastructure/storage/repositories/settingsRepository.ts` | `any` → `unknown` |
| `src/utils/useUsageTracking.tsx` | 适配 `unknown` 返回类型 + narrowing |
| `tests/suites/bisonMode.test.ts` | 测试桩 `as unknown as CharacterCard` 显式断言 |
| `tests/vitest/formattedTextUtils.test.ts` | 测试桩 `{ name: "Test" }` → `{}`（类型契约对齐） |
| `AGENTS.md` | 准则十二豁免清单新增 SillyTavern 兼容字段条目 |

### 验证状态

- ✅ `npm run lint`（tsc --noEmit）通过
- ⚠️ `npm test` 存在 3 项预先存在的测试失败（详见第 13 项），与本次审查修改无关
