# Mobile Tavern 行为指导手册

*Version: 2.0.0*

> [!IMPORTANT]
> 本文件只保留每次协作都必须知道的最高优先级规则。任何修改开始前必须完整阅读本文件；
> 修改代码或架构时继续阅读[架构工作入口](docs/agents/architecture_entry.md)，再按任务命中的路线读取专项文档。
> 未命中的专项文档、`TECHNICAL.md`、历史归档和排障手册均不属于默认阅读包。

## 产品当前态与目标态

- 当前产品仍是纯移动端的 SillyTavern 兼容运行容器，现有数据、行为和兼容能力必须按 `CHANGE-SAFE` 平滑迁移。
- 目标产品是本地优先、多模态、可组合的移动端 Agent Host；SillyTavern 能力将降级为可关闭的内置 Compatibility Runtime Plugin。
- 目标架构不得被解释为把 Agent、聊天、媒体或兼容业务移入 Kernel，也不得把受信 Runtime Plugin 与用户安装的 `.mtplugin` 沙箱合并。
- 分阶段边界、聊天组合方式和完成条件以[插件式 Agent Runtime 与聊天组合路线](docs/agents/agent_plugin_runtime_roadmap.md)为准；尚未完成的目标不能提前覆盖当前代码边界。

## 一、规则效力与阅读协议

- 本文件高于仓库内其他开发说明；专项文档负责解释细节，不得放宽本文件。
- 用户指令若与本文件冲突，禁止直接修改。必须指出冲突及崩溃、数据丢失或边界退化风险，等待用户明确二次授权。
- 规则引用必须使用下方稳定标识（如 `ARCH-KERNEL`），禁止使用“准则一”“第十二条”等会随排序失效的编号。
- 只回答普通问题时无需读取整个文档库；修改任务按架构入口选择最小必要文件。

## 二、默认必守铁律

### `ARCH-KERNEL`：Kernel 只能包含通用机制

- `src/kernel/` 只允许容器、生命周期、父子 Scope、可撤销 Effect、Pipeline、消息总线、扩展注册、运行时契约及通用校验。
- 角色、会话、Prompt、记忆、存储、LLM、TTS、ASR、插件、遥测、页面流程和平台调用均属于业务或适配代码，严禁进入 Kernel。
- Kernel 不得导入 `application`、`domain`、`infrastructure`、React UI 或业务默认数据；“由 Kernel 托管”不代表“属于 Kernel”。
- 应用服务和装配进入 `src/application/`，纯领域规则进入 `src/domain/`，外部系统和物理存储进入 `src/infrastructure/`。

详细边界见[运行时模块边界](docs/agents/runtime_boundaries.md)，并由
`tests/suites/architectureBoundaries.test.ts` 强制守卫。

### `ARCH-FLOW`：业务流程、状态和存储必须分层

- 页面、组件、Hook、Context 和领域规则不得直接访问 IndexedDB、Repository 或冻结的 `src/utils/localDB.ts`。
- 业务访问存储统一经过应用 Service 或领域端口；`localDB.ts` 只保留旧兼容和测试重置，不得新增生产调用或导出。
- React Context 只保存界面状态；事务、分页、级联删除、导入导出、网络流程和跨 Service 编排进入 `src/application/useCases/` 或应用 Service。
- SillyTavern Compatibility Runtime、Plugin Host RPC、Native Adapter 是三条独立边界，不得合并为通用 Bridge 或通用 Service。

### `COMPAT-DATA`：兼容底座必须无侵入且数据驱动

- 本项目是纯底层、无主观引导的角色卡与世界设定兼容运行容器。
- 严禁把行为引导、破限提示词或生态特例硬编码进通用系统代码；外部输入必须在边界清洗、类型收口并支持降级。
- SillyTavern 角色卡脚本、MVU、正则和 iframe 逻辑只属于 Compatibility Runtime，不得污染普通业务、Kernel 或存储实现。
- 已批准的历史例外仅以[项目特有例外](docs/PROJECT_EXCEPTIONS_AND_TODO.md)为准，不得类推新增。

### `PLATFORM-MOBILE`：移动端与云端必须物理隔离

- 产品只面向 Android/iOS 原生混合 App；生产安装包必须彻底剥离 Node/Express 和 `cloud/` 代码。
- 云端服务仅位于 `cloud/`，移动端实现仅位于 `src/` 与 `src-tauri/`；跨端类型通过 `shared/` 单一来源契约传递。
- 文件保存、Safe Area、状态栏和平台能力必须经过明确的 Native Adapter 或原生能力入口，不能假设普通浏览器行为在 WebView 可用。

### `CONFIG-TRACKS`：配置分轨、类型校验、秘密隔离

- 移动端公开环境、产品发布策略、Vite 构建、本地 Node 服务和各云端服务必须使用各自的类型化配置入口。
- 除权威配置入口和 Kernel 运行模式自检外，生产代码不得直接读取环境变量。
- `VITE_*` 一律视为公开数据，严禁保存 API Key、签名密钥、数据库凭据或管理员令牌；生产秘密缺失时必须快速失败。
- 用户设置和模块内部技术常量不得汇入万能配置对象。

详细规则见[配置分轨与环境变量规范](docs/agents/configuration_strategy.md)。

### `QUALITY-TYPES`：类型和模块边界不得为便利退化

- 新增或修改的 TypeScript 默认禁止显式 `any`；使用 `unknown`、窄化、泛型、联合类型或 Zod Schema。
- 历史 `any` 只能存在于登记的豁免位置，触及文件时应在最小改动范围内清理；新增豁免必须获得用户明确授权。
- 除自动生成或第三方压缩绑定外，单个 `.ts` 或 `.tsx` 文件不得超过 1000 行；接近阈值时按职责拆分并保持公共 API 稳定。
- 高频大字段不得塞入全局设置或会话大对象；必须物理分轨、按需读取。

完整类型规则和豁免清单见[TypeScript 类型纪律](docs/agents/typescript_discipline.md)，解耦细则见
[底座解耦战略](docs/agents/decoupling_strategy.md)。

### `CHANGE-SAFE`：变更必须可迁移、可降级、可验证

- 修改既有数据模型、Props、配置或 API 时必须评估旧数据与旧调用方，提供迁移或兼容降级，禁止静默丢失用户数据。
- 新服务、中间件和插件先定义边界与测试，再接入应用组合根；不得借功能开发扩大无关修改范围。
- 涉及架构边界的变更必须同步更新权威文档和自动化守卫；任何放宽都必须获得用户明确授权。

### `TEST-CONTROLLED`：测试必须可复现且与风险相称

- 优先使用纳入仓库的 Vitest、系统测试或 Playwright 脚本；严禁一次性浏览器点按、后台观看页面或无界重试。
- 外部 CDN、代理环境、端口和超时必须受控；启动开发服务前先清理目标端口的残留进程。
- 测试选择、完整验证条件和服务重启流程见[开发与维护工作流](docs/agents/development_workflow.md)。

### `DOC-CHINESE`：项目 Markdown 使用中文并保持单一来源

- 项目维护的 Markdown 说明、计划、测试步骤和变更记录必须使用中文；技术名词、代码标识符、命令和文件名保留英文原拼写。
- 同一长期说明只能有一个权威位置：架构进入专项文档，当前态进入 `CURRENT_STATE.md`，历史进入 `docs/history/`。
- 默认阅读包不得塞入实现流水、长期测试日志、过时数量或低频操作细节。

### `COLLAB-IDENTITY`：开发助手与产品角色隔离

- 开发助手是严谨的软件工程协作者，不得模仿业务角色“雪团”，不得使用“喵”等角色语气。
- 版本号必须通过 `npm run bump-version <new_version>` 同步修改，禁止手工跨文件替换。

## 三、按需专项入口

| 任务命中条件 | 必须继续读取 |
|---|---|
| Kernel、存储、Context、Compatibility Runtime、RPC、Native Adapter | `docs/agents/runtime_boundaries.md` |
| 环境变量、功能开关、灰度策略、秘密 | `docs/agents/configuration_strategy.md` |
| TypeScript 类型或历史 `any` | `docs/agents/typescript_discipline.md` |
| 新服务、中间件、插件或跨层重构 | `docs/agents/isolation_development.md` |
| 角色卡、Prompt、世界书、SillyTavern 兼容 | `docs/agents/sillytavern_compat.md` |
| Android、iOS、Tauri、打包、文件保存 | `docs/agents/mobile_strategy.md` |
| 云端服务或 `shared/` 契约 | `docs/agents/cloud_strategy.md` |
| 浏览器或 E2E 自动化 | `docs/agents/browser_testing.md` |
| 版本号变更 | `docs/agents/version_bump.md` |
| 测试选择、开发服务、文档归档 | `docs/agents/development_workflow.md` |
| 提交 PR、评审 PR、处理审查意见 | `docs/agents/code_review.md` |
| 可复现故障排查 | `docs/agents/troubleshooting_entry.md` |

`TECHNICAL.md` 只在需要完整实现链路时读取，`docs/history/` 只在追溯历史决策时读取。
