# 架构工作入口

> 本文档是进入本仓库后的短索引，不替代 `AGENTS.md`、`TECHNICAL.md` 或各专项规范。
> 修改代码前，先读 `AGENTS.md`，再读本文；仅在任务命中相应领域时继续读取下方链接的详细文档。

## 一、项目定位

Mobile Tavern 是纯移动端的 SillyTavern 兼容运行容器。底座保持无主观引导、数据驱动和可降级；移动端前端代码位于 `src/`，云端服务仅位于 `cloud/`，两者不得互相污染。

## 二、阅读路线

| 任务 | 先读文件 | 再读文件 |
|---|---|---|
| 所有修改 | `AGENTS.md`、本文 | `TODO.md` 最近变更记录 |
| 内核、服务、Pipeline、消息总线 | `src/kernel/README.md`、`src/kernel/types.ts` | `TECHNICAL.md` 的微内核章节 |
| 聊天发送、重发、流式输出 | `src/hooks/useChat.tsx`、`src/hooks/useChat/useRerollMessage.ts` | `TECHNICAL.md` 的数据流和 IndexedDB 章节 |
| 存储、会话、记忆 | `src/kernel/services/DatabaseService.ts`、`src/infrastructure/storage/` | `docs/agents/decoupling_strategy.md` |
| Prompt、角色卡、世界书 | `src/kernel/services/PromptService.ts`、`src/kernel/services/prompt/` | `docs/agents/sillytavern_compat.md` |
| React 视图与状态 | `src/UnifiedAppContext.tsx`、`src/contexts/KernelContext.tsx` | `TECHNICAL.md` 的状态管理章节 |
| Android、Tauri、打包 | `docs/Android_调试与打包指南.md` | `docs/agents/mobile_strategy.md` |
| 云端服务 | `docs/agents/cloud_strategy.md`、`cloud/` | `shared/` 类型契约 |
| 浏览器自动化 | `docs/agents/browser_testing.md` | 仅使用受控、声明式测试 |

## 三、当前不可跨越的边界

1. `src/kernel/` 只放通用内核契约、生命周期和可复用服务；业务规则归入 `src/domain/` 或业务组合层。
2. 长期记忆领域只依赖 `MemoryPersistencePort`；`src/kernel/services/memory/` 不得直接导入 `utils/localDB` 或 `infrastructure/`。
3. IndexedDB 物理实现归入 `src/infrastructure/storage/`；`DatabaseService` 只提供通用 CRUD 与事务能力，不承载召回、摘要或角色行为。
4. React 组件必须使用 `useUnifiedApp(selector)` 最小订阅；不得恢复无 selector 的完整 Context 订阅。
5. `KernelProvider` 必须显式提供 `IKernel`；业务代码和管道辅助函数不得自行读取 `globalKernel`。
6. 自定义 Pipeline 必须先调用 `registerPipeline`；`getPipeline` 不会隐式创建。
7. 重发必须走 `replaceSessionBranch` 的跨 Store 原子替换；不得先删旧消息再分步写入新消息。
8. 召回结果属于运行时快照，按 `sessionId` 隔离；不得写入 `ChatSession` 或持久化会话记录。

## 四、当前关键入口

| 能力 | 入口 |
|---|---|
| 应用装配 | `src/App.tsx`、`src/kernel/index.ts`、`src/kernel/bootstrap/registerCoreServices.ts` |
| 聊天编排 | `src/hooks/useChat.tsx`、`src/hooks/useChat/useSendMessage.ts`、`src/hooks/useChat/useRerollMessage.ts` |
| 会话原子持久化 | `src/kernel/services/DatabaseService.ts`、`src/infrastructure/storage/indexedDbMemoryStore.ts` |
| 记忆端口与适配器 | `src/kernel/services/memory/types.ts`、`src/infrastructure/storage/IndexedDbMemoryPersistenceService.ts` |
| Prompt 拆分职责 | `src/kernel/services/PromptService.ts`、`src/kernel/services/prompt/` |
| 架构回归防线 | `tests/suites/architectureBoundaries.test.ts` |

## 五、验证与文档维护

代码变更至少运行与风险相称的检查；涉及内核、存储、聊天或依赖边界时，完整执行：

```powershell
npm run lint
npm test
npm run build
```

完成重大功能或修复后：

1. 在 `TODO.md` 的“变更记录”追加中文记录，写明核心文件、关键决定与测试结果。
2. 架构边界、目录职责或运行链路变化时，同步更新 `TECHNICAL.md`。
3. 用户可见能力或开发入口变化时，同步更新 `README.md`。
4. 本文仅维护稳定入口与边界；实现细节写入对应专项文档，避免本文膨胀。
