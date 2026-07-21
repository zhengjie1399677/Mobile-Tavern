# 架构工作入口

> 本文档是进入本仓库后的短索引，不替代 `AGENTS.md`、`TECHNICAL.md` 或各专项规范。
> 修改代码前，先读 `AGENTS.md`，再读本文；仅在任务命中相应领域时继续读取下方链接的详细文档。
> 本文目标是减少上下文恢复成本：先判断任务归属，再打开最小必要文件，不把超长技术文档当作默认入口。
> 需要快速确认当前进度时，先读 `docs/agents/CURRENT_STATE.md`，该文件只保留当前态，不记录历史。

## 一、项目定位

Mobile Tavern 是纯移动端的 SillyTavern 兼容运行容器。底座保持无主观引导、数据驱动和可降级；移动端前端代码位于 `src/`，云端服务仅位于 `cloud/`，两者不得互相污染。

## 二、每轮最小阅读包

| 场景 | 最小阅读包 | 何时继续加读 |
|---|---|---|
| 只回答架构问题 | `AGENTS.md`、本文、`docs/agents/CURRENT_STATE.md`、相关入口文件 | 涉及历史决策时再按月读取 `docs/history/` 对应归档 |
| 修复用户可见 Bug | `docs/agents/CURRENT_STATE.md`、本文的问题定位表、命中的代码入口、对应测试 | 涉及跨层持久化或内核边界时再读 `TECHNICAL.md` 对应章节 |
| 做新功能 | `AGENTS.md`、本文、`docs/agents/CURRENT_STATE.md`、对应专项规范、目标目录 README | 涉及新服务、插件、云端或中间件时先读隔离开发规范 |
| 打包或真机问题 | `docs/Android_调试与打包指南.md`、`docs/agents/mobile_strategy.md` | 版本号变更时再读 `docs/agents/version_bump.md` |
| 云端后端 | `docs/agents/cloud_strategy.md`、`cloud/README.md`、`shared/` 类型 | 移动端调用云端前必须确认 `src/` 不引入 `cloud/` |

## 三、按任务阅读路线

| 任务 | 先读文件 | 再读文件 |
|---|---|---|
| 所有修改 | `AGENTS.md`、本文 | 需要确认剩余工作时读精简 `TODO.md`；历史归档不默认读取 |
| 内核、服务、Pipeline、消息总线 | `src/kernel/README.md`、`src/kernel/types.ts`、`src/kernel/Kernel.ts` | `TECHNICAL.md` 的微内核章节 |
| 聊天发送、重发、流式输出 | `src/hooks/useChat.tsx`、`src/hooks/useChat/useSendMessage.ts`、`src/hooks/useChat/useRerollMessage.ts` | `TECHNICAL.md` 的数据流和 IndexedDB 章节 |
| 会话回载、分页、折叠顺序 | `src/contexts/ChatContext.tsx`、`src/contexts/chatMessageHydration.ts`、`src/tabs/chat/DialogueHistoryView.tsx` | `src/infrastructure/storage/indexedDbSessionQueries.ts`、`TECHNICAL.md` 的持久化链路 |
| 存储、会话、记忆 | `src/kernel/services/DatabaseService.ts`、`src/infrastructure/storage/` | `docs/agents/decoupling_strategy.md` |
| Prompt、角色卡、世界书 | `src/kernel/services/PromptService.ts`、`src/kernel/services/prompt/` | `docs/agents/sillytavern_compat.md` |
| React 视图与状态 | `src/UnifiedAppContext.tsx`、`src/contexts/KernelContext.tsx` | `TECHNICAL.md` 的状态管理章节 |
| Android、Tauri、打包 | `docs/Android_调试与打包指南.md` | `docs/agents/mobile_strategy.md` |
| 云端服务 | `docs/agents/cloud_strategy.md`、`cloud/` | `shared/` 类型契约 |
| 浏览器自动化 | `docs/agents/browser_testing.md` | 仅使用受控、声明式测试 |

## 四、常见问题定位表

| 用户现象或开发问题 | 优先检查 | 常用验证 |
|---|---|---|
| 关闭重开后消息顺序错乱 | `ChatContext.tsx`、`chatMessageHydration.ts`、`indexedDbSessionQueries.ts` | `tests/suites/paginationAndArchival.test.ts` |
| 重发没有覆盖旧回复或出现双回复 | `useRerollMessage.ts`、`indexedDbMemoryStore.ts` 的 `replaceSessionBranch` | `tests/vitest/useRerollMessage.test.ts`、`tests/suites/turnIndexConsistency.test.ts` |
| 流式输出卡顿、跳字、丢字 | `useChat.tsx`、`useSendMessage.ts`、`streamHelpers.ts`、`ChatStreamService.ts` | `npm run test:unit` 中流式相关用例 |
| 会话、角色或记忆数据异常 | `DatabaseService.ts`、`src/infrastructure/storage/`、`src/utils/localDB.ts` | 先跑命中存储测试，再跑 `npm test` |
| Prompt 组装、世界书触发异常 | `PromptService.ts`、`src/kernel/services/prompt/`、`src/utils/promptBuilder.ts` | Prompt/世界书相关 suite |
| 内核服务拿不到或降级异常 | `Kernel.ts`、`src/kernel/schemas/`、`registerCoreServices.ts` | `tests/suites/kernelSchemaValidation.test.ts`、`tests/suites/architectureBoundaries.test.ts` |
| UI 改动后全局重渲染变重 | `UnifiedAppContext.tsx`、相关组件的 `useUnifiedApp(selector)` | 架构边界测试与局部 Vitest |
| Android 真机白屏、网络或热重载问题 | `docs/Android_调试与打包指南.md`、`vite.config.ts`、`src-tauri/` | 真机调试前按文档检查端口与 host |
| 生产 APK 混入 Node 或云端代码 | `docs/agents/mobile_strategy.md`、`docs/agents/cloud_strategy.md`、打包配置 | `npm run build`，必要时检查产物依赖 |

## 五、当前不可跨越的边界

1. `src/kernel/` 只放通用内核契约、生命周期和可复用服务；业务规则归入 `src/domain/` 或业务组合层。
2. 长期记忆领域只依赖 `MemoryPersistencePort`；`src/kernel/services/memory/` 不得直接导入 `utils/localDB` 或 `infrastructure/`。
3. IndexedDB 物理实现归入 `src/infrastructure/storage/`；`DatabaseService` 只提供通用 CRUD 与事务能力，不承载召回、摘要或角色行为。
4. React 组件必须使用 `useUnifiedApp(selector)` 最小订阅；不得恢复无 selector 的完整 Context 订阅。
5. `KernelProvider` 必须显式提供 `IKernel`；业务代码和管道辅助函数不得自行读取 `globalKernel`。
6. 自定义 Pipeline 必须先调用 `registerPipeline`；`getPipeline` 不会隐式创建。
7. 重发必须走 `replaceSessionBranch` 的跨 Store 原子替换；不得先删旧消息再分步写入新消息。
8. 召回结果属于运行时快照，按 `sessionId` 隔离；不得写入 `ChatSession` 或持久化会话记录。
9. `cloud/`、`shared/` 与移动端 `src/` 的依赖方向必须保持单向契约化；移动端不得直接导入云端实现代码。
10. Markdown 文档必须使用中文说明；代码标识符、命令、文件名和技术名词保留英文原拼写。

## 六、当前关键入口

| 能力 | 入口 |
|---|---|
| 应用装配 | `src/App.tsx`、`src/kernel/index.ts`、`src/kernel/bootstrap/registerCoreServices.ts` |
| 聊天编排 | `src/hooks/useChat.tsx`、`src/hooks/useChat/useSendMessage.ts`、`src/hooks/useChat/useRerollMessage.ts` |
| 会话原子持久化 | `src/kernel/services/DatabaseService.ts`、`src/infrastructure/storage/indexedDbMemoryStore.ts` |
| 会话分页与回载正序化 | `src/contexts/ChatContext.tsx`、`src/contexts/chatMessageHydration.ts`、`src/infrastructure/storage/indexedDbSessionQueries.ts` |
| 记忆端口与适配器 | `src/kernel/services/memory/types.ts`、`src/infrastructure/storage/IndexedDbMemoryPersistenceService.ts` |
| Prompt 拆分职责 | `src/kernel/services/PromptService.ts`、`src/kernel/services/prompt/` |
| 架构回归防线 | `tests/suites/architectureBoundaries.test.ts` |

## 七、测试选择

| 改动范围 | 优先命令 |
|---|---|
| 文档、注释、无行为变更 | `git diff --check` |
| 单个纯函数或 hook | 命中测试文件，必要时再跑 `npm run test:unit` |
| 聊天、存储、重发、分页 | 命中测试 + `npm test` + `npm run test:unit` |
| 内核、依赖边界、类型契约 | `npm run lint` + `npm test` |
| 打包、Tauri、生产路径 | `npm run lint` + `npm test` + `npm run build` |

代码变更至少运行与风险相称的检查；涉及内核、存储、聊天或依赖边界时，完整执行：

```powershell
npm run lint
npm test
npm run build
```

## 八、文档维护规则

完成重大功能或修复后：

1. `TODO.md` 只维护活跃事项；功能完成后移入 `docs/history/TODO_ARCHIVE_2026.md` 的一行索引。
2. 在当月 `docs/history/CHANGELOG_YYYY-MM.md` 追加一行中文变更记录，不复制完整实现过程。
3. 架构边界、目录职责或运行链路变化时，同步更新 `TECHNICAL.md`。
4. 用户可见能力或开发入口变化时，同步更新 `README.md`。
5. 本文仅维护稳定入口与边界；实现细节写入对应专项文档，避免本文膨胀。

维护本文时优先追加“怎么找”的信息，不展开“为什么这样实现”。如果一段说明需要超过三五句话，通常应移动到 `TECHNICAL.md` 或对应 `docs/agents/*.md`。
