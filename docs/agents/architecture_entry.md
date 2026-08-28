# 架构工作入口

> 修改代码或架构时，在完整阅读 `AGENTS.md` 后阅读本文。本文只负责把任务路由到最小必要上下文，
> 不重复核心铁律、实现细节、排障步骤或历史记录。

## 一、项目定位

Mobile Tavern 当前是本地优先、多模态、可组合的移动端 Agent Host，默认 Tavern Profile 继续提供
SillyTavern 兼容体验，Base Profile 可以关闭兼容插件；SillyTavern 能力由可关闭的内置 Compatibility
Runtime Plugin 承载。移动端位于 `src/` 与 `src-tauri/`，云端服务位于 `cloud/`，共享契约位于
`shared/`。Kernel 始终只是通用运行时机制，Agent、聊天、媒体和兼容能力都不属于 Kernel。目标架构与分阶段路线见
[插件式 Agent Runtime 与聊天组合路线](agent_plugin_runtime_roadmap.md)。

## 二、阅读决策

1. 每次修改先读 `AGENTS.md` 和本文。
2. 从下表选择与任务直接相关的路线；未命中的文档不读取。
3. 只有需要当前进度、风险或下一步时读取 `docs/agents/CURRENT_STATE.md`。
4. 只有需要完整实现链路时读取 `TECHNICAL.md` 的相关章节。
5. 只有追溯历史决策时读取 `docs/history/`；不得把历史目录作为默认上下文。

## 三、按任务读取

| 任务 | 最小入口 | 继续读取 |
|---|---|---|
| Kernel、Scope、Effect、Pipeline、消息总线 | `src/kernel/README.md`、`src/kernel/types.ts`、`src/kernel/EffectScope.ts`、`src/kernel/Kernel.ts` | `docs/agents/runtime_boundaries.md`、必要时读 `docs/agents/module_contracts.md` |
| 应用服务与运行时装配 | `src/application/README.md`、`src/application/runtime.ts`、`src/application/runtimePlugins/`、目标服务 | `docs/agents/runtime_boundaries.md` |
| 存储、会话、记忆 | `DatabaseService.ts`、`src/infrastructure/storage/`、相关端口 | `docs/agents/runtime_boundaries.md`、`docs/agents/module_contracts.md` |
| React 状态或业务流程 | 目标组件、Hook、Context 与 `src/application/useCases/` | `docs/agents/runtime_boundaries.md` |
| 聊天发送、重发、流式输出 | `useChat.tsx`、`useSendMessage.ts`、`useRerollMessage.ts` | 对应回归测试；需要全链路时读 `TECHNICAL.md` |
| Prompt、角色卡、世界书 | `PromptService.ts`、`src/application/services/prompt/` | `docs/agents/sillytavern_compat.md` |
| Compatibility Runtime | `src/compatibility/sillytavern/` | `docs/agents/runtime_boundaries.md`、`docs/agents/sillytavern_compat.md` |
| 第三方全屏插件 | `docs/Plugin_System_v1.md`、`src/domain/plugins/` | `src/components/plugins/`、`src/infrastructure/plugins/pluginStorage.ts` |
| 自定义主题、Tab 显隐、本地界面资源与受限交互 | `docs/Theme_Development_Guide.md`、`src/domain/themes/` | `ThemeInteractionService.ts`、`src/components/theme-interactions/`、`LocalResourceService.ts` |
| Native Adapter、Android、Tauri、打包 | 对应 Adapter、`src-tauri/` | `docs/agents/mobile_strategy.md`、Android 调试指南 |
| 云端服务 | 目标 `cloud/<service>/`、其 README 和 Config | `docs/agents/cloud_strategy.md`、相关 `shared/` 契约 |
| 环境变量、功能开关、灰度策略 | 对应配置入口 | `docs/agents/configuration_strategy.md` |
| TypeScript 类型或历史 `any` | 目标类型和调用方 | `docs/agents/typescript_discipline.md` |
| 新服务、中间件、插件或跨层重构 | 目标边界与局部测试 | `docs/agents/isolation_development.md` |
| Runtime Plugin、Agent、Chat Profile、多模态消息 | `docs/agents/agent_plugin_runtime_roadmap.md` | `docs/agents/runtime_boundaries.md`、`docs/agents/isolation_development.md` |
| 浏览器或 E2E 自动化 | 已纳入仓库的测试脚本 | `docs/agents/browser_testing.md` |
| WebView 界面、移动交互与 UI 性能 | `src/components/MainLayout.tsx`、目标页面与 UI 基元 | `docs/agents/ui_webview_performance.md`、`docs/agents/mobile_strategy.md` |
| 可复现故障排查 | `docs/agents/troubleshooting_entry.md` | 由排障表继续进入命中模块 |
| 测试选择、开发服务、文档归档 | `docs/agents/development_workflow.md` | 仅按其中条件继续读取 |

## 四、关键代码入口

| 能力 | 权威入口 |
|---|---|
| 应用组合根与 Runtime Profile | `src/App.tsx`、`src/application/runtime.ts`、`src/application/runtimePlugins/`、`src/application/bootstrap/` |
| 插件式 Agent 目标架构 | `docs/agents/agent_plugin_runtime_roadmap.md` |
| Kernel 通用机制 | `src/kernel/index.ts`、`src/kernel/types.ts`、`src/kernel/EffectScope.ts`、`src/kernel/Kernel.ts` |
| 聊天编排 | `src/hooks/useChat.tsx`、`src/hooks/useChat/` |
| 角色与会话用例 | `src/application/useCases/characterUseCases.ts`、`chatSessionUseCases.ts` |
| 通用数据服务 | `src/application/services/DatabaseService.ts` |
| 会话目录、归档与收藏备份 | `src/application/services/SessionManagementService.ts`、`src/infrastructure/sessionBackups/` |
| IndexedDB 物理实现 | `src/infrastructure/storage/` |
| 本地图片、视频与音频资源 | `src/application/services/LocalResourceService.ts`、`src/infrastructure/resources/` |
| 记忆端口与适配器 | `src/application/services/memory/types.ts`、`IndexedDbMemoryPersistenceService.ts` |
| 统一备份与覆盖恢复 | `src/application/services/DataMigrationService.ts`、`src/application/useCases/dataMigrationUseCases.ts` |
| SillyTavern Compatibility Runtime | `src/compatibility/sillytavern/` |
| Plugin Host RPC | `src/domain/plugins/pluginHostRpc.ts` |
| AR Native Adapter | `src/services/ar/NativeArAdapter.ts` |
| 移动端公开配置与产品策略 | `src/config/` |
| Node 与构建配置 | `server/config.ts`、`build/viteEnvironment.ts` |
| 架构自动守卫 | `tests/suites/architectureBoundaries.test.ts` |

## 五、入口维护边界

- 本文只回答“应该去哪里找”，不解释“具体如何实现”。
- 新增稳定模块边界时更新关键入口；实现细节进入模块 README、专项规范或 `TECHNICAL.md`。
- 排障现象进入 `troubleshooting_entry.md`，测试与文档流程进入 `development_workflow.md`。
- 表格内容如果需要超过两句话解释，说明它不应继续留在本入口。
