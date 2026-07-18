# Kernel zod 运行时校验 L2 实施计划

## Context（为什么做这件事）

当前 Mobile-Tavern 微内核架构存在两个运行时类型安全盲点：
1. `IMessage.payload: any`（[types.ts:90-94](file:///e:/modules/projects/Mobile-Tavern/src/kernel/types.ts#L90-L94)）— publish/subscribe 消息无运行时校验
2. 17 个 `IXxxService` 接口契约只靠 TS 编译期类型检查，运行时不校验

Plan agent 调研揭示的**真实痛点（修正初始假设）**：
- `as any` 实际只 2 处（不是 69）— 493 处 `: any` 中 74 处是 SillyTavern 沙箱必需
- **真正的 unsafe 点是 `getService<T>()`**（如 `getService<any>("database")` 遍布代码）— 原方案完全没覆盖
- publish 静态 topic 只有 2 个（`catbot:event` + `script:destroyed`），加 schema ROI 低
- `tavern_helper:${event}` 是动态 topic，由用户脚本决定，schema 无解
- KernelEvents 枚举 3 个事件从未被 publish 调用（死代码）
- 项目已有 `zodMock.ts`（511 行）SillyTavern 沙箱伪 zod — 必须明确边界
- Kernel 已有 `strictMode` 机制（[Kernel.ts:4-35](file:///e:/modules/projects/Mobile-Tavern/src/kernel/Kernel.ts#L4-L35)），需复用而非新增开关

**目标**：引入 zod v3 + getService/registerService/publish 三边界校验 + P0 服务完整 schema，补齐运行时类型安全，可逆（strictMode 三态可控）。

## 用户决策（已确认）

| 决策点 | 选择 | 理由 |
|---|---|---|
| 校验库 | zod v3 | 50KB gzip 在 Tauri 移动端可接受；API 与现有 zodMock.ts 一致 |
| 探测阶段 | 先做（1-2 天） | Plan agent 首要建议；避免 schema 设计失焦 |
| getService 校验 | 纳入 L2 | 覆盖最大 unsafe 盲点（Plan agent 指出） |
| P0 分级标准 | 按"数据流入边界" | ChatStream/Script 是 LLM 不可信输出第一道关，比 Prompt/Settings 关键 |

## 实施阶段（5-8 天）

### Phase A：探测阶段（1-2 天）

**目标**：在不动 zod 的前提下，用临时探针收集真实 (topic, payload, service methods) 数据，修正 schema 设计前提。

**改动点**：
- [Kernel.ts](file:///e:/modules/projects/Mobile-Tavern/src/kernel/Kernel.ts) 的 `registerService` / `publish` / `getService` 加 `console.debug` 临时探针（dev only，prod 自动关）
- 探针输出：topic 字符串 + payload 顶层 keys + typeof + service 实例暴露的方法集合
- 探针对比 `types.ts` 中 17 个 `IXxxService` 接口，找出"接口声明但实现未实现"或"实现暴露但接口未声明"的方法

**验证流程**：
1. `npm run test` 全量跑一遍，收集测试中的 publish/service 调用
2. 手动 smoke：发一条消息（触发 ChatStream + LLM）、切换会话、加载角色卡、触发一次 MVU 脚本
3. 输出探测报告（`docs/agents/zod-l2-probe-report.md`），包含：
   - 实际观察到的 (topic, payload shape) 对
   - 17 个服务的"接口 vs 实现"方法差异表
   - P0 服务最终确定（基于真实数据，可能调整）
4. 清理探针代码（探测阶段产出报告后，探针代码不留）

**回退**：探测阶段不引入依赖，不改变行为，可独立提交。如果探测发现"现状已经够好"，可以直接终止 L2。

---

### Phase B：zod 引入 + schema 定义（2-3 天）

**目标**：引入 zod v3，定义 P0 服务完整 schema + P1 服务基础结构 schema。

**B.1 依赖引入**
- `package.json` 添加 `zod: ^3.23.x`（dev + prod 依赖）
- 注意：zodMock.ts 是 SillyTavern 沙箱内用的伪 zod，**不替换**；真 zod 仅用于 Kernel 内部校验

**B.2 清理死代码与缺口**
- 删除 `KernelEvents` 枚举中 3 个未使用的事件（[types.ts:23-27](file:///e:/modules/projects/Mobile-Tavern/src/kernel/types.ts#L23-L27)）— 给死代码加 schema 没意义
- 补 `IBgmService` 接口（Bgm 在 KernelServices 枚举里但 types.ts 无对应接口）— 或确认 Bgm 直接 implement `IKernelService` 即可

**B.3 schema 文件结构（单文件，不碎片化）**

新建 `src/kernel/schemas/p0Services.ts`（单文件，不拆目录）：

```typescript
import { z } from "zod";

// IKernelService 基础结构 schema（所有服务必须满足）
export const KernelServiceBaseSchema = z.object({
  name: z.string(),
  isCritical: z.boolean().optional(),
  dependencies: z.array(z.string()).optional(),
  optionalDependencies: z.array(z.string()).optional(),
  init: z.function(),
  destroy: z.function().optional(),
});

// P0 服务完整 schema（5 个，按数据流入边界）
export const ChatStreamServiceSchema = KernelServiceBaseSchema.extend({
  streamLlmResponse: z.function(),
  // ... 其他方法
});

export const ScriptServiceSchema = KernelServiceBaseSchema.extend({
  parseMvuMessage: z.function(),
  // ...
});

export const DatabaseServiceSchema = KernelServiceBaseSchema.extend({
  getAllSessions: z.function(),
  appendSessionMessage: z.function(),
  // ... IDatabaseService 12 方法
});

export const MemoryServiceSchema = KernelServiceBaseSchema.extend({ /* ... */ });
export const LLMServiceSchema = KernelServiceBaseSchema.extend({ /* ... */ });

// P0 服务名 → schema 映射
export const P0_SERVICE_SCHEMAS = {
  [KernelServices.ChatStream]: ChatStreamServiceSchema,
  [KernelServices.Script]: ScriptServiceSchema,
  [KernelServices.Database]: DatabaseServiceSchema,
  [KernelServices.Memory]: MemoryServiceSchema,
  [KernelServices.LLM]: LLMServiceSchema,
} as const;

// P1 服务（其余 12 个）仅校验基础结构
export const P1_SERVICE_NAMES = [
  KernelServices.Prompt, KernelServices.Settings, KernelServices.Preset,
  KernelServices.Character, KernelServices.Worldbook, KernelServices.Telemetry,
  KernelServices.UpdateCheck, KernelServices.ImageGen, KernelServices.Tts,
  KernelServices.Asr, KernelServices.Bgm, KernelServices.MultiMessage,
];
```

新建 `src/kernel/schemas/messages.ts`：

```typescript
import { z } from "zod";

// 顶层 IMessage 结构校验（所有 topic 都校验）
export const KernelMessageSchema = z.object({
  topic: z.string().min(1),
  payload: z.unknown(),  // payload 类型由 topic schema 决定
  metadata: z.record(z.unknown()).optional(),
});

// 静态 topic → payload schema（仅 2 个，ROI 低的明确不做）
export const STATIC_TOPIC_SCHEMAS = {
  "catbot:event": z.object({ /* 探测后填充 */ }),
  "script:destroyed": z.object({ reason: z.string() }),
} as const;

// 动态 topic 前缀黑名单（显式 skip，符合 SillyTavern 兼容契约）
export const DYNAMIC_TOPIC_PREFIXES = ["tavern_helper:"] as const;
```

新建 `src/kernel/schemas/index.ts`：导出工具函数 `validateService` / `validateMessage` / `validateServiceRetrieval`。

---

### Phase C：Kernel 改造 + 测试（2-3 天）

**C.1 复用 strictMode（升级三态，向后兼容）**

[Kernel.ts:4-35](file:///e:/modules/projects/Mobile-Tavern/src/kernel/Kernel.ts#L4-L35) 改造：
```typescript
let validationMode: "strict" | "warn" | "off" = "strict"; // 默认 strict
const isDev = () => import.meta.env?.DEV ?? false;

export const setKernelValidationMode = (mode: "strict" | "warn" | "off") => {
  validationMode = mode;
};

// 向后兼容：现有 setKernelStrictMode(false) 调用映射到 off
export const setKernelStrictMode = (val: boolean) => {
  validationMode = val ? "strict" : "off";
};

// 实际生效判定：dev + strict 才抛错；warn 仅 console.warn；off 跳过
const shouldThrow = () => validationMode === "strict" && isDev();
const shouldWarn = () => validationMode === "warn" && isDev();
```

测试侧 [tests/run_all_tests.ts:141](file:///e:/modules/projects/Mobile-Tavern/tests/run_all_tests.ts#L141) 同步：`setKernelStrictMode(false)` 已有关闭，新校验自动跟随。

**C.2 registerService 加 schema 校验**

[Kernel.ts:262-317](file:///e:/modules/projects/Mobile-Tavern/src/kernel/Kernel.ts#L262-L317) `registerService` 入口加校验：
- **结构校验（init 前）**：所有服务用 `KernelServiceBaseSchema` 校验 name/init/destroy 字段存在
- **方法存在性校验（init 前）**：P0 服务用 `P0_SERVICE_SCHEMAS[name]` 校验所有方法字段是 function
- 失败处理：
  - `shouldThrow()` → 抛错阻塞 registerService
  - `shouldWarn()` → console.warn + 继续
  - 否则 → 跳过

**C.3 publish 加 payload schema 校验**

[Kernel.ts:555-615](file:///e:/modules/projects/Mobile-Tavern/src/kernel/Kernel.ts#L555-L615) `publish` 入口加校验：
- 所有 topic 用 `KernelMessageSchema` 校验顶层结构
- 静态 topic 用 `STATIC_TOPIC_SCHEMAS[topic]` 校验 payload
- `DYNAMIC_TOPIC_PREFIXES` 命中（如 `tavern_helper:`）显式 skip payload 校验
- 未在 `STATIC_TOPIC_SCHEMAS` 中的静态 topic → 仅顶层结构校验，payload 宽松

**C.4 getService<T> 加 lazy 结构校验（最大盲点）**

`Kernel.ts` `getService` 返回前加校验：
- 关键设计：**SafeProxy 也要通过校验**。SafeProxy 是 Kernel.ts 对"非关键服务缺失"的降级返回，它假装有方法（每个方法返回 no-op）。SafeProxy 必须能通过 `KernelServiceBaseSchema`（name/init 是 function），但 P0 schema 校验会失败（缺真实方法）。
- 方案：
  - SafeProxy 实例加 `[SAFE_PROXY_SYMBOL]` 标记
  - getService 校验时：若标记存在 → 跳过 P0 schema（已知是降级）
  - 若不存在 → P0 服务走 `P0_SERVICE_SCHEMAS` 校验，P1 走基础结构校验
- 失败处理：warn（不抛错，避免运行时崩溃），同时通过 `reportZodValidationError` 上报遥测（复用现有通道 [telemetry.ts:76](file:///e:/modules/projects/Mobile-Tavern/src/utils/telemetry.ts#L76)）

**C.5 新增测试**

新建 `tests/suites/kernelSchemaValidation.test.ts`，导出 `testKernelSchemaValidation()`：
- 用例 1：registerService 时 P0 服务满足 schema → 通过
- 用例 2：registerService 时 P0 服务缺方法 → strict 抛错 / warn 警告
- 用例 3：publish 静态 topic payload 合规 → 通过
- 用例 4：publish 静态 topic payload 不合规 → strict 抛错 / warn 警告
- 用例 5：publish 动态 topic `tavern_helper:foo` → skip payload 校验
- 用例 6：getService 返回真实服务 → 通过 P0 schema
- 用例 7：getService 返回 SafeProxy → skip P0 schema（通过 SAFE_PROXY_SYMBOL）
- 用例 8：setKernelValidationMode 三态切换生效

注册到：
- `tests/suites/index.ts`
- `tests/run_all_tests.ts` 数组

测试侧默认 `setKernelStrictMode(false)`（已存在），新测试函数内显式 `setKernelValidationMode("strict")` 测试自己，结束后还原。

---

## Critical Files（要改动的文件）

| 文件 | 改动类型 | 改动概要 |
|---|---|---|
| [package.json](file:///e:/modules/projects/Mobile-Tavern/package.json) | 新增依赖 | 添加 `zod: ^3.23.x` |
| [src/kernel/Kernel.ts](file:///e:/modules/projects/Mobile-Tavern/src/kernel/Kernel.ts) | 改造 | strictMode 升级三态；registerService/publish/getService 加校验；SafeProxy 加标记 |
| [src/kernel/types.ts](file:///e:/modules/projects/Mobile-Tavern/src/kernel/types.ts) | 清理 | 删除 KernelEvents 死代码；补 IBgmService 接口（或确认 Bgm 直接 implement 基础接口） |
| `src/kernel/schemas/p0Services.ts` | 新建 | 5 个 P0 服务完整 schema + 基础结构 schema + P1 服务名清单 |
| `src/kernel/schemas/messages.ts` | 新建 | IMessage 顶层 schema + 静态 topic payload schema + 动态 topic 黑名单 |
| `src/kernel/schemas/index.ts` | 新建 | 导出 validateService / validateMessage / validateServiceRetrieval 工具函数 |
| `tests/suites/kernelSchemaValidation.test.ts` | 新建 | 8 个测试用例 |
| [tests/suites/index.ts](file:///e:/modules/projects/Mobile-Tavern/tests/suites/index.ts) | 改造 | 注册新测试 |
| [tests/run_all_tests.ts](file:///e:/modules/projects/Mobile-Tavern/tests/run_all_tests.ts) | 改造 | 添加 testKernelSchemaValidation 到测试数组 |
| [TODO.md](file:///e:/modules/projects/Mobile-Tavern/TODO.md) | 更新 | 变更记录追加 L2 完成条目 |

## 复用的现有基础设施

- [src/utils/telemetry.ts:76](file:///e:/modules/projects/Mobile-Tavern/src/utils/telemetry.ts#L76) `reportZodValidationError` — 校验失败上报通道（已暴露到 window，复用而非另建）
- [src/kernel/Kernel.ts:4-35](file:///e:/modules/projects/Mobile-Tavern/src/kernel/Kernel.ts#L4-L35) `strictMode` 机制 — 升级为三态，向后兼容
- [tests/suites/kernelLifecycle.test.ts](file:///e:/modules/projects/Mobile-Tavern/tests/suites/kernelLifecycle.test.ts) 测试模式 — mock IKernelService 对象，新测试沿用
- [src/utils/tavernHelper/zodMock.ts](file:///e:/modules/projects/Mobile-Tavern/src/utils/tavernHelper/zodMock.ts) — **不替换**，仅 SillyTavern 沙箱用；真 zod 仅 Kernel 内部用

## 风险与回退

| 风险 | 缓解 |
|---|---|
| 75/75 测试因 mock 不完整炸 | 测试侧 `setKernelStrictMode(false)` 已关闭，新校验自动跟随；新测试函数内显式开 strict 测自己 |
| SafeProxy 无法通过 P0 schema | SAFE_PROXY_SYMBOL 标记 + getService 显式 skip |
| 动态 topic `tavern_helper:*` 无解 | DYNAMIC_TOPIC_PREFIXES 黑名单显式 skip，符合 SillyTavern 兼容契约（AGENTS.md 准则二） |
| schema 维护双改负担 | P0 仅 5 个服务完整 schema；P1 仅基础结构；接口变更时 schema 同步是约定 |
| zod 体积 50KB | Tauri App 总包几 MB，50KB 可接受；prod 构建 tree-shake 可减小 |
| 严格模式抛错阻塞 App 启动 | 默认 `validationMode = "strict" && isDev()`，prod 自动 off；用户可运行时 `setKernelValidationMode("off")` 全关 |

**回退路径**：
- 运行时：`setKernelValidationMode("off")` 立即关闭所有校验
- 构建期：通过 `import.meta.env.DEV` 在 prod 构建中 dead-code eliminate 校验代码
- 极端情况：删除 `src/kernel/schemas/` 目录 + 还原 Kernel.ts 三处校验调用即可完全回退

## 验证（Verification）

1. **TypeScript 编译**：`npx tsc --noEmit` 0 errors 0 warnings
2. **单元测试**：`npm test` 75/75 + 新增 8 个 = 83/83 全绿
3. **探测阶段验证**（Phase A 产出）：
   - 探测报告中的 (topic, payload) 对比假设，差异列明
   - 17 个服务的"接口 vs 实现"差异表
4. **手动 smoke**（Phase C 完成后）：
   - 启动 App，17 个服务正常初始化（warn 模式下无 warn 输出）
   - 发一条消息触发 ChatStream + LLM，无 schema 校验失败
   - 加载一个角色卡，Database/Memory 服务无校验失败
   - 触发一次 MVU 脚本，tavern_helper:* topic 不触发 payload 校验
5. **生产构建验证**：`npm run build` 后 prod 包 zod 体积 < 60KB gzipped

## 验收标准

- [ ] Phase A 探测报告产出，P0 服务最终确认
- [ ] Phase B zod 引入，5 个 P0 schema 定义完成
- [ ] Phase C Kernel 三边界（registerService / publish / getService）校验上线
- [ ] 83/83 测试全绿（75 旧 + 8 新）
- [ ] 手动 smoke 无 schema 校验失败
- [ ] TODO.md 变更记录追加 L2 完成条目
- [ ] （可选）讨论是否补 L3（外部边界：LLM 返回 / Tauri invoke / cloud API）

## 工时估算

| 阶段 | 工时 | 累计 |
|---|---|---|
| Phase A 探测 | 1-2 天 | 1-2 天 |
| Phase B zod + schema | 2-3 天 | 3-5 天 |
| Phase C Kernel 改造 + 测试 | 2-3 天 | 5-8 天 |
| **总计** | **5-8 天** | — |
