# 通用上下文来源缝（context.source）设计

> 更新日期：2026-10-05。本文是「应用级推送式上下文」的唯一权威设计来源。
> 它只做设计，不改当前代码边界；实施须按本文阶段拆分，并遵守 `CHANGE-SAFE` 与 `ARCH-FLOW`。
> 相关：[插件式 Agent Runtime 路线](agent_plugin_runtime_roadmap.md) §4.2、
> [外部能力通道设计](external_capability_channel_design.md) 的「资源取用路径收敛」。

## 一、为什么需要它

路线图 §4.2 把 `context.source` 定义为「多个 / 并行读取后按预算合并」，典型内容是会话历史、
知识库、长期记忆。但**代码里目前并不存在这个通用缝**：

| 现状 | 位置 | 性质 |
|---|---|---|
| `compat.context-source` | `runtimePlugins/capabilityCatalog.ts` | 兼容插件私有扩展点，由 `CompatibilityRuntimeService` 消费 |
| `recalledMemories` | `useSendMessage` → `assemblePromptEnvelopeUseCase` → `PromptService` → 适配器 | 硬编码单通道参数，只服务记忆召回 |
| `buildPromptCompositionRuntimeData` | `application/services/prompt/PromptCompositionRuntimeAdapter.ts` | 唯一的业务数据 → 命名数据源适配点 |

结果是：每接一种新的"推送式上下文"（知识库、MCP 资源、日历）都只能再改一次 prompt 调用链，
这正是"越改越乱"的来源。本文的目标是把这条链收敛成一处扩展点。

## 二、已确认的既有语义（设计必须对齐，不得推翻）

1. **提示词是每次发送时重算的**。`assembleAuthoritativePromptEnvelope` 在发送与重生成时都会重新组装；
   世界书触发与记忆召回同样重算。`MemoryAuditSnapshot` 是**UI 瞬态审计**，注释明确写着
   "不把运行时结果写入 ChatSession"。

   → 因此本缝**不引入"逐轮冻结上下文内容"**。`CHAT-REPLAY` 的保证对象是消息、工具调用与其结果，
   不是每次重算的提示词输入。若要冻结，属于修改全局重放语义的独立立项，不在本文范围。

2. **数据源是可扩展的命名宏**。`compiler.ts` 的 `renderTemplate` 只解析 `values` 里已存在的键；
   **未注册的宏会原样留在提示词里**并产生 `UNKNOWN_MACRO` 告警。

   → 本缝必须为**每个已声明但本轮无内容的来源写入空字符串**，否则用户的预设里会漏出
   `{{context.xxx}}` 字面量。这是必须写进实现的硬约束。

3. **预算由编译器统一裁决**。`compilePromptComposition(composition, runtime, { tokenBudget, estimateTokens })`
   已负责按 Token 预算丢弃区块，并产出 `PromptCompositionTrace`。

   → 本缝**不实现第二套预算**，只负责给出内容与单来源上限；区块取舍仍由预设与编译器决定。

4. **预设按宏名引用内容**。现有预设引用 `{{memory.recalled}}` 等名字。

   → 来源必须能声明自己的宏名，**不允许强制改名**，否则会破坏所有现存预设。

## 三、缝的形状

### 3.1 契约（领域层）

```ts
// src/domain/contextSources/contracts.ts
export interface ContextSourceRequest {
  readonly sessionId: string;
  readonly userInput: string;
  readonly signal: AbortSignal;
}

export interface ContextSourceDefinition {
  /** 稳定 id：决定宏名默认值与读取顺序。 */
  readonly id: string;
  readonly version: string;
  /**
   * 宏名。新来源一律用 `context.<id>`；既有来源迁移时保留旧宏名（如 `memory.recalled`）。
   * 来源只提供内容，不决定角色、位置与包装文案。
   */
  readonly macroName: string;
  /**
   * 确定性声明：deterministic = 相同输入必得相同输出（重生成可复现）；
   * volatile = 依赖时间/网络/随机，重生成可能不同（必须显式声明，便于诊断）。
   */
  readonly determinism: "deterministic" | "volatile";
  /** 单来源内容上限，防止异常载荷；真正的取舍由编译器预算裁决。 */
  readonly maxCharacters: number;
  /** 读取超时；超时按 failed 处理，不阻塞本轮。 */
  readonly timeoutMs: number;
  read(request: ContextSourceRequest): Promise<string>;
}

export interface ContextContribution {
  readonly sourceId: string;
  readonly macroName: string;
  readonly content: string;
  readonly status: "ok" | "empty" | "failed" | "timeout" | "truncated";
  readonly characters: number;
  readonly detail?: string;
}
```

### 3.2 注册表与读取（应用层）

- 注册必须归属 Scope 并返回 `Dispose`（`RUNTIME-SCOPE`）；重复 id 抛错，不做隐式覆盖。
- `readAll(request)`：**并行**读取，按 id 稳定排序汇总；单来源失败/超时只产出对应 `status`
  与 `detail`，不影响其它来源，也不让本轮发送失败（上下文缺失不等于数据丢失）。
- 汇总后为每个**已注册**来源补齐 `status: "empty"` 的占位贡献，保证宏一定被解析为空字符串。
- 输出：`readonly ContextContribution[]`（含占位），不抛异常。

### 3.3 数据源适配（现有唯一适配点）

`PromptCompositionRuntimeParams` 增加 `contextContributions`，适配器内：

```ts
for (const contribution of params.contextContributions) {
  values[contribution.macroName] = contribution.content;
}
```

迁移期 `memory.recalled`、`worldbook.*` 等既有值的生成逻辑保持不变，确保**输出逐字节不变**。

### 3.4 审计与诊断

现有 `MemoryAuditSnapshot` 的形状（`sources[]`：key/label/included/count/characters/estimatedTokens/dropped）
已经承载"本轮实际用了哪些上下文"，本缝**复用并泛化它**而不是新建一套：

- 审计记录里的 `sources` 由 `ContextContribution[]` 与 `PromptCompositionTrace` 共同产出；
- 失败与超时来源进入 `detail`，在既有记忆抽屉/诊断视图中可见；
- 不写入 `ChatSession`，维持"重算语义"不变。

## 四、明确不做（防止出现第二条路径）

- **不冻结内容**：不新增逐轮上下文快照存储（见 §二.1）。
- **不做位置与角色**：来源不得决定消息顺序、角色或包装文案，那是预设编排的职责。
- **不做第二套预算**：不设全局 Token 预算，只设单来源字符上限。
- **不接 MCP 资源**：MCP 资源的主动取用已收敛为只读工具
  （见 [外部能力通道设计](external_capability_channel_design.md) 的路径收敛表），本缝不承载它。
- **不取代兼容插件**：`compat.context-source` 保持现状，迁移是它的**目标**而非本缝的依赖。

## 五、实施阶段

| 阶段 | 内容 | 完成条件 |
|---|---|---|
| C0 | 契约 + 注册表 + 并行读取/超时/占位/排序 + 单测（**不接线**，对现有提示词完全惰性） | 空注册时提示词输出逐字节不变 |
| C1 | 适配器接受 `contextContributions`；**记忆召回改为第一个来源**（保留 `memory.recalled` 宏名） | 全量回归 + 提示词黄金对比：接线前后输出完全一致 |
| C2 | 审计泛化：`MemoryAuditSnapshot` → 上下文审计（保留现有 UI 入口） | 失败/超时/截断在诊断里可见 |
| C3 | `compat.context-source` 迁移为本缝的 provider，删除并行概念 | 兼容测试全绿，且不再存在第二个上下文档位 |
| C4 | 新来源落地（知识库、日历、M3b 的提示词取用） | 每个新来源只新增一个 provider 文件 |

每阶段都必须先测试后接线；C1 与 C3 属于动提示词权威链的改动，需逐字对比与守卫回归。

**进度（2026-10-05）**：C0 已落地并通过验证——`src/domain/contextSources/contracts.ts`（含 id/宏名/上限/超时校验与
`createContextSourceDefinition`）与 `src/application/contextSources/contextSourceRegistry.ts`（并行读取、按 id 稳定排序、
空占位、单来源截断、超时/失败隔离、调用方取消不抛出），10 个单测覆盖；**未接线**，对现有提示词完全惰性。

C1 拆成两步实施，以避免一次改动过宽：**C1a** 适配器与调用链接纳 `contextContributions`（缺省为空 →
与现状逐字节一致）；**C1b** 把记忆召回迁移为第一个来源（保留 `memory.recalled` 宏名）并以黄金对比守住输出不变。
两步共同构成原 C1 的完成条件，缺一不可。

**C1a 已落地（2026-10-05）**：`PromptCompositionRuntimeParams` → `PromptService.assemblePrompt` →
`IPromptService` → `assemblePromptEnvelopeUseCase` 全链接纳 `contextContributions`，缺省与空数组都逐字段一致。
两条硬化：**不覆盖既有内建数据源**（来源误用 `char`/`memory.recalled` 等宏名无效），以及空占位写入空串
（避免未注册宏把字面量漏进提示词）。顺带把旧路径的召回记忆区块格式化抽成
`src/application/services/prompt/PromptMemorySection.ts`——`PromptService.ts` 因本次接线达到 1001 行，
触发 `QUALITY-TYPES` 的 1000 行硬上限，按职责拆分后为 985 行，也为 C1b/C4 留出余量。

**C1a 接线完成（2026-10-05）**：新增 `KernelServices.ContextSources` 与 `ContextSourceService`（Scope 内持有注册表，
随服务装配失效），发送与重发生成两条链路都通过 `resolveContextContributions` 解析贡献并交给既有
`contextContributions` 形参；**解析失败一律降级为空贡献**——上下文是可选输入，来源自身的问题在注册表内落成
`status`，真正抛出的异常只可能来自装配问题，绝不能让本轮发送失败。

顺带修复一处既有违规：`src/hooks/useChat/useSendMessage.ts` 在本次改动前已是 **1005 行**，超过
`QUALITY-TYPES` 的 1000 行硬上限，而架构守卫的清单漏检了它。本次把本轮记忆召回抽成
`src/hooks/useChat/helpers/recallForTurn.ts`（失败/超时降级为空结果并保留 trace 日志），该文件降到 996 行，
并**把 useSendMessage 加入守卫的千行清单**，避免违规再次静默返回。

## 六、风险与缓解

| 风险 | 缓解 |
|---|---|
| 提示词输出漂移（用户可见行为变化） | C1/C3 用黄金对比断言逐字节一致；不一致即阻断合入 |
| 未注册宏漏字面量 | 注册表补齐空占位（§3.2），并由测试断言 |
| 预算被双重计算 | 只给内容与单来源上限，取舍仍归编译器（§二.3） |
| 非确定性来源让重生成结果变化 | 契约强制声明 `determinism`，`volatile` 在审计中显式标注 |
| 沦为第三种上下文档位 | §四 的"明确不做"+ 本文作为唯一权威来源；`compat` 以迁移为目标 |

## 七、权威入口

- 目标架构与阶段：[agent_plugin_runtime_roadmap.md](agent_plugin_runtime_roadmap.md)
- 外部能力通道（MCP）：[external_capability_channel_design.md](external_capability_channel_design.md)
- 模块边界：[runtime_boundaries.md](runtime_boundaries.md)
- 隔离开发与 TDD：[isolation_development.md](isolation_development.md)
