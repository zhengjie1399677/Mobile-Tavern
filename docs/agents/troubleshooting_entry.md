# 故障排查入口

> 本文只在存在可复现故障或回归时读取。它提供定位入口，不替代对应模块文档。

| 用户现象或开发问题 | 优先检查 | 常用验证 |
|---|---|---|
| 关闭重开后消息顺序错乱 | `ChatContext.tsx`、`chatMessageHydration.ts`、`indexedDbSessionQueries.ts` | `tests/suites/paginationAndArchival.test.ts` |
| 重发未覆盖旧回复或出现双回复 | `useRerollMessage.ts`、`replaceSessionBranch` | `tests/vitest/useRerollMessage.test.ts`、`tests/suites/turnIndexConsistency.test.ts` |
| 流式输出卡顿、跳字、丢字 | `useChat.tsx`、`useSendMessage.ts`、`streamHelpers.ts`、`ChatStreamService.ts` | 流式输出相关 Vitest 与系统测试 |
| 会话、角色或记忆数据异常 | `DatabaseService.ts`、`src/infrastructure/storage/` | 命中存储测试后运行 `npm test` |
| Prompt 组装或世界书触发异常 | `PromptService.ts`、`src/application/services/prompt/`、`promptBuilder.ts` | Prompt 与世界书相关测试 |
| 应用服务未注册或降级异常 | `Kernel.ts`、`src/application/serviceSchemas/`、`registerCoreServices.ts` | Kernel Schema 与架构边界测试 |
| UI 改动导致全局重渲染 | `UnifiedAppContext.tsx`、相关 `useUnifiedApp(selector)` | 局部组件测试与架构边界测试 |
| Android 真机白屏、网络或热重载异常 | Android 调试指南、`vite.config.ts`、`src-tauri/` | 端口、Host、反向映射和生产构建 |
| 生产包混入 Node 或云端代码 | 移动端规范、云端规范、打包配置 | `npm run build`，必要时检查产物依赖 |

若问题涉及数据损坏或升级失败，排查前先保留原始数据和复现步骤，不得通过清库掩盖问题。
