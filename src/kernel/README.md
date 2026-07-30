# Kernel 开发边界

`src/kernel/` 是与 Mobile Tavern 具体业务无关的通用运行时机制。它只负责容器、服务生命周期、Pipeline、消息总线、扩展注册、运行时契约和通用校验。

## 允许内容

```text
src/kernel/
├── Kernel.ts
├── KernelLifecycle.ts
├── Pipeline.ts
├── runtimeKernel.ts
├── types.ts
├── validation.ts
└── index.ts
```

Kernel 可以托管实现 `IKernelService` 的对象，但不拥有这些对象的业务含义。角色、会话、Prompt、记忆、LLM、存储、设置、插件和原生能力均属于应用层或适配层。

## 禁止内容

- 不得在本目录建立 `services/`、`bootstrap/`、业务工具或业务默认数据。
- 不得导入 `application/`、`domain/`、`infrastructure/`、`components/`、`hooks/` 或 `tabs/`。
- 不得直接调用数据库、应用遥测、角色卡兼容层或原生 Bridge。
- 不得因为某服务由 Kernel 注册，就把实现文件放进 Kernel。

## 正确开发路径

- 新应用服务：`src/application/services/`
- 服务装配与启动：`src/application/runtime.ts`、`src/application/bootstrap/`
- 纯领域规则：`src/domain/`
- 物理适配器：`src/infrastructure/`
- Pipeline 中间件：`src/services/pipeline/`

架构守卫位于 `tests/suites/architectureBoundaries.test.ts`。任何边界调整必须先修改 `AGENTS.md` 并获得用户明确授权。
