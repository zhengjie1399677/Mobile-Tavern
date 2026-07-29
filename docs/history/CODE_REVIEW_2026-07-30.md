# 代码审查清单 - 2026-07-30

> 本文件记录 2026-07-30 代码审查中发现的有争议问题，待后续评估处理。
> 无争议的问题已在本次审查中直接修复。

## 1. MainLayout.tsx - ICON_MAP 根 any 类型

**位置**：[src/components/MainLayout.tsx:9](file:///e:/modules/projects/Mobile-Tavern/src/components/MainLayout.tsx#L9) 与 `:162`

**现状**：
```typescript
const ICON_MAP: Record<string, React.ComponentType<any>> = { ... };
// ...
const IconComp = ((tab.meta?.icon && ICON_MAP[tab.meta.icon as keyof typeof ICON_MAP]) || HelpCircle) as React.ComponentType<any>;
```

**争议点**：
- `ICON_MAP` 的值类型为 `React.ComponentType<any>`，根 `any` 来自此处
- 第 162 行的 `as React.ComponentType<any>` 断言是为了规避 strictNullChecks 的类型推断问题
- 修复需要改 `ICON_MAP` 定义为 `React.ComponentType<Record<string, never>>` 或具体 props 类型，并更新所有使用点
- 影响面较大，暂保留

**建议方案**：
- 短期：将 `React.ComponentType<any>` 改为 `React.FC`（无 props 的组件类型）
- 长期：为每个 icon 组件定义具体的 props 类型

---

## 2. LLMService.ts - TRIAL_KEY_SENTINEL 重复定义

**位置**：[src/kernel/services/LLMService.ts:10-11](file:///e:/modules/projects/Mobile-Tavern/src/kernel/services/LLMService.ts#L10-L11) 与 [src/utils/apiClient.ts](file:///e:/modules/projects/Mobile-Tavern/src/utils/apiClient.ts)

**现状**：
```typescript
// LLMService.ts
/** Trial key 占位符哨兵值，须与 apiClient.ts 的 TRIAL_OPENROUTER_KEY 保持一致 */
const TRIAL_KEY_SENTINEL = "TRIAL_KEY_PLACEHOLDER";

// apiClient.ts
export const TRIAL_OPENROUTER_KEY = "TRIAL_KEY_PLACEHOLDER";
```

**争议点**：
- 为规避 ESM 循环依赖（`apiClient → LLMService → apiClient`），在 `LLMService.ts` 中定义了本地常量
- 字符串 `"TRIAL_KEY_PLACEHOLDER"` 重复定义，若一处修改另一处未同步，会导致 trial key 检测失效
- 注释已标注同步要求，但人工维护有风险

**建议方案**：
- 将 `TRIAL_OPENROUTER_KEY` 移到独立的常量文件（如 `src/utils/constants.ts`），`apiClient.ts` 和 `LLMService.ts` 都从该文件导入
- 或用 Rust 侧注入 sentinel 值，前端通过 invoke 获取

---

## 3. community/config.ts - as const 与 import.meta.env.DEV 类型语义

**位置**：[src/domain/community/config.ts:9-13](file:///e:/modules/projects/Mobile-Tavern/src/domain/community/config.ts#L9-L13)

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

---

## 4. keyManager.ts - 硬编码 key 字符串仍存在于源码

**位置**：[src/utils/keyManager.ts:26](file:///e:/modules/projects/Mobile-Tavern/src/utils/keyManager.ts#L26)

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

---

## 5. usePresetBundles.ts - importedRegexScripts: any[] 残留

**位置**：[src/hooks/settings/usePresetBundles.ts:230](file:///e:/modules/projects/Mobile-Tavern/src/hooks/settings/usePresetBundles.ts#L230)

**现状**：
```typescript
const importedRegexScripts: any[] = [];
```

**争议点**：
- 这是原有代码，非本次修改引入
- 但 AGENTS.md 准则十二要求"每次触及含 any 的文件时，应顺手清理本文件可触及的字段"
- 需要定义 `RegexScript` 类型或复用现有类型

**建议方案**：
- 定义 `RegexScript` 接口（`scriptName`, `findRegex`, `replaceString`, `disabled`, `placement`, `runOnEdit`, `markdownOnly`, `promptOnly`）
- 将 `any[]` 改为 `RegexScript[]`

---

## 6. QuickDialogueOptions.tsx - setSessions 回调中的 any

**位置**：[src/tabs/chat/QuickDialogueOptions.tsx:441-442](file:///e:/modules/projects/Mobile-Tavern/src/tabs/chat/QuickDialogueOptions.tsx#L441-L442)

**现状**：
```typescript
setSessions((prev: any) =>
  prev.map((s: any) => (s.id === updated.id ? updated : s)),
);
```

**争议点**：
- `setSessions` 来自 `useUnifiedApp()`，类型应为 `React.Dispatch<React.SetStateAction<ChatSession[]>>`
- `(prev: any)` 和 `(s: any)` 是原有代码，非本次修改引入
- 修复需要确认 `setSessions` 的实际类型，可能涉及 UnifiedAppContext 类型

**建议方案**：
- 如果 `setSessions` 类型正确，直接去掉 `any`：`setSessions((prev) => prev.map((s) => ...))`
- 如果 `setSessions` 类型不正确，需修复 UnifiedAppContext 中的类型定义
