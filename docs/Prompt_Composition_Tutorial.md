# 🧩 Mobile Tavern 自由 Prompt 编排规范与技术说明书

> 📌 **行为规范与架构声明**：本说明书归档于 Mobile Tavern 项目文档库。重构或扩展编译器逻辑必须遵守 [AGENTS.md](../AGENTS.md) 核心准则。
> *文档版本：v1.7.2 | 对应领域模块：src/domain/prompt-composition*

本文档为 Mobile Tavern 自由 Prompt 编排系统 (Prompt Composition) 的官方技术说明书，详尽规定了领域模型结构、字段属性契约、历史深度注入算法、Token 预算裁剪优先级以及数据源宏解析机制。

---

## 目录

- [1. 系统架构与领域模型](#1-系统架构与领域模型)
- [2. 全字段属性契约与选项说明](#2-全字段属性契约与选项说明)
  - [2.1 基础属性 (Basic Attributes)](#21-基础属性-basic-attributes)
  - [2.2 数据源与历史范围 (Source & History Selection)](#22-数据源与历史范围-source--history-selection)
  - [2.3 位置与深度注入 (Placement & Depth Injection)](#23-位置与深度注入-placement--depth-injection)
  - [2.4 运行条件过滤 (Conditioning)](#24-运行条件过滤-conditioning)
  - [2.5 Token 预算与溢出策略 (Token Policy & Budget)](#25-token-预算与溢出策略-token-policy--budget)
- [3. 编译器底层渲染算法说明](#3-编译器底层渲染算法说明)
  - [3.1 模板宏解析算法](#31-模板宏解析算法)
  - [3.2 历史深度注入数学模型](#32-历史深度注入数学模型)
  - [3.3 Token 溢出裁剪优先级算法](#33-token-溢出裁剪优先级算法)
- [4. 数据源宏 (Data Source Macros) 全量对照表](#4-数据源宏-data-source-macros-全量对照表)
- [5. 规范编排配置模版范例](#5-规范编排配置模版范例)
- [6. 编译诊断码 (Diagnostics) 与排雷手册](#6-编译诊断码-diagnostics-与排雷手册)

---

## 1. 系统架构与领域模型

Mobile Tavern 编排系统基于“中立领域模型—运行时数据投影—外部格式防腐”三层结构构建：

```text
+-----------------------------------------------------------------------------------+
|                        Mobile Tavern 编排系统三层架构                              |
+-----------------------------------------------------------------------------------+
| 1. 运行时数据投影 (Runtime Projection)                                             |
|    - 字符串数据源表 (runtime.values: Record<string, string>)                      |
|    - 消息历史列表 (runtime.history: PromptMessage[])                              |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼
+-----------------------------------------------------------------------------------+
| 2. 中立编译器 (compilePromptComposition)                                          |
|    - 条件逻辑计算 (matchesCondition)                                              |
|    - 模板宏解析 (TEMPLATE_MACRO_REGEX)                                            |
|    - 深度注入定位 (injectIntoHistory)                                             |
|    - Token 预算审计与优先级裁剪 (sumTokensByBlock / overflow: drop)              |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼
+-----------------------------------------------------------------------------------+
| 3. 产出与可观测性 (Compiled Output)                                               |
|    - 最终消息序列 (messages: PromptMessage[])                                     |
|    - 追踪日志 (traces: PromptCompositionTrace[])                                  |
|    - 编译诊断 (diagnostics: PromptCompositionDiagnostic[])                       |
+-----------------------------------------------------------------------------------+
```

系统内部不存在固定硬编码的全局 System Prompt 或锁死区块。若配置中无任何启用区块，编译器返回空消息序列（空编排为合法状态）。

---

## 2. 全字段属性契约与选项说明

### 2.1 基础属性 (Basic Attributes)

| 字段标识 | TypeScript 类型 | 允许值 | 详细技术说明 |
|---|---|---|---|
| `id` | `string` | 唯一字符串 | 区块的物理主键，用于追溯 Trace 及诊断拦截。 |
| `name` | `string` | 任意字符串 | 用户自定义标识名称，供界面渲染展示。 |
| `enabled` | `boolean` | `true` / `false` | 控制当前区块是否参与编译。若为 `false`，编译期直接跳过该区块。 |
| `role` | `PromptMessageRole` | `"system"` / `"user"` / `"assistant"` | 指定生成消息的角色头，直接映射为 LLM 请求 Payload 中的 `role` 字段。 |
| `order` | `number` | 任意整数（默认 `0`） | 决定静态顺序区块（`ordered`）在消息序列中的升序排列位置。 |

---

### 2.2 数据源与历史范围 (Source & History Selection)

区块的 `source` 属性为判别联合类型，决定内容的数据来源：

#### 1. 静态模板模式 (`source.type = "template"`)
读取 `template` 字段的文本，经模板宏替换后渲染为单条消息。

#### 2. 聊天历史模式 (`source.type = "chat_history"`)
将系统历史会话展开并注入为消息序列。包含子属性 `selection`：

| 属性 | 允许值 | 技术逻辑说明 |
|---|---|---|
| `selection.mode` | `"all"` / `"recent"` | `"all"`：展开全量历史消息。<br>`"recent"`：仅截取最近 N 条历史。 |
| `selection.count` | `number` (≥ 0) | 当 `mode = "recent"` 时生效，指定保留的最大消息条数。 |
| `selection.preserveFirstAssistant` | `boolean` | 当历史被截断且首条消息为 `assistant`（如角色首句问候语）时，若该项为 `true`，强制保留首条消息，并在尾部截取 `count - 1` 条消息。 |

---

### 2.3 位置与深度注入 (Placement & Depth Injection)

`placement` 属性决定区块在最终消息流中的物理插入位置：

#### 1. 顺序排列 (`placement.type = "ordered"`)
按照 `order` 字段升序排列在顶层消息列表中。

#### 2. 历史深度注入 (`placement.type = "in_chat"`)
将本区块动态插进对应的 `chat_history` 消息数组内部。

| 属性 | TypeScript 类型 | 技术说明与计算逻辑 |
|---|---|---|
| `depth` | `number` (≥ 0) | 深度值。`depth = 0` 表示插在历史数组的最末尾（最新消息下方）。 |
| `historyBlockId` | `string` (可选) | 指定目标 `chat_history` 区块的 ID。若未指定，默认作用于编译流中第一个可用的历史区块。 |
| `order` | `number` (可选) | 当多个注入区块具备相同 `depth` 时，按 `order` 升序决定相对插入顺序。 |

---

### 2.4 运行条件过滤 (Conditioning)

每个区块可配置可选的 `condition` 条件表达式。只有当运行时变量满足条件时，区块才会被渲染：

```typescript
export interface PromptBlockCondition {
  dataKey: string; // 运行时键名（如 "lorebook"、"scenario"）
  operator: "not_empty" | "empty" | "equals" | "not_equals"; // 操作符
  value?: string; // 期望值（仅在 equals / not_equals 时使用）
}
```

* **`not_empty`**：`values[dataKey]` 存在且非空字符串（剔除 `trim()` 后的纯空白）。
* **`empty`**：`values[dataKey]` 不存在或仅包含空白字符。
* **`equals`**：`values[dataKey] === condition.value`。
* **`not_equals`**：`values[dataKey] !== condition.value`。

---

### 2.5 Token 预算与溢出策略 (Token Policy & Budget)

全局配置 `tokenBudget` 用于拦截超限风险：

```typescript
export interface PromptCompositionTokenBudget {
  enabled: boolean; // 是否启用 Token 审计与自动裁剪
  mode: "model" | "custom"; // "model": 自动读取当前模型上下文上限；"custom": 使用自定义 maxTokens
  maxTokens?: number; // 自定义预算上限数值
}
```

单区块可配置 `tokenPolicy`：

| 属性 | 允许值 | 默认值 | 技术逻辑说明 |
|---|---|---|---|
| `overflow` | `"keep"` / `"drop"` | `"keep"` | `"drop"`：当预算超限时允许被编译器优先整块裁切。<br>`"keep"`：禁止被裁剪，属于核心保留区。 |
| `priority` | `number` (0~100) | `50` | 裁剪优先级。数值越小，代表在 Token 预算不足时越先被抛弃。 |

---

## 3. 编译器底层渲染算法说明

### 3.1 模板宏解析算法

对于 `template` 类型的区块，编译器采用正则匹配与替换：

1. 正则表达式：`/\{\{\s*([a-zA-Z0-9_.:-]+)\s*\}\}/g`。
2. 编译器解析提取大括号内的 `dataKey`。
3. 若 `runtime.values[dataKey]` 存在，以其值替换宏；若不存在，替换为空字符串 `""` 并记录诊断日志 `MISSING_DATA_KEY`。

---

### 3.2 历史深度注入数学模型

当编译 `placement.type = "in_chat"` 的区块时，系统按以下算法计算物理插入索引：

假设被注入的历史消息数组长度为 $L$（`history.length`），配置的深度值为 $D$（`depth`）：

$$\text{insertIndex} = \max(0, L - \lfloor D \rfloor)$$

#### 边界与规则：
1. **$D = 0$**：$\text{insertIndex} = L$，即紧贴历史数组的最底端插入。
2. **$D \ge L$**：$\text{insertIndex} = 0$，即推至历史数组的最前端插入，同时触发编译诊断 `DEPTH_OUT_OF_BOUNDS` 警告。
3. **多区块排序**：若存在多个区块具备相同 $D$，则优先按 `placement.order` 升序排列，次之按区块原始 `order` 升序排列。

---

### 3.3 Token 溢出裁剪优先级算法

当渲染后的总 Token 数超过限制阈值 $B$（`tokenBudget`）时，编译器触发以下裁剪迭代：

1. **提取可裁剪集合 $S_{drop}$**：选出所有配置了 `tokenPolicy.overflow === "drop"` 且实际消耗 Token > 0 的已渲染区块。
2. **多维排序**：将 $S_{drop}$ 按照以下规则进行双级升序排序：
   - 第一优先级：`tokenPolicy.priority` 升序（数值小的优先抛弃）。
   - 第二优先级：区块在原始列表中的索引 `index` 升序。
3. **循环剔除**：
   ```text
   WHILE 当前总Token > B AND S_drop 非空:
       targetBlock = S_drop.pop_first()
       从编译结果中强行移除 targetBlock 对应的全部消息
       当前总Token -= targetBlock.estimatedTokens
       记录诊断信息 TOKEN_BUDGET_DROPPED_BLOCK
   END WHILE
   ```
4. **致命超限校验**：若 $S_{drop}$ 已清空但总 Token 仍大于 $B$，编译器终止进一步裁剪，并输出 `TOKEN_BUDGET_EXCEEDED` 错误诊断（绝对不会侵入裁剪标有 `keep` 的核心区块）。

---

## 4. 数据源宏 (Data Source Macros) 全量对照表

下表记录了编译期 `runtime.values` 注册的标准数据源宏定义：

| 数据源宏 Key | 业务数据映射源 | 缺省回退值 | 详细说明 |
|---|---|---|---|
| `char` | `character.name` | `""` | 角色卡中定义的角色名称。 |
| `user` | `userProfile.name` | `"User"` | 玩家当前启用的昵称。 |
| `persona` | `userProfile.description` | `""` | 玩家人设档案详细描述。 |
| `description` | `character.description` | `""` | 角色卡 Personality / Description 人设正文。 |
| `first_mes` | `character.first_mes` | `""` | 角色卡自带的首句开场问候语。 |
| `scenario` | `character.scenario` | `""` | 角色卡决定的当前幕场景背景。 |
| `lorebook` | `LorebookResolver.resolve()` | `""` | 经三阶检索自动匹配触发的全局/角色世界书词条正文。 |
| `memory` | `AutoSummaryService.summaries` | `""` | `AutoSummaryService` 异步提炼的剧情时间轴概要。 |
| `history` | `ChatHistory` | N/A | 聊天历史专属占位符（仅用于 `chat_history` 类型区块）。 |

---

## 5. 规范编排配置模版范例

### 5.1 标准通用编排 JSON 范例

```json
{
  "id": "comp_standard_v1",
  "name": "标准通用编排模版",
  "version": 1,
  "tokenBudget": {
    "enabled": true,
    "mode": "model"
  },
  "blocks": [
    {
      "id": "block_sys_main",
      "name": "角色设定与系统天条",
      "enabled": true,
      "role": "system",
      "order": 10,
      "source": { "type": "template" },
      "template": "角色人设：\n{{description}}\n\n场景设定：\n{{scenario}}\n\n玩家档案：\n{{persona}}",
      "placement": { "type": "ordered" },
      "tokenPolicy": { "priority": 100, "overflow": "keep" }
    },
    {
      "id": "block_sys_lorebook",
      "name": "触发世界书设定集",
      "enabled": true,
      "role": "system",
      "order": 20,
      "source": { "type": "template" },
      "template": "【匹配到的世界观与设定集】\n{{lorebook}}",
      "placement": { "type": "ordered" },
      "condition": { "dataKey": "lorebook", "operator": "not_empty" },
      "tokenPolicy": { "priority": 30, "overflow": "drop" }
    },
    {
      "id": "block_history_main",
      "name": "消息历史段落",
      "enabled": true,
      "role": "user",
      "order": 30,
      "source": {
        "type": "chat_history",
        "selection": { "mode": "recent", "count": 20, "preserveFirstAssistant": true }
      },
      "template": "",
      "placement": { "type": "ordered" }
    },
    {
      "id": "block_jailbreak_bottom",
      "name": "Depth 0 强效破限与纪律",
      "enabled": true,
      "role": "system",
      "order": 40,
      "source": { "type": "template" },
      "template": "[System Notice: 请严格保持 {{char}} 的性格与口吻进行回复，严禁替 {{user}} 撰写对话或动作！]",
      "placement": { "type": "in_chat", "depth": 0 },
      "tokenPolicy": { "priority": 90, "overflow": "keep" }
    }
  ]
}
```

---

## 6. 编译诊断码 (Diagnostics) 与排雷手册

编译器在编译输出中会返回诊断列表 `diagnostics`。下表总结了常见诊断码及排查路径：

| 诊断代码 (Code) | 级别 | 产生原因 | 建议排查与解决措施 |
|---|---|---|---|
| `MISSING_DATA_KEY` | `warning` | 模板中引用的 `{{key}}` 在 `runtime.values` 中未注册。 | 检查宏名称拼写，或添加 `condition: { dataKey: key, operator: "not_empty" }` 过滤。 |
| `DEPTH_OUT_OF_BOUNDS` | `warning` | 区块设定的 `depth` 大于当前实际聊天历史的总条数。 | 自动退回至历史顶部（Index 0）插入，不影响整体编译。 |
| `MISSING_HISTORY_BLOCK` | `warning` | 存在 `in_chat` 注入区块，但编排中未声明任何可用的 `chat_history` 区块。 | 在编排中添加一个类型为 `chat_history` 的区块。 |
| `TOKEN_BUDGET_DROPPED_BLOCK` | `warning` | 编译总字数超出上限，某标记为 `drop` 的区块被成功裁切。 | 属于正常的预算拦截行为；如需强行保留，可将该区块的 `overflow` 设为 `"keep"`。 |
| `TOKEN_BUDGET_EXCEEDED` | `error` | 裁切完所有 `drop` 区块后，核心 `keep` 内容仍超出 Token 预算。 | 必须手动删减 `keep` 区块的正文或增大模型 Context 窗口上限。 |
