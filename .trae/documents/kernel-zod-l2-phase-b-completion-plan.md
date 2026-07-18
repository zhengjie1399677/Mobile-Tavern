# Kernel zod L2 — Phase B 完成与验证计划

## 摘要

用户决策"先做2，2验证可行后我们在看情况是否要补全3"：

* **2** = Phase B（zod 引入 + schema 定义，纯加性，零 Kernel 行为变更）

* **3** = Phase C（Kernel.ts 三边界改造 + strictMode 三态升级 + 8 项集成测试，修改运行时行为）

本计划只覆盖 **Phase B 收尾**：创建 `src/kernel/schemas/index.ts` 工具函数 + 新增 schema 单元测试 + 验证编译与全量测试全绿。Phase B 验证通过后，由用户决策是否进入 Phase C。

## Context（为什么做这件事）

完整 L2 实施计划见 [kernel-zod-l2-validation-plan.md](file:///e:/modules/projects/Mobile-Tavern/.trae/documents/kernel-zod-l2-validation-plan.md)。

Phase B 已完成部分：

* `package.json` 添加 `zod: ^3.25.76`（zod v3）

* [src/kernel/types.ts](file:///e:/modules/projects/Mobile-Tavern/src/kernel/types.ts) 删除 `KernelEvents` 死代码枚举 + 补 `IBgmService` 接口（L325-337）

* [src/kernel/services/BgmService.ts](file:///e:/modules/projects/Mobile-Tavern/src/kernel/services/BgmService.ts) 改为 `implements IBgmService`

* [src/kernel/schemas/p0Services.ts](file:///e:/modules/projects/Mobile-Tavern/src/kernel/schemas/p0Services.ts)（134 行）— 5 个 P0 服务完整 schema + `KernelServiceBaseSchema` + P1 服务名清单 + `isP0Service` / `getP0ServiceSchema` 工具

* [src/kernel/schemas/messages.ts](file:///e:/modules/projects/Mobile-Tavern/src/kernel/schemas/messages.ts)（56 行）— `KernelMessageSchema` + 2 个静态 topic schema（`script:destroyed` / `catbot:event`）+ `DYNAMIC_TOPIC_PREFIXES` + `isDynamicTopic` / `getStaticTopicSchema` 工具

Phase B 剩余：**仅** **`src/kernel/schemas/index.ts`** **未建**。

## 当前状态分析

### 已就绪（Phase B 已完成）

* zod v3 依赖已安装

* 5 个 P0 服务 schema 已定义（ChatStream / Script / Database 15 方法 / Memory 5 方法 / LLM 3 方法）

* 消息顶层 schema + 2 静态 topic payload schema + 动态 topic 黑名单

* Bgm 接口缺口已补齐

* KernelEvents 死代码已清理

* tsc 编译通过（基于上次会话验证）

### 缺口（Phase B 待完成）

1. **`src/kernel/schemas/index.ts`** **未建** — Phase C Kernel.ts 改造时需要的统一校验入口
2. **无 schema 单元测试** — 无法证明 schema 设计正确（"验证可行"的硬性证据）
3. **测试注册未更新** — 新测试未纳入 `tests/suites/index.ts` 与 `tests/run_all_tests.ts`

### 风险评估（Phase B 收尾）

| 维度      | 评估                                                                                            |
| ------- | --------------------------------------------------------------------------------------------- |
| 风险等级    | 极低                                                                                            |
| 不可逆性    | 完全可逆（删除新文件即可）                                                                                 |
| 现有功能副作用 | 零 — schema 未接入 Kernel.ts，运行时行为不变                                                              |
| 工时估算    | 1-2 小时                                                                                        |
| 回退方案    | 删除 `src/kernel/schemas/index.ts` + `tests/suites/kernelSchemaValidation.test.ts` + 还原 2 处测试注册 |

## 提议改动

### 改动 1：新建 `src/kernel/schemas/index.ts`（Phase B 收尾核心）

**What**：导出 3 个纯函数校验工具 + `SAFE_PROXY_SYMBOL` 契约标记。

**Why**：

* Phase C Kernel.ts 改造时，`registerService` / `publish` / `getService` 三处需要一个统一校验入口，避免在每个调用点重复 schema 选择逻辑

* `SAFE_PROXY_SYMBOL` 是 Kernel.createSafeProxy（Phase C 实现）与 `validateServiceRetrieval`（Phase B 实现）之间的契约标记，定义在此处让 Phase C 直接 import

* 纯函数设计（不耦合 Kernel 内部状态，不抛错）— 返回 `{success, error?}` result 对象，由 Phase C 的调用方按 `validationMode` 决定 throw / warn / skip

**How**（核心设计）：

```typescript
import { z } from "zod";
import { KernelServiceBaseSchema, getP0ServiceSchema, isP0Service } from "./p0Services";
import { KernelMessageSchema, getStaticTopicSchema, isDynamicTopic } from "./messages";

/** SafeProxy 契约标记：Kernel.createSafeProxy 产出的对象会带此标记 */
export const SAFE_PROXY_SYMBOL = Symbol("kernel.safeProxy");

/** 校验结果：成功不携带数据，失败携带 ZodError 与人类可读摘要 */
export type ValidationResult =
  | { success: true }
  | { success: false; error: z.ZodError; summary: string };

/**
 * 校验服务实例结构（registerService 入口用）
 * - P0 服务：用完整 schema 校验所有声明方法
 * - P1 服务（及未知名）：仅校验 IKernelService 基础结构
 */
export const validateService = (name: string, service: unknown): ValidationResult => { /* ... */ };

/**
 * 校验消息（publish 入口用）
 * - 所有 topic：顶层 IMessage 结构校验
 * - 动态 topic（tavern_helper:*）：跳过 payload 校验
 * - 静态 topic（在 STATIC_TOPIC_SCHEMAS 中）：额外 payload schema 校验
 * - 未登记的静态 topic：仅顶层结构校验通过即可
 */
export const validateMessage = (message: unknown): ValidationResult => { /* ... */ };

/**
 * 校验服务获取（getService 入口用）
 * - SafeProxy（带 SAFE_PROXY_SYMBOL）：直接通过，已知是降级返回
 * - 真实服务：与 validateService 相同的分级校验
 */
export const validateServiceRetrieval = (name: string, service: unknown): ValidationResult => { /* ... */ };
```

**关键设计决策**：

* **返回 result 对象而非抛错**：Phase C 的 `validationMode` 三态（strict / warn / off）需要先拿到校验结果再决定动作，抛错会强制调用方 try/catch

* **`SAFE_PROXY_SYMBOL`** **用** **`in`** **操作符检测**：`service !== null && typeof service === "object" && SAFE_PROXY_SYMBOL in service` — 兼容 Proxy 对象（Symbol 属性不会被 Proxy `get` trap 拦截到不存在路径）

* **未知服务名按 P1 基础结构校验**：保守默认，避免未在 `KernelServices` 枚举中的自定义服务名漏校验

### 改动 2：新建 `tests/suites/kernelSchemaValidation.test.ts`（验证可行性）

**What**：导出 `testKernelSchemaValidation()` 函数，含 10 个 schema 单元断言。

**Why**：

* 用户要求"2 验证可行" — 编译通过只是弱证据，单元测试证明 schema 在真实/伪造数据上行为正确才是强证据

* Phase B 不接入 Kernel.ts，因此测试只直接调用 `validateService` / `validateMessage` / `validateServiceRetrieval`，不实例化 Kernel

* 10 个断言覆盖所有 schema 分支：P0 通过/失败、P1 通过/失败、静态 topic 通过/失败、动态 topic skip、缺顶层字段失败、SafeProxy skip、真实服务通过

**How**（10 个断言清单）：

| #  | 断言                                 | 输入                                                    | 期望                                           |
| -- | ---------------------------------- | ----------------------------------------------------- | -------------------------------------------- |
| 1  | validateService P0 ChatStream 合法   | `{name, init, streamLlmResponse}`                     | `success: true`                              |
| 2  | validateService P0 缺方法             | `{name, init}`（无 streamLlmResponse）                   | `success: false`，error 含 `streamLlmResponse` |
| 3  | validateService P1 合法              | `{name, init}`（Prompt 服务）                             | `success: true`                              |
| 4  | validateService 缺 init             | `{name}`（无 init）                                      | `success: false`，error 含 `init`              |
| 5  | validateMessage 静态 topic 合法        | `{topic: "script:destroyed", payload: {reason: "x"}}` | `success: true`                              |
| 6  | validateMessage 静态 topic payload 错 | `{topic: "script:destroyed", payload: {reason: 123}}` | `success: false`                             |
| 7  | validateMessage 动态 topic skip      | `{topic: "tavern_helper:foo", payload: 任意}`           | `success: true`                              |
| 8  | validateMessage 缺 topic            | `{payload: "x"}`                                      | `success: false`                             |
| 9  | validateServiceRetrieval SafeProxy | `{name, init, [SAFE_PROXY_SYMBOL]: true}`             | `success: true`（skip P0）                     |
| 10 | validateServiceRetrieval 真实 P0     | 合法 ChatStream 服务                                      | `success: true`                              |

**测试模式沿用** [kernelLifecycle.test.ts](file:///e:/modules/projects/Mobile-Tavern/tests/suites/kernelLifecycle.test.ts)：

* `export async function testKernelSchemaValidation()`

* 用 `assert(condition, message)` 断言

* 函数内多个 `// === 用例 N ===` 注释分段

* 结尾 `console.log("✔ ...")`

### 改动 3：注册测试到 `tests/suites/index.ts`

**What**：在 barrel 文件末尾添加：

```typescript
export { testKernelSchemaValidation } from "./kernelSchemaValidation.test";
```

**Why**：`tests/run_all_tests.ts` 通过 barrel 聚合 import，新测试必须先在 barrel 暴露。

### 改动 4：注册测试到 `tests/run_all_tests.ts`

**What**：

1. 在 import 块末尾（L98 前）添加 `testKernelSchemaValidation`
2. 在 tests 数组末尾（L234 `testVitestSuite` 前）添加：

```typescript
{ name: "testKernelSchemaValidation", fn: testKernelSchemaValidation },
```

**Why**：纳入主测试流程，确保 `npm test` 自动执行。

**注释规范**：在数组项前加注释 `// Kernel zod L2 Phase B：schema 单元测试（validateService / validateMessage / validateServiceRetrieval）`

### 改动 5：更新 `TODO.md` 变更记录

**What**：在 `## ✍️ 变更记录` 表格顶部（L217 上方）追加一行：

```
| 2026-07-19 | 完成 Kernel zod L2 Phase B（schema 定义层，纯加性零行为变更）：新建 `src/kernel/schemas/index.ts`（76 行）导出 `validateService` / `validateMessage` / `validateServiceRetrieval` 三纯函数 + `SAFE_PROXY_SYMBOL` 契约标记 + `ValidationResult` result 对象类型；设计为不抛错、不耦合 Kernel 内部状态，由 Phase C 调用方按 validationMode 决定 throw/warn/skip。新增 `tests/suites/kernelSchemaValidation.test.ts`（10 项 schema 单元断言：P0 通过/失败、P1 通过/失败、静态 topic 通过/失败、动态 topic skip、缺顶层字段失败、SafeProxy skip、真实 P0 服务通过），不实例化 Kernel，直接调用 validate* 函数验证 schema 行为正确。注册到 `tests/suites/index.ts` barrel + `tests/run_all_tests.ts` 测试数组。Phase B 全量产物：`p0Services.ts`（5 P0 schema + 基础结构 + P1 清单）、`messages.ts`（KernelMessageSchema + 2 静态 topic + 动态黑名单）、`index.ts`（3 工具函数）。验证：`tsc --noEmit` 0 errors；`npm test` 76/76 全绿（75 旧 + 1 新 testKernelSchemaValidation）。Phase B 风险评估：极低（纯加性，未接入 Kernel.ts，运行时行为零变更）；回退方案：删除 3 个 schema 文件 + 测试文件 + 还原 2 处测试注册。下一步由用户决策是否进入 Phase C（Kernel.ts strictMode 三态升级 + registerService/publish/getService 三边界校验接入 + 8 项集成测试）。 |
```

**Why**：遵循 AGENTS.md 准则"变更记录与文档维护" — 在 TODO.md 底部 `✍️ 变更记录` 表格追加一行，记录核心文件、关键决策、测试结果。

## 假设与决策

| 假设/决策                                    | 依据                                        |
| ---------------------------------------- | ----------------------------------------- |
| `validateService` 等返回 result 对象而非抛错      | Phase C `validationMode` 三态需要先拿结果再决定动作    |
| `SAFE_PROXY_SYMBOL` 定义在 schemas/index.ts | Kernel.ts（Phase C）与 validate 函数共用契约，单一定义点 |
| 未知服务名按 P1 基础结构校验                         | 保守默认，避免自定义服务名漏校验                          |
| 测试文件名 `kernelSchemaValidation.test.ts`   | 与 Phase C 计划一致，Phase C 落地时可在同文件追加集成测试     |
| 10 项断言放进 1 个测试函数                         | 沿用项目测试模式（1 函数 = 1 数组项），断言数无上限             |
| 不在 Phase B 接入 Kernel.ts                  | 用户明确"先做2验证可行再决定3"，Phase C 才动 Kernel.ts    |
| 不在 Phase B 加 strictMode 三态升级             | strictMode 升级是 Phase C 的一部分，会改变现有行为       |

## 验证步骤

1. **TypeScript 编译**：

   ```bash
   npx tsc --noEmit
   ```

   预期：0 errors 0 warnings（含新增 `schemas/index.ts` + 测试文件）

2. **全量测试**：

   ```bash
   npm test
   ```

   预期：76/76 全绿（75 旧 + 1 新 `testKernelSchemaValidation`）

   * 关键观察点：新增测试函数内 10 项断言全过

   * 回归观察点：现有 75 项测试无失败（schema 未接入 Kernel，不应影响现有行为）

3. **手动核查 schema 设计**（在测试通过后）：

   * 确认 `validateService` 对 P0 服务缺方法时返回的 ZodError 包含缺失方法名（便于 Phase C 上报遥测）

   * 确认 `validateServiceRetrieval` 对 SafeProxy 标记对象直接返回 success（不触发 P0 schema 校验）

   * 确认 `validateMessage` 对 `tavern_helper:foo` 直接返回 success（不校验 payload）

4. **Phase B 验收标准**：

   * [ ] `src/kernel/schemas/index.ts` 创建，导出 3 函数 + SAFE\_PROXY\_SYMBOL + ValidationResult 类型

   * [ ] `tests/suites/kernelSchemaValidation.test.ts` 创建，10 项断言全过

   * [ ] `tests/suites/index.ts` 添加 export

   * [ ] `tests/run_all_tests.ts` 添加 import + 数组项

   * [ ] `TODO.md` 变更记录追加 Phase B 完成条目

   * [ ] `tsc --noEmit` 0 errors

   * [ ] `npm test` 76/76 全绿

## Phase C 预告（待用户决策）

Phase B 验证通过后，由用户决定是否进入 Phase C。Phase C 范围（参考 [完整 L2 计划](file:///e:/modules/projects/Mobile-Tavern/.trae/documents/kernel-zod-l2-validation-plan.md#phase-ckernel-改造--测试2-3-天)）：

1. [Kernel.ts:4-35](file:///e:/modules/projects/Mobile-Tavern/src/kernel/Kernel.ts#L4-L35) `strictMode` 升级三态（strict / warn / off），向后兼容现有 `setKernelStrictMode(boolean)`
2. [Kernel.ts:262-317](file:///e:/modules/projects/Mobile-Tavern/src/kernel/Kernel.ts#L262-L317) `registerService` 入口加 `validateService` 校验
3. [Kernel.ts:555-615](file:///e:/modules/projects/Mobile-Tavern/src/kernel/Kernel.ts#L555-L615) `publish` 入口加 `validateMessage` 校验
4. `getService` 入口加 `validateServiceRetrieval` 校验 + SafeProxy 加 `[SAFE_PROXY_SYMBOL]` 标记
5. 新增 8 项集成测试（在 `kernelSchemaValidation.test.ts` 追加，覆盖 Kernel 真实接入后的三态行为）
6. Phase C 风险等级：中（修改 Kernel 运行时行为，可能触发现有 mock 不完整导致的校验失败）；缓解：测试侧 `setKernelStrictMode(false)` 已关闭，新校验默认跟随

## 关键文件清单

| 文件                                                                                                                                   | 操作 | 改动概要                                              |
| ------------------------------------------------------------------------------------------------------------------------------------ | -- | ------------------------------------------------- |
| [src/kernel/schemas/index.ts](file:///e:/modules/projects/Mobile-Tavern/src/kernel/schemas/index.ts)                                 | 新建 | 3 纯函数 + SAFE\_PROXY\_SYMBOL + ValidationResult 类型 |
| [tests/suites/kernelSchemaValidation.test.ts](file:///e:/modules/projects/Mobile-Tavern/tests/suites/kernelSchemaValidation.test.ts) | 新建 | `testKernelSchemaValidation()` 10 项断言             |
| [tests/suites/index.ts](file:///e:/modules/projects/Mobile-Tavern/tests/suites/index.ts)                                             | 改造 | 末尾添加 export                                       |
| [tests/run\_all\_tests.ts](file:///e:/modules/projects/Mobile-Tavern/tests/run_all_tests.ts)                                         | 改造 | import + tests 数组项                                |
| [TODO.md](file:///e:/modules/projects/Mobile-Tavern/TODO.md)                                                                         | 更新 | 变更记录追加 Phase B 完成条目                               |

