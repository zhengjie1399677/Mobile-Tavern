# Mobile-Tavern 架构与代码问题清单

> 本文档基于对项目**整体架构、目录结构、核心模块（内核 / Hook / Context / 数据层）、安全防护、构建配置与依赖**的系统性审查整理而成。
> 审查时已执行 `npx tsc --noEmit` 与 `npm run test`，**两者均 100% 通过**，代码当前处于健康可编译状态。
>
> 文档最后更新：2026-06-23（第二轮全量审查后清理已修复项）
> 对应版本：1.5.7

---

## 📋 问题状态总览

| 编号 | 严重等级 | 问题 | 当前状态 |
|------|----------|------|----------|
| #1 | 🟠 高危 | 系统代码内硬编码行为引导提示词 | 🔵 待修复（部分外部化，已提供 UI 编辑框但代码仍有硬编码默认值） |
| #2 | 🟡 中等 | 内核服务为"薄壳"，业务逻辑仍在 Hook 层 | 🔵 待修复 |
| #3 | 🟢 低危 | scripts 目录已删除一次性调试脚本尚未提交 | 🔵 待提交（本地已物理删除，需执行提交） |
| #4 | 🟡 中等 | `cleanRequestPayload` 过度裁剪 DeepSeek 等兼容平台的 `stream_options` | 🔵 待修复 |
| #5 | 🟡 中等 | 硬编码 OpenRouter 免费试用 API Key 在两处重复 | 🔵 待修复 |
| #6 | 🟢 低危 | localStorage 键名 `"siuser-theme"` 前缀含义不明 | 🔵 待修复 |
| #7 | 🟢 低危 | `useChat` 依赖数组包含冗余 `isSending` 导致回调引用频繁重建 | 🔵 待优化 |
| #8 | 🟢 低危 | `CharacterContext.loadCharacters` 缺少组件卸载保护 | 🔵 待修复 |

---

## 🔵 #1 系统代码内硬编码行为引导提示词

- **严重等级**：🟠 高危
- **当前状态**：🔵 **待修复（部分外部化）**
- **违反准则**：AGENTS.md 核心行为准则二 · 最高指令（纯底层兼容运行底座原则）

### 问题描述
`src/hooks/useChat.tsx` 中存在两处直接违反"严禁在系统代码内硬编码对话前缀 / 剧情引导提示词"的写死内容：

| 行号 | 内容 | 违规点 | 外部化状态 |
|------|------|--------|-----------|
| `L34-40` | `SUGGESTIONS_PROMPT` —— 硬编码英文指令，强制模型输出 4 个建议选项 | 准则二§1：禁止硬编码剧情引导提示词 | ✅ 已提供 UI 编辑框，支持 `settings.replySuggestionsPrompt` 覆盖，但代码中仍保留该 fallback 默认值 |
| `L739` | `"[野牛模式连续输出指令：请继续丰富当前场景...]"` | 准则二§1：硬编码中文行为引导 | ✅ 已支持 `settings.bisonModePrompt` 覆盖，有 Fallback 默认值 |

准则二明确要求此类内容**必须外部化**（角色卡 / 世界书 / 用户预设包），且**必须在 UI 提供开关、可编辑、可删除**。

### 当前进展
- Bison 模式提示词：已外部化到 `UserSettings.bisonModePrompt`，用户可通过设置页修改 ✅
- `SUGGESTIONS_PROMPT`：已支持 `UserSettings.replySuggestionsPrompt` 覆盖，且设置面板中已提供对应编辑框与恢复默认按钮。但系统代码内仍保留硬编码 fallback 默认值 🔵

### 建议修复方案
1. 将 `SUGGESTIONS_PROMPT` 默认值从 `useChat.tsx` 迁移到独立的默认常量文件（如 `src/defaults/suggestionsPrompt.ts`），降低"硬编码在业务逻辑中"的心理暗示。

---

## 🔵 #2 内核服务为"薄壳"，业务逻辑仍在 Hook 层

- **严重等级**：🟡 中等
- **当前状态**：🔵 **待修复**
- **违反准则**：AGENTS.md 核心行为准则一 §6（面向模块化 / 服务化的轻量化开发）

### 问题描述
```
DatabaseService.ts    25 行
LLMService.ts         25 行
PromptService.ts      26 行
ScriptService.ts      59 行
TelemetryService.ts   39 行
TableMemoryService.ts 125 行
AutoSummaryService.ts 206 行
```
七个服务中，仅 `AutoSummaryService` 和 `TableMemoryService` 包含了领域逻辑；其余普遍为简单转发到 `localDB.ts` 或 `apiClient.ts`。真正的业务逻辑（提示词拼装、SSE 解析、采样器应用、Bison 编排）仍活在 `useChat.tsx` / `useSettings.ts` 中。

### 建议修复方案
- 将 `promptBuilder.ts` 的拼装逻辑下沉进 `PromptService`。
- 将 SSE 流读取 + Bison 编排下沉进 `LLMService`（注：#5 拆解后这部分逻辑已独立成 helpers 函数，可进一步下沉）。
- 让 Hook 变薄，服务变厚，向"可抽离为微服务插件"靠拢。

---

## 🔵 #3 scripts 目录已删除一次性调试脚本尚未提交

- **严重等级**：🟢 低危
- **当前状态**：🔵 **待提交**

### 问题描述
`scripts/` 目录曾有 26 个文件，其中大量是一次性调试 / 验证脚本：`test_crc.js`、`test_crc2.js`、`fetch.cjs`、`fetch2.cjs`、`fix.js`、`test_puppeteer.js`、`remove_gemini.js` 等。
目前在本地这些文件已物理删除（`git status` 显示 23 个文件处于删除且未暂存状态），但**删除操作尚未提交**。

### 建议操作
```bash
git add scripts/
git commit -m "chore: 移除一次性调试脚本，清理 scripts 目录"
```

---

## 🔵 #4 `cleanRequestPayload` 过度裁剪 DeepSeek 等兼容平台的 `stream_options`

- **严重等级**：🟡 中等
- **当前状态**：🔵 **待修复**
- **位置**：`src/utils/apiClient.ts:180-184`

### 问题描述
```typescript
const isDirectOpenAI = urlLower.includes("api.openai.com");
if (!isDirectOpenAI) {
    delete cleaned.max_completion_tokens;
    delete cleaned.stream_options;
}
```

当前逻辑仅在 `api.openai.com` 域名下保留 `stream_options: { include_usage: true }` and `max_completion_tokens`。但许多兼容网关**已全面支持**这两个字段：

- **DeepSeek 官方 API**（`api.deepseek.com`）—— 完全支持 `stream_options`
- **阿里云百炼**（`dashscope.aliyuncs.com`）—— 支持
- **硅基流动 SiliconFlow**—— 支持
- **OpenRouter**—— 已在上层被白名单豁免（line 151-152），不受影响

强制裁剪导致这些平台用户无法获取 token usage 统计，遥测中的 `tokenUsage` 始终为 `{ prompt: 0, completion: 0 }`，`reportLlmPerformance` 上报的 `promptTokens` / `completionTokens` 始终为 0。

### 建议修复方案
扩展已知兼容平台白名单：
```typescript
const supportsStreamOptions =
  urlLower.includes("api.openai.com") ||
  urlLower.includes("deepseek.com") ||
  urlLower.includes("dashscope.aliyuncs.com") ||
  urlLower.includes("siliconflow.cn") ||
  // ... 其他已验证兼容的平台
  modelLower.startsWith("deepseek-");
if (!supportsStreamOptions) {
  delete cleaned.stream_options;
  delete cleaned.max_completion_tokens;
}
```

---

## 🔵 #5 硬编码 OpenRouter 免费试用 API Key 在两处重复

- **严重等级**：🟡 中等
- **当前状态**：🔵 **待修复**
- **位置**：
  - `src/hooks/useChat.tsx`（发送消息时的免费试用路径，有两处）
  - `src/kernel/services/AutoSummaryService.ts:91`（自动总结时的免费试用路径）

### 问题描述
同一段 XOR 混淆（`Array.map(c => String.fromCharCode(c ^ 0x5A)).join("")`）的 OpenRouter 免费 Key 出现在两个文件中，形成重复代码。且 XOR 混淆属于"安全靠黑暗"（Security by Obscurity），任何拿到源码的人都能轻易还原。

两处代码结构完全一致（先检查免费次数 → 构造混淆 Key → 设置 baseUrl/model/chatPath），但分别独立维护，修改时容易遗漏。

### 建议修复方案
1. 将免费 Key 提取为统一常量：
   ```typescript
   // src/constants.ts 或 src/utils/apiClient.ts
   export const TRIAL_OPENROUTER_KEY = (() => {
     const encoded = [41,49,119,53,40,119,44,107,119,107,60,111,98,105,107,104,104,60,98,60,59,109,98,98,60,56,57,109,111,99,57,110,63,109,110,111,56,108,111,105,105,60,63,106,60,59,63,104,111,99,110,56,56,108,57,99,99,109,105,109,107,59,108,104,63,109,110,105,105,108,56,110,59];
     return encoded.map(c => String.fromCharCode(c ^ 0x5A)).join("");
   })();
   ```
2. `useChat.tsx` 和 `AutoSummaryService.ts` 均引用此常量。
3. 长远考虑：通过服务端 STS 接口动态下发免费 Key，避免客户端硬编码。

---

## 🔵 #6 localStorage 键名 `"siuser-theme"` 前缀含义不明

- **严重等级**：🟢 低危
- **当前状态**：🔵 **待修复**
- **位置**：`src/contexts/AppContext.tsx:124`

### 问题描述
```typescript
return (localStorage.getItem("siuser-theme") as any) || "ocean";
```

键名前缀 `siuser-` 含义不明，与项目名 "Mobile Tavern" 无关。而代码中其他 localStorage 键使用 `"mobile_tavern_"` 前缀（如 `"mobile_tavern_free_trial_count"`），缺乏统一的命名约定。

### 建议修复
1. 统一全项目 localStorage 键名前缀为 `"mobile_tavern_"`。
2. 老键名需做迁移兼容：读取时先尝试新键名，老键名兜底，写入时使用新键名。

---

## 🔵 #7 `useChat` 依赖数组包含冗余 `isSending` 导致回调引用频繁重建

- **严重等级**：🟢 低危
- **当前状态**：🔵 **待优化**
- **位置**：`src/hooks/useChat.tsx:916-930`（`handleSendMessage` 的 `useCallback` 依赖数组）

### 问题描述
```typescript
const handleSendMessage = useCallback(async (...) => {
  // 内部通过 isSendingRef.current 读取最新值
  if (isSendingRef.current) return;
  // ...
  isSendingRef.current = true;
  setIsSending(true);  // ← 这会导致 isSending 变化
}, [
  isSending,            // ← 被列为依赖项，但实际逻辑不依赖它
  activeCharacter,
  // ... 共 15 项
]);
```

`isSending` 同时作为 `useCallback` 的依赖项和 ref 值存在。当前的 `handleSendMessage` 首次调用时会执行 `setIsSending(true)`，触发 `isSending` 状态变化 → `handleSendMessage` 回调引用重建 → 下游消费方（`chatHookValue`）引用变化 → UI 组件中依赖此回调的 `useMemo`/`useCallback` 全部失效。

虽然不影响功能正确性，但在高频发送场景下会造成不必要的渲染开销。

### 建议修复
从 `handleSendMessage`（及 `handleRerollFromMessage`）的依赖数组中移除 `isSending` 和 `setIsSending`，仅依赖 `isSendingRef`：

```typescript
const setIsSendingRef = useRef(setIsSending);
setIsSendingRef.current = setIsSending;

// 在 useCallback 中通过 setIsSendingRef.current() 设置状态
// 依赖数组不再包含 isSending、setIsSending
```

---

## 🔵 #8 `CharacterContext.loadCharacters` 缺少组件卸载保护

- **严重等级**：🟢 低危
- **当前状态**：🔵 **待修复**
- **位置**：`src/contexts/CharacterContext.tsx:84-86`

### 问题描述
```typescript
useEffect(() => {
    loadCharacters();  // async，无 cleanup / 无 abort
}, []);
```

`loadCharacters` 是 async 函数，内部调用 IndexedDB 读写和 `setCharacters` / `setIsDBReady`。如果 `CharacterProvider` 在操作完成前被卸载（快速热重载、路由切换），React 18+ 会在控制台打印 "Can't perform a React state update on an unmounted component" 警告。

同样的问题也存在于 `ChatContext.tsx:54-56` 的 `loadSessions` 调用。

### 建议修复
使用 `AbortController` 或 `isMounted` flag 模式：
```typescript
useEffect(() => {
    let cancelled = false;
    const load = async () => {
        const stored = await getAllCharacters();
        if (!cancelled) {
            setCharacters(stored);
            setIsDBReady(true);
        }
    };
    load().catch(console.error);
    return () => { cancelled = true; };
}, []);
```

---

## 📌 修复优先级建议

| 优先级 | 问题 | 状态 | 工作量 |
|--------|------|------|--------|
| P1 高 | #1 硬编码提示词外部化 | 🔵 待修复（部分） | 中 |
| P1 高 | #4 `cleanRequestPayload` 平台白名单扩展 | 🔵 待修复 | 小 |
| P2 中 | #5 免费 Key 去重 | 🔵 待修复 | 极小 |
| P3 低 | #2 服务层下沉业务逻辑 | 🔵 待修复 | 大 |
| P3 低 | #3 scripts 删除提交 | 🔵 待提交 | 极小 |
| P4 低 | #6 localStorage 键名统一 | 🔵 待修复 | 小 |
| P4 低 | #7 deps 数组瘦身 | 🔵 待优化 | 小 |
| P4 低 | #8 卸载保护 | 🔵 待修复 | 极小 |
