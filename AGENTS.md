# Mobile Tavern 行为指导手册 (AGENTS.md)
*Version: 1.8.0*

> [!IMPORTANT]
> **此文件定义了本项目的核心行为指导规范与技术边界约束。**
> 任何 AI 助手在分析、修改、重构或集成新功能时，必须首先且最优先遵守本指南中的所有铁则。

> [!TIP]
> **架构工作入口**：完成本文件的阅读后，必须继续阅读 [架构工作入口](docs/agents/architecture_entry.md)，据任务类型进入最小必要的详细文档；`TECHNICAL.md` 仅在需要完整实现细节时查阅。

---

# 🚨 核心行为准则一：超大规模扩展性与极致底座解耦战略
本软件在长线演进中，将向包含社区对话、插件系统、Gal游戏化等 50+ 个高阶功能的混合移动端底座演进。开发与重构时必须遵守核心解耦与扩展性铁则（大单体防御、数据物理分轨隔离、防腐层清洗及向前兼容降级等）。
* **详情规范**：[超大规模扩展性与极致底座解耦战略.md](docs/agents/decoupling_strategy.md)

---

# 🚨 核心行为准则二：SillyTavern 生态兼容与底层原则
本软件定位为纯底层、无侵入的角色卡与世界设定兼容运行容器。严禁在系统代码中写入任何具有主观引导性的逻辑或硬编码（如行为引导、破限提示词等），必须数据驱动且支持降级兜底。
* **详情规范**：[SillyTavern 生态兼容与底层原则.md](docs/agents/sillytavern_compat.md)

---

# 🚨 核心行为准则三：纯移动端（Android/iOS）战略与原生适配规范
本软件纯粹聚焦于移动端设备的原生混合 App，打包时必须剥离 Node.js 服务端代码。需严格执行原生桥接规范（如 Blob 下载限制拦截）、状态栏实时变色对齐、Safe Area 避让与大拇指侧重交互设计。
* **详情规范**：[纯移动端战略与原生适配规范.md](docs/agents/mobile_strategy.md)

---

# 🚨 核心行为准则四：受控浏览器自动化测试规范
浏览器自动化测试必须以受控、声明式、可复现的方式使用。严禁任何一次性探索调试（如 `browser_subagent` 后台点按），禁止在未授权下加载外部 CDN 或无休止重试。
* **详情规范**：[受控浏览器自动化测试规范.md](docs/agents/browser_testing.md)

---

# 🚨 核心行为准则五：Markdown 文档编写全中文规范
* **全中文表述**：项目内维护的任何 Markdown 文档（如 `task.md`, `implementation_plan.md`, `walkthrough.md`）中的描述、测试步骤、任务细则等，必须完全使用中文编写，严禁半汉半英。
* **专业术语保留**：技术名词（如 `IndexedDB`、`SSE`、`AbortController` 等）或代码标识符/文件名链接，需保留其原始英文拼写。

---

# 🚨 核心行为准则六：应用发布版本号同步修改与一键命令规范
更新 App 版本号时，严禁手动逐文件替换。必须优先使用内置的一键同步命令以自动修改 Vite 配置、Tauri 配置、Rust 后端及相关文档。
* **命令规范**：`npm run bump-version <new_version>`
* **物理文件与细节映射**：[应用发布版本号同步修改与一键命令规范.md](docs/agents/version_bump.md)

---

# 🚨 核心行为准则七：新指令与既有指导手册冲突处理原则
当用户的新指令与本指导手册（AGENTS.md）的核心准则冲突时，AI 助手**严禁直接执行修改**。必须明确指出冲突、陈述崩溃或数据丢失风险，并等待用户的二次确认与授权。

---

# 🚨 核心行为准则八：AI 协作物理隔离开发铁律与实操流程
在开发新服务、中间件或插件功能时，必须遵守物理隔离开发与 TDD 流程。仅限在新建的隔离沙盒文件内进行读写，限制提问上下文输入范围，并通过局部单兵测试跑通。
* **详细实操流程**：[AI 协作物理隔离开发铁律与实操流程.md](docs/agents/isolation_development.md)

---

# 🚨 核心行为准则九：开发助手与业务角色“雪团”的身份隔离
* **角色定位隔离**：AI 助手是本仓库 of 对等编程助理 `Antigravity`，必须始终保持严谨、专业、高效的软件工程助理口吻，严禁使用“雪团”猫咪的傲娇或带“喵~”字等语气。

---

# 🚨 核心行为准则十：开发服务安全重启与端口清理准则
在启动或重启本地 Express/Vite 开发服务器之前，必须首先检测并杀死占用该端口（默认 3000 端口）的残留进程，以防启动冲突导致挂起或死锁。

---

# 🚨 核心行为准则十一：云端后端开发与移动端物理隔离准则
云端后端服务（账号体系 / 云端推理 / 社区分享 / 遥测 / 热更新）独立部署于 `cloud/` 目录，通过 Docker 容器化运行于海外 VPS。严禁污染 `src/` 移动端代码区，前后端类型共享通过 `shared/` crate 的 ts-rs 自动导出，单一来源。移动端 Tauri 打包不得包含任何 `cloud/` 代码。
* **详情规范**：[云端后端开发规范.md](docs/agents/cloud_strategy.md)

---

# 🚨 核心行为准则十二：TypeScript 严格类型纪律与非必要禁用 any 准则

## 默认禁用范围
新增或修改代码中**严禁**使用以下形式，除非属于本准则末尾的"豁免清单"或经用户显式授权：
- `: any`、`<T = any>`、`Array<any>`、`Promise<any>`、`Record<string, any>`、`as any`
- `catch (e: any)` 必须改写为 `catch (e: unknown)` + narrowing（`e instanceof Error` 等）
- 函数返回值类型为 `any` 或包含 `any` 的联合类型

## 替代方案
- 真正无法预知类型：用 `unknown`，消费方负责 narrowing
- 复杂请求/响应结构：用 Zod schema 推导 `z.infer<typeof schema>`
- 函数返回多种类型：用联合类型 `T1 | T2` 或 discriminated union
- 异质事件载荷（如 `IMessage.payload`）：用泛型 `<TPayload = unknown>` 让订阅方传入具体类型
- 第三方库缺类型：优先 `// @ts-expect-error` + 注释说明，不退化为 `any`

## 豁免清单（待后续阶段渐进清理，不得新增）
以下场景的 `any` 为历史遗留，已用 `// 详见 AGENTS.md "非必要不允许使用 any" 准则的待重构豁免清单` 注释标记，禁止新增同类型 any：

| 文件 | 字段 / 位置 | 豁免理由 |
|------|-------------|----------|
| `src/utils/tavernHelper/bridgeCore.ts` | `initializeMvuFromCharacter(character: any)` 等桥接函数 | 解析 SillyTavern 角色卡 extensions 等动态 JSON 结构，结构由外部数据决定；防腐层已通过 ScriptService.cleanMvuVariables 收口为 `Record<string, unknown>` |
| `src/application/services/LLMService.ts` | `AbortSignal.any`、`proxyPayload: any`、`history: any[]` | ES2024 提案 `AbortSignal.any` 在 ES2022 lib 中类型缺失；LLM 请求体结构因 provider 而异，待引入 Zod schema 收敛 |
| `src/application/services/TelemetryService.ts` | `extraData: Record<string, any>`、`log: any`、`inputVal: any` | 遥测载荷字段稀疏且频繁演进，结构稳定性低于业务实体；待遥测契约稳定后引入 Zod schema |
| `src/application/services/{Tts,Asr,ImageGeneration}Service.ts` | `config: any`、`activeRecognition: any`、`bodyObj: any` | Web Speech API / FormData 等 Web API 在 TS lib 中类型不完整；待 lib 升级或局部声明类型 |
| `src/application/services/memory/{MemoryExtractor,MemoryRecall,MemoryStateTable,MemoryStorage,MemorySummary}.ts` | `dict: any[]`、`sessionObj: any`、`parsed: any`、`dbMessagesRecords: any[]` 等 | 记忆系统内部 LLM 抽取/召回的中间结构动态性较高；待 Memory 子模块契约稳定后泛型化 |
| `src/application/services/prompt/{PromptMacroFormatter,types}.ts` | `variables: any`、`modelCapabilities: any` | MVU 变量结构与模型能力描述由外部数据决定；待 Prompt 子模块契约稳定后引入具体类型 |
| `src/application/services/AutoSummaryService.ts` | `resData: any`、`mem: any` | 已标记 `@deprecated`，逻辑已合并到 MemoryService.getSummary()；待废弃删除 |
| `src/types.ts` | `expressions?: any`、`extensions?: Record<string, any>`、`variables?: Record<string, any>`、`extra?: Record<string, any>`、`extensionSettings?: Record<string, any>` 等 | SillyTavern 兼容的动态 JSON 结构（角色卡 extensions、MVU 变量、消息 extra 等），结构由外部数据决定；待 SillyTavern 兼容契约稳定后引入 Zod schema |
| `src/components/FormattedText.tsx` | `SafeIframe props: any`、`activeCharacter: any`、`globalRegexScripts/presetRegexScripts: any[]`、`LocalErrorBoundary` 旧 any（已修复）等 | 富文本渲染组件涉及角色卡动态结构、正则脚本动态配置；待 P3-A UI 拆分时一并清理 |
| `src/infrastructure/storage/{indexedDbMemoryStore,IndexedDbMemoryPersistenceService,idbQueue,dbSchema,settingsRepository}.ts` | `metadata?: Record<string, any>`、`record: any`、`Promise<any>`、`saveStoredUsageMetrics(metrics: any)` 等 | IndexedDB 物理存储层处理动态记录结构（SillyTavern 兼容字段、用户自定义 metadata）；待存储层 schema 强类型化后清理 |
| `src/infrastructure/storage/repositories/settingsRepository.ts` | `pendingLargePrompts: Record<string, any>`、`large: Record<string, any>` | 大型 Prompt 段落数据结构动态性较高，待 Preset 契约稳定后引入具体类型 |

## 落地纪律
- **代码审查**：新增 any 必须在 PR 描述中说明豁免理由，未声明者一律拒绝合并
- **渐进清理**：本准则不要求一次性消除全部 any，但每次触及含 any 的文件时，应顺手清理本文件可触及的字段（最小改动原则）
- **测试代码豁免**：`tests/` 目录下的测试代码允许保留 `any`（mock 场景必需），但应优先用 `as unknown as T` 显式断言
- **lint 配置**：`@typescript-eslint/no-explicit-any` 规则建议设为 `warn`（仅警告不阻断构建），避免一次性堆积大量 error


---

# 🚨 核心行为准则十三：Kernel 纯机制与业务代码物理隔离铁律

`src/kernel/` 是与具体产品业务无关的通用运行时底座，只允许包含容器、服务生命周期、Pipeline、消息总线、扩展注册、运行时契约及其通用校验。Kernel 必须能够在不知道角色卡、Prompt、记忆、设置、数据库、模型厂商、UI 或移动端原生能力的情况下独立成立。

## 严格禁止

- 严禁在 `src/kernel/` 新建 `services/`、`bootstrap/` 或任何业务实现目录。
- 严禁把角色、会话、Prompt、世界书、记忆、LLM、TTS、ASR、插件、存储、遥测等应用服务实现放入 Kernel。
- 严禁 Kernel 导入 `src/application/`、`src/domain/`、`src/infrastructure/`、`src/components/`、`src/hooks/`、`src/tabs/` 或业务默认数据。
- 严禁以“核心服务”“官方服务”或“方便统一注册”为理由把业务代码回迁 Kernel。
- 严禁 Kernel 主动调用应用遥测、数据库或平台桥；可观测性必须通过通用日志、快照或由应用层注入的契约实现。

## 权威位置

- 应用服务实现与业务运行时装配：`src/application/`
- 纯领域规则：`src/domain/`
- 存储、原生和外部系统适配器：`src/infrastructure/` 或职责明确的适配目录
- React 视图与交互编排：`src/components/`、`src/hooks/`、`src/tabs/`
- 通用内核机制：`src/kernel/`

应用服务可以实现 `IKernelService` 并由应用组合根注册到 Kernel，但“使用 Kernel 托管”不等于“属于 Kernel”。任何例外都必须获得用户明确授权，并同步修改本准则与架构回归守卫。

---

# 🚨 核心行为准则十四：运行时边界、存储入口与用例层铁律

## 存储访问单一入口

- 页面、组件、React Hook、React Context 和领域规则严禁直接导入 `src/utils/localDB.ts`、`src/infrastructure/storage/` 或直接创建 IndexedDB 事务。
- 业务访问存储必须通过应用 Service；需要保持纯领域方向时，必须依赖领域端口，由应用组合根注入基础设施适配器。
- 应用 Service 实现可以调用职责明确的 Repository 或 Adapter，但不得通过 `localDB` 兼容门面间接回取存储实现。
- `src/utils/localDB.ts` 已冻结：只允许旧版外部兼容和测试重置，不得增加新导出、实现或生产调用。生产调用清零后继续保留一个兼容周期，确认无外部依赖后物理删除。

## 运行时体系命名与隔离

- SillyTavern 角色卡脚本、MVU、正则和 iframe 兼容能力统一称为 **SillyTavern Compatibility Runtime**，权威入口为 `src/compatibility/sillytavern/`。
- Compatibility Runtime 是外部生态防腐运行时，不是通用 Service，不得实现或注册为 `IKernelService`，不得吸收普通业务用例、存储事务或原生平台能力。
- 强沙箱插件与宿主之间的权限化调用统一称为 **Plugin Host RPC**，权威入口为 `src/domain/plugins/pluginHostRpc.ts`。
- Web 前端到 Tauri/Kotlin 的平台调用统一称为 **Native Adapter**，AR 权威入口为 `src/services/ar/NativeArAdapter.ts`。
- 旧 `TavernHelper Bridge`、`hostBridgeV2`、`TavernArBridge` 名称只允许出现在兼容导出、外部协议字段或历史归档中；新增代码和文档不得继续把三者统称为 Bridge。

## React Context 与用例层

- React Context 只保存和分发界面状态、选择状态、加载状态及界面回调绑定，不得实现持久化事务、级联删除、导入导出、业务初始化、分页合并、网络请求或跨 Service 流程。
- 事务和业务流程必须集中到 `src/application/useCases/` 或职责明确的应用 Service；Context 只能调用用例并把结果投影为 React State。
- Context 不得直接调用 Repository、IndexedDB、Compatibility Runtime 或 Native Adapter；平台相关界面状态必须先经过 Adapter 或专用 Hook。
- 新增业务流程时，先定义用例输入、输出和失败边界，再由 React 层绑定交互，禁止把 `useEffect` 或 Context Provider 当作业务编排器。

上述约束必须由 `tests/suites/architectureBoundaries.test.ts` 自动守卫。任何放宽均属于架构变更，必须先获得用户明确授权并同步修改本准则。

---

# ℹ️ 开发者网络代理环境限制
* 常态使用代理软件的 **TUN (虚拟网卡) 模式**，导致浏览器自动化请求外部 CDN 时极易死锁。测试必须严格使用本地静态化资源、缩短超时并配置国内镜像下载。

---

# ℹ️ 遥测集成架构与运行逻辑
* 遥测上报下沉至 Tauri Rust 后端。前端产生事件后通过 Tauri IPC 进行本地落盘（`telemetry_queue.jsonl`）。Rust 侧通过后台常驻线程获取 STS 凭证，计算 HMAC-SHA1 签名并批量上传至 SLS。

---

# ℹ️ Android 调试与打包规范
* **详细文档**：[Android_调试与打包指南.md](docs/Android_调试与打包指南.md)
* **核心铁则**：热重载调试必须绑定 `--host 127.0.0.1` 并反向映射 `3000`/`24678` 端口；生产打包必须彻底剥离 Node/Express 服务器。

---

# ℹ️ 特有例外说明
* **详细索引**：[PROJECT_EXCEPTIONS_AND_TODO.md](docs/PROJECT_EXCEPTIONS_AND_TODO.md)
* 包含"野牛模式与AI回复走向"的硬编码豁免，以及 `useRerollMessage` 事务流程豁免。

# ℹ️ 活跃待办、变更记录与历史归档
* [TODO.md](TODO.md) 只保留尚未完成事项、必要依赖和最近五条完成摘要；单项说明原则上不超过六行，严禁写入完整实现过程或长期累积测试流水。
* 功能落地后从 `TODO.md` 移出，在 [年度完成索引](docs/history/TODO_ARCHIVE_2026.md) 追加一行；历史内容必须保留在归档或 Git 历史中，不得直接丢弃。
* 每次重大功能或修复完成后，在 `docs/history/CHANGELOG_YYYY-MM.md` 对应月份表格追加一行，简述用户可见结果、关键边界变化和验证结论，建议不超过 180 个汉字。
* 架构职责、数据流或运行链路的长期说明归入 `TECHNICAL.md`；当前主线、风险和下一步归入 `docs/agents/CURRENT_STATE.md`，不得在多个文件重复维护同一份长说明。
* `docs/history/` 是冷归档，不属于每轮默认阅读包。只有追溯历史决策、旧实现或旧测试数据时才按需读取。
