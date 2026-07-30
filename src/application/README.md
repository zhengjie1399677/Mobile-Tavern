# 应用层

`src/application/` 承载 Mobile Tavern 的应用服务实现和运行时组合，是具体产品业务与通用 Kernel 之间的装配层。

## 目录职责

```text
src/application/
├── runtime.ts        # 应用运行时组合根
├── bootstrap/        # 服务目录与默认 Pipeline 装配
├── services/         # 数据库、模型、Prompt、记忆、设置等应用服务
└── useCases/         # 业务初始化、分页、事务和跨 Service 流程
```

应用服务可以实现 `IKernelService`，并使用 Kernel 的生命周期、依赖排序、消息总线和 Pipeline，但不得把实现回迁 `src/kernel/`。

纯计算规则优先下沉到 `src/domain/`；IndexedDB、原生平台和外部系统细节归入 `src/infrastructure/` 或明确的适配器目录。应用服务只负责用例协调，不应成为新的大单体。

React Context 只保存界面状态。角色初始化、会话分页、级联存删、导入导出等流程必须先进入 `useCases/`，再调用 Service 或领域端口；Context 不得直接访问 Repository、`localDB`、Compatibility Runtime 或 Native Adapter。
