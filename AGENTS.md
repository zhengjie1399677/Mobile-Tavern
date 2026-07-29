# Mobile Tavern 行为指导手册 (AGENTS.md)
*Version: 1.7.2*

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

## 豁免清单（待 P2 阶段泛型化重构，不得新增）
以下场景的 `any` 为本次清理遗留，已用 `// 详见 AGENTS.md "非必要不允许使用 any" 准则的待重构豁免清单` 注释标记，禁止新增同类型 any：

| 文件 | 字段 / 位置 | 豁免理由 |
|------|-------------|----------|
| `src/kernel/types.ts` | `IExtension.component` | React 组件类型，但 kernel 不应反向依赖 React；P2 应在 `src/services/pipeline/types.ts` 定义具体 Extension 契约 |
| `src/kernel/types.ts` | `IDatabaseService<TSession = any, TCharacter = any, TSummary = any>` 及其 message/character/messages 入参 | 改成 `unknown` 会触发 TS2416（实现方 CharacterService 等传入具体类型时不兼容）；P2 应引入新泛型参数 `TMessage` / `TCharacterEntry` |
| `src/kernel/types.ts` | `IPromptService<TCharacter = any, ...>` 等所有服务接口的泛型默认值 | 同上 TS2416 原因；P2 应让实现方显式声明类型参数 `implements IPromptService<CharacterCard, ...>` |
| `src/kernel/types.ts` | `ICharacterService` / `IWorldbookService` / `IPresetService` 的实体字段 | 同 IDatabaseService 实体字段；P2 应引入 `TCharacter` / `TLorebook` / `TPreset` 泛型参数 |
| `src/kernel/types.ts` | `IMemoryService<TStorage = any, ...>` 五个泛型参数 | 同上 TS2416 原因；实现方 MemoryService 应显式声明类型参数 |

## 落地纪律
- **代码审查**：新增 any 必须在 PR 描述中说明豁免理由，未声明者一律拒绝合并
- **渐进清理**：本准则不要求一次性消除全部 any，但每次触及含 any 的文件时，应顺手清理本文件可触及的字段（最小改动原则）
- **测试代码豁免**：`tests/` 目录下的测试代码允许保留 `any`（mock 场景必需），但应优先用 `as unknown as T` 显式断言
- **lint 配置**：`@typescript-eslint/no-explicit-any` 规则建议设为 `warn`（仅警告不阻断构建），避免一次性堆积大量 error


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
