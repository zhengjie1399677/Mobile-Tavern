# 2026 年已完成事项索引

> 本文件是已完成事项的简要索引，不替代实现文档、测试代码或 Git 历史。

| 日期 | 已完成事项 | 主要入口 |
|---|---|---|
| 2026-08-26 | 完成多模态附件分类入口/预览和 Tool Plugin 安装、权限、停用、回滚、卸载管理面；受控执行与来源治理继续留在 P2 | `src/tabs/chat/attachment-composer/`、`src/components/plugins/ToolPluginManagerSection.tsx` |
| 2026-08-28 | 完成会话管理器阶段一、二：生命周期/修订目录、归档删除守卫、三分类管理和独立收藏恢复备份 | `src/application/services/SessionManagementService.ts`、`src/components/session-manager/SessionManagerPanel.tsx` |
| 2026-08-26 | 完成 External Tool Plugin 本地 L2：`.mttool`、HTTPS/Worker 执行、宿主网络与凭据、Agent Runtime、会话快照和即时撤销；签名来源、远程撤回与生态审核继续留在 P2 | `src/application/services/ToolPluginRuntimeService.ts`、`src/infrastructure/toolPlugins/` |
| 2026-08-26 | 完成内置 Tool 产品化、一次性审批与质量门禁 P1：`character.read`、`session.branch`、审批 Journal/聊天卡片、改动文件 ESLint、Dependabot、PR 标题校验 | `src/application/tools/builtinAgentTools.ts`、`.github/workflows/quality.yml` |
| 2026-08-25 | Agent Host 五阶段当前验收范围完成：Runtime Profile、Content V2、附件数据面、Agent Spine、Compatibility Runtime、Profile UI | `docs/agents/agent_plugin_runtime_roadmap.md` |
| 2026-08-24 | 完成 Tool Loop、Agent Journal、音频 ASR、视频关键帧和 Profile 会话恢复最小闭环 | `src/application/services/AgentRuntimeService.ts` |
| 2026-08-06 | 修复世界书角色导入重启丢失及 catalog 空壳覆盖完整角色数据 | `tests/vitest/characterSaveGuard.test.ts` |
| 2026-08-03 | 统一备份升级并加入附件、Journal 和主库恢复保护 | `src/application/useCases/dataMigrationUseCases.ts` |
| 2026-07-29 | 完成 Kernel、存储事务、Abort、SafeProxy、React 卸载保护和架构边界加固 | `tests/suites/architectureBoundaries.test.ts` |
| 2026-07-28 | 完成长期记忆实体关系图谱、时态事实、世界书条件过滤和 Plugin Host RPC Bridge V2 | `src/domain/`、`src/application/` |
| 2026-07-26 | 完成 WebXR AR 原型并按真机兼容限制隐藏默认入口 | `src/services/ar/` |

测试数量不在归档中固化；验证时以 `npm test`、`npm run test:unit` 和对应构建命令的实际退出码为准。
