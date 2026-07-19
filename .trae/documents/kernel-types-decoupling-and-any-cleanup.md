# Kernel 类型契约解耦与 E 类 any 清理计划

## Context（背景）

`src/kernel/types.ts` 当前在 [L1](file:///e:/modules/projects/Mobile-Tavern/src/kernel/types.ts#L1) 反向依赖上层业务类型 `ChatSession` / `UserSettings`（来自 `src/types.ts`），用于两个用途：

1. **`OutputPipelineContext`**（L58-L74）：本质是业务管道上下文，被 [outputMiddlewares.ts](file:///e:/modules/projects/Mobile-Tavern/src/kernel/middlewares/outputMiddlewares.ts)、[streamHelpers.ts](file:///e:/modules/projects/Mobile-Tavern/src/hooks/useChat/helpers/streamHelpers.ts)、[pipelineHelpers.ts](file:///e:/modules/projects/Mobile-Tavern/src/hooks/useChat/pipelineHelpers.ts) 共同消费。该中间件文件本身已反向依赖 `../../hooks/useChat/helpers`（`calculateBisonModeProbability`），证明它本质就是业务中间件，住在 `kernel/middlewares/` 是历史错位。
2. **`ISettingsService`**（L418-L421）：服务接口契约直接绑定具体业务类型 `UserSettings`，与 [IDatabaseService](file:///e:/modules/projects/Mobile-Tavern/src/kernel/types.ts#L177) / [IPromptService](file:///e:/modules/projects/Mobile-Tavern/src/kernel/types.ts#L240) 的泛型范式（`<TSession=any>` / `<TLorebook=any>`）不一致。

同时盘点 `kernel/types.ts` 中 45 处 `any`，识别出 9 处 **E 类非必要 any**（可被具体类型替换）+ 遗漏的 3 处 `outputMiddlewares.ts` 内的 `kernel.getService<any>(...)`。

**目标**：C 方案彻底消除 kernel 对 `../types` 的反向依赖（L1 import 完全删除），并清理 E 类非必要 any，统一接口契约风格。

---

## 一、文件改动总览

| # | 文件 | 操作 | 改动要点 |
|---|---|---|---|
| 1 | `src/services/pipeline/types.ts` | **新建** | 承接 `OutputPipelineContext` 定义 |
| 2 | `src/services/pipeline/outputMiddlewares.ts` | **git mv** 自 `src/kernel/middlewares/outputMiddlewares.ts` | 改 import 路径；清理 `getService<any>` |
| 3 | `src/services/pipeline/index.ts` | **新建** | barrel 重导出 |
| 4 | `src/kernel/types.ts` | 改 | 删 L1 import 与 OutputPipelineContext；泛型化 ISettingsService / IMemoryService；清理 E 类 any |
| 5 | `src/kernel/services/SettingsService.ts` | 改 | `implements ISettingsService<UserSettings>` |
| 6 | `src/kernel/services/memory/MemoryService.ts` | 改 | `implements IMemoryService<5 个子模块类型>` |
| 7 | `src/kernel/services/memory/index.ts` | 改 | 新增类型别名 `MemoryServiceTyped` 导出 |
| 8 | `src/kernel/bootstrap/registerDefaultPipelines.ts` | 改 | import 路径改 `../../services/pipeline` |
| 9 | `src/hooks/useChat/helpers/streamHelpers.ts` | 改 | OutputPipelineContext 改从 `services/pipeline` import |
| 10 | `src/hooks/useChat/pipelineHelpers.ts` | 改 | 拆分 import；OutputPipelineContext 改从 `services/pipeline` |
| 11 | `src/hooks/settings/useSettingsLoader.ts` | 改 | `getService<ISettingsService<UserSettings>>` |
| 12 | `src/hooks/settings/useBackupRestore.ts` | 改 | 同上 + `getService<MemoryServiceTyped>` |
| 13 | `src/hooks/settings/useSettingsPersistence.ts` | 改 | 同上 |
| 14 | `src/contexts/ChatContext.tsx` | 改 | `getService<MemoryServiceTyped>` |
| 15 | `src/components/memory-drawer/DictTab.tsx` | 改 | `getService<MemoryServiceTyped>` |
| 16 | `src/hooks/useChat.tsx` | 改 | `getService<MemoryServiceTyped>` |

---

## 二、详细执行步骤

### Step 1：新建 `src/services/pipeline/` 目录与文件

#### 1.1 新建 `src/services/pipeline/types.ts`

```ts
import type { ChatSession, UserSettings } from "../../types";
import type { IKernel } from "../../kernel/types";

/**
 * 业务输出管道上下文。
 *
 * 设计说明：此类型本质属于业务管道层（消费方为 outputMiddlewares、
 * streamHelpers、pipelineHelpers），不应下沉到 kernel/types.ts。
 * 上移到 src/services/pipeline/types.ts 后，kernel 仅保留
 * IPipeline<T> 泛型契约，不再反向依赖上层业务实体类型。
 */
export interface OutputPipelineContext {
  kernel?: IKernel;
  session: ChatSession;
  responseText: string;
  reasoningText: string;
  settings: UserSettings;
  activeCharacter: any;
  controller: AbortController;
  isStillActive: boolean;
  isBisonConsecutive: boolean;
  bisonRemainingCount: number;

  // Outputs from middlewares
  resultSession?: ChatSession;
  shouldTriggerBison?: boolean;
  nextBisonRemainingCount?: number;
}
```

#### 1.2 git mv 上移 `outputMiddlewares.ts`

```bash
git mv src/kernel/middlewares/outputMiddlewares.ts src/services/pipeline/outputMiddlewares.ts
```

然后改 import：

- L1：`import { Middleware, OutputPipelineContext, KernelServices } from "../types";`
  → `import { Middleware, KernelServices } from "../../kernel/types";`
  → 新增 `import type { OutputPipelineContext } from "./types";`
- L2：`import { calculateBisonModeProbability } from "../../hooks/useChat/helpers";`
  → 路径层级 +1：`import { calculateBisonModeProbability } from "../../hooks/useChat/helpers";`（实际层级未变，因 `services/pipeline/` 与 `kernel/middlewares/` 距离 `hooks/` 同样是两层）
- L3：`import { Message } from "../../types";`（路径不变）

清理 outputMiddlewares 内 3 处 `getService<any>`：

- L58：`kernel.getService<any>(KernelServices.Memory)`
  → `kernel.getService<IMemoryService>(KernelServices.Memory)`（保留默认 any 泛型；后续 step 6 在调用方收紧）
- L145：`kernel.getService<any>(KernelServices.Script)`
  → `kernel.getService<IScriptService>(KernelServices.Script)`
- L211：同 L58

注：`IScriptService` 与 `IMemoryService` 都从 `../../kernel/types` import。

#### 1.3 新建 `src/services/pipeline/index.ts`

```ts
export * from "./types";
export {
  tableMemoryMiddleware,
  mvuScriptMiddleware,
  bisonModeMiddleware,
  autoSummaryMiddleware,
} from "./outputMiddlewares";
```

#### 1.4 删除空目录 `src/kernel/middlewares/`

如该目录仅含 `outputMiddlewares.ts` 一个文件，git mv 后删除空目录。

---

### Step 2：修改 `src/kernel/types.ts`

#### 2.1 删除 L1 反向依赖

```ts
// 删除整行
import { ChatSession, UserSettings } from "../types";
```

#### 2.2 删除 L58-L74 `OutputPipelineContext`（已上移到 services/pipeline/types.ts）

#### 2.3 修改 `ISettingsService`（L418-L421）泛型化

```ts
export interface ISettingsService<TSettings = any> extends IKernelService {
  getStoredSettings(): Promise<TSettings | null>;
  saveStoredSettings(settings: TSettings): Promise<void>;
}
```

#### 2.4 修改 `IMemoryService`（L343-L369）泛型化

```ts
export interface IMemoryService<
  TStorage = any,
  TExtractor = any,
  TRecall = any,
  TStateTable = any,
  TSummary = any
> extends IKernelService {
  getStorage(): TStorage;
  getExtractor(): TExtractor;
  getRecall(): TRecall;
  getStateTable(): TStateTable;
  getSummary(): TSummary;
}
```

#### 2.5 清理 E 类 any

| 位置 | 现状 | 改为 |
|---|---|---|
| L236 | `clientContext?: any` | `clientContext?: unknown` |
| L257-L262 | `getTriggeredLorebookEntries(messages: any[], userInput: string, entries: any[], maxRecursionDepth?: number): any[]` | 改为 `TLorebook[]` 入参/返回（IPromptService 已有 `<TLorebook = any>` 泛型，L240 处声明） |
| L395 | `onError: (err: any) => void` | `onError: (err: unknown) => void` |

具体改法（[L257-L262](file:///e:/modules/projects/Mobile-Tavern/src/kernel/types.ts#L257-L262)）：

```ts
getTriggeredLorebookEntries(
  messages: any[],
  userInput: string,
  entries: TLorebook[],
  maxRecursionDepth?: number
): TLorebook[];
```

`messages: any[]` 保留 — 因为 messages 历史结构高度动态且与 TSession 解耦，强类型化代价过大。

---

### Step 3：修改 `src/kernel/services/SettingsService.ts`

```ts
// L1 import 增加 ISettingsService
import { IKernelService, IKernel, ISettingsService } from "../types";
import { UserSettings } from "../../types";

// L24
export class SettingsService implements ISettingsService<UserSettings> {
  // ... 方法签名不变（已经是 UserSettings）
}
```

---

### Step 4：修改 `src/kernel/services/memory/MemoryService.ts`

```ts
// L16
export class MemoryService implements IMemoryService<
  MemoryStorage,
  MemoryExtractor,
  MemoryRecall,
  MemoryStateTable,
  MemorySummary
> {
  // ...
}
```

注：`MemoryStorage` / `MemoryExtractor` / `MemoryRecall` / `MemoryStateTable` / `MemorySummary` 已在 [L10-L14](file:///e:/modules/projects/Mobile-Tavern/src/kernel/services/memory/MemoryService.ts#L10-L14) import。

---

### Step 5：在 `src/kernel/services/memory/index.ts` 新增类型别名

```ts
import type { MemoryStorage } from "./MemoryStorage";
import type { MemoryExtractor } from "./MemoryExtractor";
import type { MemoryRecall } from "./MemoryRecall";
import type { MemoryStateTable } from "./MemoryStateTable";
import type { MemorySummary } from "./MemorySummary";
import type { IMemoryService } from "../../types";

/** 已绑定具体子模块类型的 MemoryService 契约别名，供消费方使用避免重复书写 5 个泛型参数 */
export type MemoryServiceTyped = IMemoryService<
  MemoryStorage,
  MemoryExtractor,
  MemoryRecall,
  MemoryStateTable,
  MemorySummary
>;
```

（实际写法以现有 index.ts 风格对齐，可能用 `export type`）

---

### Step 6：修改 `src/kernel/bootstrap/registerDefaultPipelines.ts`

```ts
// L2-L7
import type { IKernel } from "../types";
import {
  tableMemoryMiddleware,
  mvuScriptMiddleware,
  bisonModeMiddleware,
  autoSummaryMiddleware,
} from "../../services/pipeline";  // ← 改路径
```

---

### Step 7：修改两个 hooks/useChat 消费点

#### 7.1 `src/hooks/useChat/helpers/streamHelpers.ts` L10

```ts
// 旧
import { OutputPipelineContext } from "../../../kernel/types";
// 新
import type { OutputPipelineContext } from "../../../services/pipeline";
```

#### 7.2 `src/hooks/useChat/pipelineHelpers.ts` L11

```ts
// 旧
import { OutputPipelineContext, IDatabaseService, KernelServices } from "../../kernel/types";
// 新（拆分）
import { IDatabaseService, KernelServices } from "../../kernel/types";
import type { OutputPipelineContext } from "../../services/pipeline";
```

---

### Step 8：修改 3 个 ISettingsService 消费点

| 文件:行 | 改动 |
|---|---|
| [useSettingsLoader.ts:42](file:///e:/modules/projects/Mobile-Tavern/src/hooks/settings/useSettingsLoader.ts#L42) | `getService<ISettingsService>` → `getService<ISettingsService<UserSettings>>` |
| [useBackupRestore.ts:77](file:///e:/modules/projects/Mobile-Tavern/src/hooks/settings/useBackupRestore.ts#L77) | 同上 |
| [useSettingsPersistence.ts:51](file:///e:/modules/projects/Mobile-Tavern/src/hooks/settings/useSettingsPersistence.ts#L51) | 同上 |

每文件需新增 `import type { ISettingsService } from "../../kernel/types";`（若尚未 import）和 `import type { UserSettings } from "../../types";`（若尚未 import）。

---

### Step 9：修改 4 个 IMemoryService 消费点

| 文件:行 | 改动 |
|---|---|
| [DictTab.tsx:36](file:///e:/modules/projects/Mobile-Tavern/src/components/memory-drawer/DictTab.tsx#L36) | `getService<IMemoryService>` → `getService<MemoryServiceTyped>` |
| [ChatContext.tsx:56](file:///e:/modules/projects/Mobile-Tavern/src/contexts/ChatContext.tsx#L56) | 同上 |
| [useBackupRestore.ts:81](file:///e:/modules/projects/Mobile-Tavern/src/hooks/settings/useBackupRestore.ts#L81) | 同上 |
| [useChat.tsx:61](file:///e:/modules/projects/Mobile-Tavern/src/hooks/useChat.tsx#L61) | 同上 |

每文件 `import { IMemoryService } from ".../kernel/types"` → `import type { MemoryServiceTyped } from ".../kernel/services/memory"`（路径按层级调整）。

---

### Step 10：验证

```bash
# 类型检查 0 错误
npx tsc --noEmit

# 跑全量测试套件
npm test
```

预期：
- tsc 0 错误（关键验证：outputMiddlewares 上移后所有 import 路径正确，IMemoryService 泛型实参匹配实现类）
- npm test 全绿（应有 76 个测试用例，与本任务无直接相关的 i18n/abort/memory 子套件全部通过）

### Step 11：更新文档

在 [TODO.md](file:///e:/modules/projects/Mobile-Tavern/TODO.md) 底部 `✍️ 变更记录` 表格追加一行：

```
| 2026-07-20 | Kernel 类型契约解耦：OutputPipelineContext 上移到 src/services/pipeline/，ISettingsService/IMemoryService 泛型化，清理 E 类 any 12 处 |
```

---

## 三、风险评估与回退方案

### 风险点

1. **传递依赖**：outputMiddlewares 上移后路径层级变化，可能触发未识别的下游 import 错误。
   - 缓解：tsc --noEmit 即时捕获全部类型路径错误。
2. **IMemoryService 泛型实参顺序错配**：5 个泛型参数顺序必须与 MemoryService implements 一致。
   - 缓解：通过 MemoryService.ts 实现签名反向校验。
3. **MemoryServiceTyped 别名暴露**：放在 `services/memory/index.ts` 会让消费方 import 路径加深。
   - 接受：相比类型膨胀，别名集中维护更优。
4. **TLorebook 泛型化 IPromptService.getTriggeredLorebookEntries**：调用方若裸用 `IPromptService`（默认 TLorebook=any），行为不变；若显式 `IPromptService<any, any, any, LorebookEntry>`，则获得类型检查。
   - 接受：渐进收紧，不强制所有调用方一次性升级。

### 不可逆性

- 文件位置变更通过 `git mv` 保留历史可追溯。
- 接口签名变更通过泛型 default any 保持向后兼容，旧调用方代码不需要立即修改即可编译通过。

### 回退方案

若 tsc 出现无法快速修复的错误：
1. 单次 `git checkout -- .` 回滚所有改动（计划阶段未提交）。
2. 或保留 `src/kernel/middlewares/outputMiddlewares.ts` 作为 re-export shim：`export * from "../../services/pipeline/outputMiddlewares";`，分两次提交完成迁移。

---

## 四、不在本次范围

以下问题识别但**不在本次任务**处理：

- `outputMiddlewares.ts` 反向依赖 `../../hooks/useChat/helpers`（`calculateBisonModeProbability`）：上移到 `services/pipeline/` 后此依赖仍在，但已诚实反映业务中间件位置。
- `kernel/types.ts` 内剩余 B/C/D 类 any（约 36 处）：属合理设计，不在清理范围。
- `IKernel.registerPipeline<T = any>`、`getPipeline<T = any>`：IPipeline 已是泛型，default any 是合理 API 设计。
- 测试套件对接口变更的覆盖：现有测试主要测实现行为而非类型签名，无需新增测试。

---

## 五、执行顺序建议（最小化中间破坏态）

1. **先建新结构**（Step 1.1, 1.3）：新建 `services/pipeline/types.ts` 与 `index.ts`，但暂不移动 outputMiddlewares。
2. **改 kernel/types.ts**（Step 2）：删除 OutputPipelineContext 与 L1 import，泛型化接口。
3. **改实现类**（Step 3, 4, 5）：SettingsService、MemoryService implements 泛型化。
4. **改消费点**（Step 6, 7, 8, 9）：所有 import 路径与 getService 泛型参数同步更新。
5. **最后 git mv outputMiddlewares**（Step 1.2）：此时所有消费点已切换 import 来源，移动文件后只需调整 outputMiddlewares 内部的 3 个 import 即可。
6. **验证**（Step 10）：tsc + test。
7. **更新 TODO.md**（Step 11）。

此顺序确保任何中间 commit 都不会处于"outputMiddlewares 路径已变但消费点未跟上"的破损态。
