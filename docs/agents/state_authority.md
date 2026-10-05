# 状态权威与瞬时态边界

> 更新日期：2026-10-05。本文是「哪份状态是权威、谁可以写它」的唯一权威来源。
> 稳定标识 `STATE-AUTHORITY`：任何涉及会话/记忆/设置状态读写的改动都要先对照本文。
> 相关：[运行时模块边界](runtime_boundaries.md)、[写入队列分片与合并语义](#四与写入队列的关系)。

## 一、三类状态

同一个数据在同一时刻只允许有一个权威来源。任何缓存、投影、半成品都必须能由权威重建。

| 类别 | 位置 | 生命周期 | 谁可以写 |
|---|---|---|---|
| **authoritative** | IndexedDB（经 `DatabaseService` → repository） | 跨会话、跨启动 | 仅应用层服务/用例 |
| **derived** | React state（`sessionViews`）与 refs | 组件/会话存活期 | 组件可改，但只作为权威的投影 |
| **ephemeral** | 流式缓冲、占位消息、滚动/焦点、`streamingMessageId` | 本轮请求 | 任意 UI 代码；**永不落库** |

## 二、规则

### `STATE-AUTHORITY:R1` 视图不得直连存储实现

组件、Tab、Hook 不得 import `src/infrastructure/storage/**` 或 `src/utils/localDB.ts`；
业务访问统一经应用服务或领域端口。**已由架构守卫强制**（`tests/suites/architectureBoundaries.test.ts`
中 `STATE-AUTHORITY:R1` 一节，覆盖 `src/components`、`src/tabs`、`src/hooks`），当前 0 违规。

`src/contexts` 受更严格约束：连 Compatibility Runtime 与 Native Adapter 也不得直连。
Native Adapter 本身不在禁令内——`PLATFORM-MOBILE` 要求平台能力经明确的原生入口，
例如 `src/hooks/ar/useArSync.ts` 导入 Native AR Adapter 属合法用法。

### `STATE-AUTHORITY:R2` 视图只能发命令

derived 状态只描述"现在看到什么"，不得作为权威写入的依据。向权威写数据只有两种合法形态：

1. **增量命令**：`commitSessionTurn` / `updateSessionMessage` / `appendSessionSummary` 等按实体 upsert；
2. **整体覆盖**：仅限导入、恢复、归档恢复等语义明确的场景（`replaceCompleteSessions` 的调用方全部位于
   应用层：`DatabaseService`、`chatImportUseCases`、`SessionManagementService`）。

禁止把视图对象"整体写回"来绕过命令语义。

### `STATE-AUTHORITY:R3` 跨 await 的写入必须携带身份与修订

每次异步写入都要带上"我是谁、我看到的是哪一版"（会话 ID + 修订/epoch + AbortSignal）；
完成时若发现已经过期，必须丢弃而不是写入。当前实现分散为 `isStillActive` / `__streamingMsgIdGuard` /
`agentHandleKeyRef` 三种手写守卫，收敛为单一 `isStale(token)` 是进行中的工作。

### `STATE-AUTHORITY:R4` 瞬时态永不进入权威

流式占位消息是典型例子：`useSendMessage` 只把 `{ id, sender: "assistant", content: "💭..." }`
放进 `setSessionViews`，**不落库**；只有在流结束（成功或失败分支）才用最终消息
`commitSessionTurn` 提交。因此"切后台被系统杀掉"不会留下半成品消息——这是设计而非巧合。

### `STATE-AUTHORITY:R5` 失败与中断必须收敛

任何异常路径都必须把 ephemeral 收敛成两种终态之一：提交带标记的最终消息（弱网/中断分支），
或回滚视图到权威值。禁止"占位符留在视图、权威里什么都没有"的悬空态。

## 三、权威所有者清单

| 数据 | 权威入口 |
|---|---|
| 会话与消息 | `DatabaseService.commitSessionTurn` / `updateSessionMessage` / `deleteSessionMessage` |
| 会话整体（导入/恢复） | `DatabaseService.replaceCompleteSessions` |
| 记忆（片段/事实/词典/快照） | `MemoryService` → `indexedDbMemoryStore` / `memory*Repository` |
| 设置与预设 | `SettingsService` / `PresetService` → `settingsRepository` |
| 角色卡 | `CharacterService` → `charactersRepository` |
| 附件与本地资源 | `AttachmentService` / `LocalResourceService` |
| 同步墓碑 | `tombstoneRepository`（删除必须可传播） |

## 四、与写入队列的关系

权威写入都经过 `src/infrastructure/storage/idbQueue.ts`，它提供两件与本文件直接相关的东西：

1. **写队列分片**：分片由声明的 key 前两段推导（`session:abc:turn` → `session:abc`），
   同聚合严格有序、不同聚合互不阻塞；整库迁移显式共享 `data-migration` 分片。
2. **合并语义必须显式**：`coalesceable`（默认，整体保存最新状态）与 `must-complete`
   （提交/追加类，绝不合并、各自拿到自己的结果）。把提交类写成 coalesceable 会**直接丢数据**
   （已实证：`commitSessionTurn` 被合并时先到那轮的 messages 永久丢失）。

即：`STATE-AUTHORITY:R2` 的命令语义，在实现层由 `must-complete` 保证；两者必须同时看。

## 五、守卫

- 架构守卫：视图层不得 import 存储实现（`STATE-AUTHORITY:R1`）。
- 架构守卫：本文必须存在，且 `AGENTS.md` 的按需专项入口必须指向它（防止规则失传）。
- 写队列测试：`tests/vitest/idbWriteQueue.test.ts` 钉住合并/分片语义。
- 场景测试：`tests/vitest/sessionTurnCommitRace.test.ts` 钉住"两次提交都要落盘"。

## 六、权威入口

- 模块边界：[runtime_boundaries.md](runtime_boundaries.md)
- 隔离开发：[isolation_development.md](isolation_development.md)
- 插件式 Agent Runtime 路线：[agent_plugin_runtime_roadmap.md](agent_plugin_runtime_roadmap.md)
