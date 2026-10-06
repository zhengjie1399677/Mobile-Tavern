# 外部能力通道与 MCP 接入设计

> 更新日期：2026-10-05。
> 本文是「外部能力通道（Connector / External Capability Source）」的权威设计来源，MCP 是它的第一个
> 协议实现，不是它本身。产品「做什么、不做什么」仍以[产品方向](product_direction.md)为准，分阶段边界
> 以[插件式 Agent Runtime 与聊天组合路线](agent_plugin_runtime_roadmap.md)为准，本文不得放宽二者。

## 一、目标与非目标

### 目标

1. 让用户把**外部能力源**（远端 MCP server，未来可有 HTTP / WebSocket / 专有协议）挂到 Agent 上，作为
   工具、上下文与提示词的可授权来源。
2. 复用既有 Tool Registry、Tool Policy、审批卡片、Agent Journal、凭据分轨与配额机制，不新建平行的
   执行或审计体系。
3. **从第一行代码起就按多协议、多版本、多能力类型设计**：新增一种协议或一种能力类型只增不改。

### 非目标

- 不在移动端运行 stdio 子进程，不执行外部 server 的代码。
- 不实现 MCP 已弃用的 Sampling、Roots、Logging。
- 不把外部工具描述当作授权依据，不自动信任 server 的注解。
- 不把外部能力接入 Kernel、存储实现或 React 组件。
- 本期不做「把 Mobile Tavern 作为 MCP server 暴露给外部客户端」的反向角色（属路线 §11.4–§11.6）。

## 二、协议基线（2026-10 已核实）

MCP 规范当前修订是 **2026-07-28**（上一版 2025-11-25），官方 TypeScript SDK 的稳定线是 **v2**
（`@modelcontextprotocol/client` 2.3.0 / `server` 2.3.0 / `core` 2.3.0，2026-10-02 发布），
实现 2026-07-28；v1 的 `@modelcontextprotocol/sdk` 是上一代，仅通过官方 codemod
`npx @modelcontextprotocol/codemod@latest v1-to-v2` 迁移。

### 2.1 本设计直接依赖的规范事实

| 事实 | 影响 |
|---|---|
| 协议无状态：无 `Mcp-Session-Id`、无 `initialize` 握手，每请求在 `_meta` 带 `protocolVersion` 与 `clientCapabilities` | 连接不再需要长期会话状态，弱网恢复只需重发请求 |
| `server/discover` 是现代 server 的必备 RPC，用于版本、能力与身份发现 | 连接建立的唯一入口；也是 legacy 探测手段 |
| 结果必须带 `resultType`；`input_required` 表示多轮往返（MRTR） | 服务端主动请求被 MRTR 取代，与我们的审批/重放模型同形 |
| list/read 结果必须带 `ttlMs` 与 `cacheScope` | 缓存语义由规范给定，不自造 |
| Streamable HTTP POST 必须带 `Mcp-Method` / `Mcp-Name` 头 | 传输层硬要求 |
| `capabilities.extensions` 与官方扩展仓库（`ext-auth` / `ext-apps` / `ext-tasks` / Skills over MCP） | 未知能力必须安全降级，不能因扩展字段报错 |

### 2.2 `EXT-DEPRECATED`：明确不采用的技术

以下均为规范层面已弃用或已移除，**新实现一律不碰**：

- `@modelcontextprotocol/sdk` v1 单体包与其 API 形状。
- HTTP+SSE 传输（2025-03-26 起弃用，2026-07-28 归入 Deprecated）与 SSE 断线重放（`Last-Event-ID` 已移除）。
- `initialize` / `initialized` 握手与 `Mcp-Session-Id` 会话模型。
- Sampling、Roots、Logging 三个已弃用特性（`logging/setLevel`、`roots/list_changed` 已移除）。
- `resources/subscribe` / `resources/unsubscribe` 与 HTTP GET 端点（由 `subscriptions/listen` 取代）。
- 核心协议里的 `tasks/result` / `tasks/list`（已移入 `ext-tasks`，改为 `tasks/get` + `tasks/update`）。
- OAuth DCR（RFC 7591）作为首选注册方式（让位于 Client ID Metadata Documents，DCR 仅作兼容回退）。

## 三、扩展性第一约束

这一节定义「什么叫扩展性达标」。任何实现若违反其中一条，即使功能可用也不合入。

| 扩展维度 | 要求 | 落地手段 |
|---|---|---|
| 协议种类 | MCP 只是第一个 driver；第二个协议（含未来 AI 生成的 Connector Adapter）不改核心 | 领域层只认 `ExternalCapabilitySource` + `ConnectorDriver` 端口；`kind` 是字符串 ID + 注册表，不在领域层枚举协议 |
| 能力类型 | tools / resources / prompts 之外的新能力必须能降级而非报错 | 快照携带 `unsupportedCapabilities`，未知类型进诊断并保留；新增能力类型 = 加一个 descriptor + 一个投影器 |
| 传输 | 业务层不得出现传输分支 | `transport` 同为由注册表解析的字符串 ID；本期注册表只有 `streamable-http`，stdio 与 SSE 不进注册表 |
| 协议版本 | 规范以修订日为单位演进 | 协商交给 SDK；我们只持久化 `negotiatedProtocolVersion` 供诊断与快照，不与领域模型耦合 |
| 认证机制 | 认证方式会持续增加 | 只保存 `authRef` 引用；凭据类型是可扩展联合（`none` / `static-header` / `oauth` / 未来 `client-credentials`、mTLS），不把 OAuth 写进 source 模型 |
| 规模 | 多 server、成百上千工具、有限上下文预算 | 外部工具**默认不进入模型上下文**，按官方「渐进发现」策略用阈值切换到 `search_tools` 元工具；阈值与配额是按 source 配置项，不是常量 |
| 角色 | 本期是消费方，未来要有暴露方 | 领域命名区分 `ExternalCapabilitySource`（消费）与未来的 `CapabilityExposureEndpoint`（暴露），不用 `McpClient` / `McpServer` 这类绑定协议角色的名字 |
| 渲染 | 工具结果与内联 UI 形态会演进 | 结果走既有 `message.renderer` Slot；未知结构降级为文本 + 可展开原始 JSON |
| 校验 | 外部 Schema 只会更宽松，我们的既有严格子集不能因此放宽 | 外部 JSON Schema 走**独立**收口策略文件，不动 `src/domain/toolPlugins/jsonSchema.ts` 的 `.mttool` 严格子集 |
| 数据模型 | 记录结构必然演进 | source 记录带 `schemaVersion`，走既有迁移入口，旧记录降级 |

## 四、边界与分层

### 4.1 `EXT-SOURCE-BOUNDARY`：第四类扩展边界

外部能力源是**远端不受信代码**，我们只做协议客户端。它比 `.mttool` Worker 更安全（我们不执行它的代码），
但仍是独立边界，**不与 Runtime Plugin、Worker Plugin、Sandbox App Plugin 合并执行权限**（路线 §11.5）。

| 边界 | 执行位置 | 能力 |
|---|---|---|
| Runtime Plugin | 应用进程 | 注入的类型化能力 |
| Worker Plugin / `.mttool` | 本机 Worker | 白名单消息 + 宿主代管网络 |
| Sandbox App Plugin | 强沙箱 iframe | 权限化 RPC |
| **External Capability Source（新增）** | 远端，仅协议 | 经过边界的工具调用、资源读取、提示词获取 |

### 4.2 目录与导入规则

```text
src/domain/externalSources/        中立契约：source、descriptor、快照、能力注册表、Schema 收口策略
src/application/externalSources/   生命周期编排、Tool/Context 投影、审批与 MRTR 桥接、曝光策略
src/infrastructure/externalSources/mcp/   唯一允许 import @modelcontextprotocol/* 的位置
```

- 只有 `src/infrastructure/externalSources/mcp/` 可以 import `@modelcontextprotocol/*`。
- 全仓库禁止 import `@modelcontextprotocol/client/stdio`（该子路径是本包唯一引入 `cross-spawn` 与
  `node:process`/`node:stream` 的入口；主入口已核实零 Node 内置依赖，可在 Android WebView 内打包运行）。
- Kernel 禁止 import `@modelcontextprotocol/*` 与 `src/domain/externalSources/`。

### 4.3 `EXT-CONNECTOR-SEAM`：Definition / Provider / Consumer

沿用 `RUNTIME-SEAM`：中立 Definition 在领域层，具体协议适配是 Provider，消费者只依赖 Definition。
每条连接归属调用方 Scope，返回 `Dispose`，按逆序释放；连接、订阅、定时器必须支持 `AbortSignal`。

## 五、中立契约草案

字段名不含协议语义，MCP 专有概念只在 `mcp` driver 内部出现。

```ts
// src/domain/externalSources/contracts.ts
export interface ExternalCapabilitySource {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly kind: string;                     // 本期 "mcp"；由注册表校验，领域层不枚举
  readonly displayName: string;
  readonly endpoint: string;                 // 传输无关的定位符
  readonly transport: string;                // 本期 "streamable-http"
  readonly era: "auto" | "legacy" | "modern"; // MCP 世代偏好；其他协议可忽略
  readonly authRef?: string;                 // 只存引用，绝不内联秘密
  readonly enabled: boolean;
}

export interface ExternalToolDescriptor {
  readonly sourceId: string;
  readonly qualifiedName: string;            // `${kind}.${sourceId}.${localName}`
  readonly localName: string;
  readonly description: string;              // 外部不可信文本，边界清洗 + 限长
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
  readonly hints?: Readonly<Record<string, boolean>>; // 仅作 UI 提示，不参与授权判断
}

export interface ExternalCapabilitySnapshot {
  readonly sourceId: string;
  readonly negotiatedProtocolVersion?: string;
  readonly tools: readonly ExternalToolDescriptor[];
  readonly resources: readonly ExternalResourceDescriptor[];
  readonly prompts: readonly ExternalPromptDescriptor[];
  readonly unsupportedCapabilities: readonly string[]; // 未知能力显式降级
  readonly warnings: readonly string[];                // 可诊断的降级原因（如列表拉取失败）
  readonly ttlMs?: number;
  readonly cacheScope?: "public" | "private";
}

export interface ConnectorDriver {
  readonly kind: string;
  readonly transports: readonly string[];
  connect(source: ExternalCapabilitySource, deps: ConnectorDeps): Promise<ConnectedSource>;
}

export interface ConnectedSource {
  readonly snapshot: ExternalCapabilitySnapshot;
  callTool(name: string, input: unknown, context: ConnectorCallContext): Promise<unknown>;
  readResource(uri: string, context: ConnectorCallContext): Promise<ExternalResourceContent>;
  dispose(): Promise<void>;
}
```

```ts
// src/application/externalSources/externalToolProvider.ts —— 投影为既有契约
function toAgentToolDefinition(
  source: ExternalCapabilitySource,
  tool: ExternalToolDescriptor,
): AgentToolDefinition {
  return {
    name: tool.qualifiedName,
    version: "1.0.0",
    description: sanitizeExternalText(tool.description),
    inputSchema: createExternalValueSchema(tool.inputSchema), // 收口后的校验器
    inputJsonSchema: projectModelVisibleJsonSchema(tool.inputSchema),
    outputSchema: z.unknown(),
    permissions: [`external.source.${source.id}`],
    riskLevel: "medium",   // 外部能力默认不视为只读
    sideEffect: "external",
    executionScope: "turn",
    policy: "ask",         // 未知外部副作用一律 fail-closed
    timeoutMs: 60_000,
    execute: (input, context) => callExternalTool(source, tool, input, context),
  };
}
```

## 六、能力映射与投影规则

| 外部能力 | 目标 Slot | 规则 |
|---|---|---|
| tools | `tool` | 名称 `mcp.<sourceId>.<localName>`；默认 `ask`；`hints` 只做展示 |
| resources | `context.source` | 读取结果固化进会话快照（`CHAT-REPLAY`），不保存远程临时 URL |
| prompts | 用户显式插入 | 不自动注入；不写入权威 prompt section |
| MRTR `inputRequests` | 审批卡片 + 新表单原语 | 允许 / 拒绝 / 取消 / 超时全部 fail-closed 并进 Journal |
| `subscriptions/listen` | 缓存失效 | 只订阅 `toolsListChanged` 等变更，不做常驻订阅洪流 |
| 未知能力与扩展字段 | 诊断 | 记入 `unsupportedCapabilities`，不抛错、不静默丢弃 |

### 6.1 渐进式工具曝光

外部工具定义默认**不进入模型上下文**。估算工具定义占用的上下文比例，超过阈值（默认 3%，可配）后只向模型
暴露一个 `search_tools` 元工具，按需加载完整定义。理由：官方客户端最佳实践给出的正是这条路径，而移动端
上下文预算比桌面更紧。

### 6.2 外部不可信输入的收口

- 工具名、描述、`instructions`、资源文本一律视为**外部内容**：限长、清洗、不作为权威指令拼接，
  UI 标注来源（`COMPAT-DATA`）。
- `inputSchema` 走独立收口策略：只接受已登记关键字，其余降级为 `unknown` + 客户端校验，
  并写入诊断。**不得**为此放宽 `.mttool` 的严格子集，也不得让外部 Schema 决定我们的执行语义。
- 外部 server 的注解（只读 / 破坏性提示）只作展示，授权一律由我们的 Tool Policy 决定。

## 七、安全与铁律落点

| 铁律 | 本设计的落点 |
|---|---|
| `ARCH-KERNEL` | 协议适配与 source 编排全部在 infrastructure / application / domain，Kernel 不新增任何概念 |
| `ARCH-FLOW` | 连接、配额、缓存、重放编排进 `application/useCases` 或应用服务，组件与 Hook 不直连 driver |
| `COMPAT-DATA` | 外部文本只作数据，不硬编码任何引导；未知能力一律降级 |
| `PLATFORM-MOBILE` | 只走 Streamable HTTP；stdio 子路径进禁止清单；OAuth 回调与网络出口经 Native Adapter |
| `CONFIG-TRACKS` | source 配置是用户数据（设置 + Zod 校验），不进 `VITE_*`，不新增环境变量直读 |
| `QUALITY-TYPES` | 外部输入用 `unknown` + 收口，不新增 `any`；单文件 ≤1000 行 |
| `CHANGE-SAFE` | source 记录带 `schemaVersion` 与迁移入口；新增能力类型只增投影器 |
| `TEST-CONTROLLED` | 用官方 Inspector 的 composable test servers 作为本地夹具，不依赖外部服务与 CDN |

### 7.1 自动化守卫（`tests/suites/architectureBoundaries.test.ts` 新增）

1. `src/` 中除 `src/infrastructure/externalSources/mcp/` 外，禁止出现 `@modelcontextprotocol/` 导入。
2. 全仓库禁止 `@modelcontextprotocol/client/stdio`。
3. `src/kernel/` 禁止导入 `@modelcontextprotocol/*` 与 `src/domain/externalSources/`。
4. 领域层不得出现协议专有名词（`mcp` 只允许作为 `kind` 取值字符串与文档说明）。

## 八、分阶段实施

| 阶段 | 内容 | 完成条件 |
|---|---|---|
| M0 只读连接 | source 配置与存储、`ConnectorDriver` 端口、MCP driver（Streamable HTTP + era 协商 + `server/discover`）、`tools/list` 只进诊断页；四条守卫与打包冒烟 | 能连上一个真实远端 server，看到能力清单；bundle 无 Node 内置依赖且体积增量受控 |
| M1 工具执行 | `tools/call` 投影为 `AgentToolDefinition`，默认 `ask`，含取消/超时/配额与 Journal 重放 | 未授权不执行；拒绝、取消、超时、宿主不可用均安全结束 |
| M2 认证 | CIMD 优先 + DCR 回退、Native Adapter 回调、凭据按 issuer 隔离、（可选）DPoP | 令牌不进 Profile、日志与备份明文 |
| M3 上下文 | resources → `context.source`、prompts 显式插入、结果快照固化 | 远端变化不会静默改变旧会话 |
| M4 交互 | MRTR 表单、`ext-tasks` 长任务、变更订阅与缓存失效 | 中断与拒绝可重放 |
| M5 反向角色 | 以 `shared/` 版本化 Host Protocol 对外暴露自身能力 | 先过路线 §11.6 立项门槛，不进本期 |

每阶段都必须先定义边界、权限、失败路径与迁移策略，再接入组合根。

## 九、现成可用内容（不重复造）

- **官方 SDK v2**：`@modelcontextprotocol/client` / `core` 已在依赖中，版本与我们的 zod 4 对齐，无重复依赖。
- **官方 Registry**（`registry.modelcontextprotocol.io/v0/servers`）：数千条目，绝大多数是 `streamable-http`，
  可直接作为能力来源，无需自建目录。
- **官方 Inspector**（web / CLI / TUI）与它的 composable test servers：开发期对照与本地回归夹具。
- **官方扩展**：`ext-apps`（会话内联交互 UI，映射既有 Sandbox 渲染能力）、`ext-tasks`（长任务轮询）、
  `ext-auth`（客户端凭据 / 企业托管授权）、Skills over MCP。
- **官方指南**：Client Best Practices（渐进发现与代码模式）、Authorization（PRM RFC 9728 + OAuth 2.1）。

## 十、M0 实施记录（2026-10-05）

已落地：

- `src/domain/externalSources/`：中立契约、Connector 注册表（kind/transport 由注册表解析）、外部 JSON Schema
  收口策略（未登记关键字降级并记录原因，不放宽 `.mttool` 严格子集）。
- `src/application/externalSources/externalSourceService.ts`：配置校验、driver 解析、取消与释放收口。
- `src/infrastructure/externalSources/mcp/mcpConnectorDriver.ts`：唯一的 MCP SDK 导入点，仅 Streamable HTTP。
- `tests/vitest/externalSourceMcp.test.ts`：本地夹具（`createMcpHandler` + `toNodeHandler`，127.0.0.1 临时端口）。
- `tests/vitest/externalSourceMcpLive.test.ts`：远端实机验收，默认跳过，需显式给 `MCP_LIVE_SERVER_URL`。
- `tests/suites/architectureBoundaries.test.ts`：四条守卫（仅 mcp 目录可导入 SDK、禁 stdio 子路径、Kernel 不得触碰、
  契约目录必须存在）。

实测结论：

| 项目 | 结果 |
|---|---|
| 本地夹具（现代入口） | 协商到 `2026-07-28`，能力快照、工具调用、释放全部通过（8/8） |
| 真实远端 `mcp.deepwiki.com` | server 为 `DeepWiki/2.14.3`，协商结果为 **2025-11-25（legacy 世代）**；`auto` 探测正确回退，3 个工具成功投影，`experimental` 能力按设计进入 `unsupportedCapabilities` 而非静默丢弃 |
| 浏览器打包 | 主构建无 `cross-spawn`/`child_process`；驱动单独做 browser 目标打包无任何 node 内置引用 |
| 体积 | 驱动 + SDK 单独打包 **minified ≈328 KB / gzip ≈90 KB**，因此接入组合根时必须**动态 import 懒加载**，不能进主 chunk |

需要注意的两个实现事实：

1. 服务端现代入口是 `createMcpHandler(factory)` + `toNodeHandler`，直接 `connect(new NodeStreamableHTTPServerTransport(...))`
   只服务 legacy 时代，`server/discover` 会返回 `-32601`。
2. WebView 与测试环境不同：happy-dom 的 `fetch` 会施加浏览器同源策略，Node 与真实 WebView 都不会。
   涉及真实网络传输的测试必须使用 `node` 环境。

尚未接入：应用组合根、设置页/诊断页入口、工具执行（M1）、认证（M2）。当前 `src/` 中没有任何应用代码引用该
driver，因此它会被 Vite tree-shake —— 这是 M0 的已知状态，接入时机在 M1。

## 十一、风险与未决

### M1 实施记录（2026-10-05）

已落地：

- `src/infrastructure/externalSources/externalSourceStorage.ts`：来源配置的独立 IndexedDB（`MobileTavernExternalSourceDB`），
  刻意不改主库版本；只保存配置与凭据引用。写入前经 Zod 收口，存储元数据（createdAt/updatedAt）不进严格 Schema。
- `src/application/externalSources/externalSourceUseCases.ts`：设置页使用的用例门面。
- `src/application/services/ExternalSourceRuntimeService.ts`：运行时服务（`KernelServices.ExternalSources`），
  把外部工具投影为既有 `AgentToolDefinition`（`policy: "ask"`、`sideEffect: "external"`、`executionScope: "external"`、
  权限 `external.source.<id>`），支持组合快照扩展、内容块压平、结果体积上限、逐来源失败隔离。
- 组合根：`src/application/bootstrap/serviceCatalog.ts` 新增一条声明式懒加载项；协议 driver 再由运行时服务
  动态 import，未配置来源的用户完全不会加载 MCP SDK。
- 设置页：插件分区新增「外部能力」子页（`ExternalSourceManagerSection`），支持新增、启停、删除与「探测能力」，
  组件只调用用例与运行时服务，不直连存储或协议 SDK；订阅 `UnifiedAppContext` 时使用选择器。

实测结论：

| 项目 | 结果 |
|---|---|
| 运行时集成（真实 AgentRuntimeService + 本地 MCP 夹具） | 工具以 `mcp.<source>.<tool>` 注册，`policy` 为 `ask`；执行经真实外部连接返回压平文本；来源停用后执行立即抛 `EXTERNAL_SOURCE_REVOKED` |
| 失败隔离 | 一个来源不可用时只写入 `failures`，其它来源的工具有效 |
| 存储 | fake-indexeddb 走真实 IDB 协议；非法配置（endpoint/id/kind）在落库前被拒 |
| 真实构建 | `vite build` 产出独立 `mcpConnectorDriver` chunk（213 KB / gzip 58 KB），主包仅增加约 5 KB，且无 Node 内置引用 |

仍未做：凭据与 OAuth（M2）、resources/prompts 接入上下文（M3）、MRTR 表单与 `ext-tasks`（M4）。

### M2a 实施记录（2026-10-05，静态凭据）

先做静态凭据而不是直接上 OAuth：注册表里绝大多数 server 要的是 API Key / Bearer，而不是完整授权码流程，
静态注入能立刻让真实 server 可用，同时不引入回调与令牌刷新复杂度。

- 来源配置新增非秘密字段 `authHeader`（默认 `Authorization`）与 `authScheme`（`bearer` 默认 / `raw`），
  秘密本身存在独立凭据库：`MobileTavernExternalSourceDB` 升到 v2，新增 `credentials` 与 `meta` 两个 store，
  密钥独立于主库 settings 密钥，落盘前用 AES-GCM 加密。
- 凭据键优先取 `authRef`，缺省用来源 id；删除来源时连带删除凭据，避免孤儿秘密。
- 注入点在 driver 的传输层（`requestInit.headers`）：driver 只消费**已解析**的请求头，不接触凭据来源；
  解析留在应用层，默认实现在基础设施，测试可注入。
- 凭据状态查询只返回「是否已配置 + 更新时间」，任何接口都不回传秘密明文；秘密不落日志、不进备份、不进组合快照。
- 设置页「外部能力」子页新增按来源的凭据录入/清除与配置状态显示，保存后自动 reload 使凭据立即生效。

实测结论：

| 项目 | 结果 |
|---|---|
| 真实注入 | 本地夹具在 HTTP 层观察到 `Authorization: Bearer <secret>`；未配置凭据时不发送任何认证头 |
| 落盘形态 | 凭据记录落盘为密文，状态接口与原始记录都不含明文 |
| 映射规则 | 默认 `Authorization: Bearer`；自定义头名 + `raw` 直接原样写入；无秘密返回 `undefined` |

仍未做（M2b）：OAuth 2.1（PRM 发现、CIMD 优先 / DCR 回退、Native Adapter 回调、按 issuer 隔离凭据、可选 DPoP）。

1. **生态处于世代交替**：大量在册 server 仍是 legacy 时代。`era` 默认 `auto`（先探测再回退），并允许用户
   固定，避免探测静默 legacy server 时的挂起。
2. **提示注入**：外部工具描述与资源文本会进入模型上下文，必须标注来源并限长；不接受把外部文本放进
   权威 system 位置。
3. **JSON Schema 放宽**：2026-07-28 允许任意 JSON Schema 2020-12 关键字，收口策略的覆盖面需要按真实
   生态抽样回归，而不是只覆盖规范示例。
4. **移动端网络出口**：WebView 的 CORS 与原生代理路径需要在 M0 的打包冒烟中一并验证。
5. **未决**：渐进发现的阈值、每个 source 的默认配额、以及是否在首期提供 `ext-apps` 渲染，待 M0/M3
   实测后再定。

### 资源取用的路径收敛（防止同一目的出现两条路）

外部内容进入模型只有两种合法理由，且各自只有一条路径：

| 谁决定取用 | 唯一路径 | 状态 |
|---|---|---|
| 用户或模型主动取用 | 只读工具 `mcp.<source>.resources.list` / `mcp.<source>.resources.read` | 已落地（M3a） |
| 系统自动注入 | 未来的通用 `context.source` 缝（当前代码中并不存在，只有 `compat.context-source`） | 需独立立项 |

约束——任何新增的"把外部内容送进模型"的机制，必须先回答"我属于上表哪一行"，两者都不是即视为设计缺陷：

- MCP 资源**永不迁入** `context.source`；将来建设通用缝时不得为 MCP 资源再开第二条读取路径。
- `context.source` 不承载"用户点选某个远端资源"这类交互，那属于工具。
- 资源读取自带审批与 Journal，因此工具路径本身就满足 `CHAT-REPLAY`，不需要额外的会话快照字段。
- 往提示词模板里写外部内容、或绕过工具直接拉取远端内容，都属于违反本表的做法。
- 推送式上下文的通用落点见[通用上下文来源缝设计](context_source_seam_design.md)；MCP 资源不在该缝的范围内。

### M3c 实施记录（2026-10-06，工作台接入与直连测试入口）

- **接入界面**：`ThirdPartyMcpImportModal` 支持导入第三方 `mcpServers` 配置 / 单个 URL / 预置模板 / 手动添加，
  解析在 `thirdPartyMcpParser` 中纯数据完成（不执行外部脚本），stdio 本地进程在移动端被拦截并给出原因。
  鉴权头与鉴权方案经唯一转换入口 `presetToFormValues` → `formValuesToCandidate` 带出，秘密只进加密凭据库。
- **能力视界**：`ToolCapabilitiesWidget` 提供巡检、测速、工具清单、诊断与删除；只读取运行时内存快照
  （`IExternalSourceRuntimeService.getSnapshot`），不发网络请求；「重新探测」走既有 `probe`（连一次即释放）。
- **用户直连测试入口（本表之外的显式例外）**：工作台的「测试调用」经
  `IExternalSourceRuntimeService.testCallTool` **直接**调用已连接工具的 `callTool`，单次、**不进审批链、不写 Agent Journal**。
  允许它存在的唯一理由：它是用户自己点出来的诊断动作，等价于「探测」，与被模型驱动的工具路径不同源。
  因此它有三条硬约束——① 只允许工作台 UI 调用，任何 Agent / Prompt / 兼容层路径都不得引用；
  ② 仍复用 `assertSourceActive`，来源停用/删除后立即 `EXTERNAL_SOURCE_REVOKED`；
  ③ 它**不构成**"把外部内容送进模型"的第三条路径（结果只显示在工作台面板里，不进入 Prompt 或会话）。
  若将来需要让模型试调，必须走既有 `policy: "ask"` 工具链，不得扩展此入口。

### M3a 实施记录（2026-10-05，资源只读工具）

- 来源声明了资源时，运行时额外派生两个工具：`resources.list`（只读元数据，`policy: "allow"`、
  `sideEffect: "none"`）与 `resources.read`（`policy: "ask"`、`sideEffect: "external"`）。
- **读取白名单收口**：`resources.read` 只接受连接期由 server 自己声明过的 URI，其它一律
  `EXTERNAL_SOURCE_RESOURCE_NOT_ADVERTISED`——模型无法借宿主去抓任意 URI。
- 派生工具与来源自带工具重名时**跳过派生**，不覆盖 server 自己的声明。
- 读取内容同样受限长与结果体积上限，并复用逐来源撤销检查（来源停用后立即失败）。

**M3b 已落地（2026-10-05）**：`prompts/*` 的用户侧取用改为注册到**通用输入框命令缝**
（`ComposerCommandService`，见 [通用上下文来源缝设计](context_source_seam_design.md) 的 C4 记录），
不再需要复制 Tool Plugin 的私有 composer 表。来源连接后，每个提示词模板注册为
`mcp.<sourceId>.<prompt>` 命令：用户输入 `/` 选用、可选带一个参数（映射到提示词声明的第一个参数），
取回内容**只回填输入框草稿、绝不自动发送**；执行前重新确认来源仍启用，撤销立即失效。
由于是用户主动取用，走的是草稿路径而不是注入路径，与「资源取用路径收敛」不冲突。

## 十二、权威入口

- 产品方向：[product_direction.md](product_direction.md)
- 分阶段边界与远期门槛：[agent_plugin_runtime_roadmap.md](agent_plugin_runtime_roadmap.md)
- 模块边界：[runtime_boundaries.md](runtime_boundaries.md)
- 隔离开发流程：[isolation_development.md](isolation_development.md)
- 活跃待办：[../../TODO.md](../../TODO.md)
