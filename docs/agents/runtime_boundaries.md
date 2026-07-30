# 运行时模块边界

本文用于回答 Kernel、兼容运行时、存储层、插件 RPC 和原生适配器为什么同时存在。它们面向不同变化源，不属于同一套服务体系。新增代码必须先判断所属边界，不得为了调用方便跨层互引。

## 一、权威路径

| 能力 | 权威入口 | 职责 | 禁止事项 |
|---|---|---|---|
| Kernel 通用机制 | `src/kernel/index.ts`、`src/kernel/types.ts` | 容器、服务生命周期、消息总线、Pipeline 与扩展契约 | 不放任何应用服务、业务装配、生态格式、存储或平台调用 |
| 应用运行时组合 | `src/application/runtime.ts`、`src/application/bootstrap/` | 把应用服务和默认 Pipeline 注册到 Kernel | 不反向改变 Kernel 的通用机制 |
| 通用数据库服务 | `src/application/services/DatabaseService.ts` | 面向上层提供通用 CRUD、分页与跨 Store 事务能力 | 不承载记忆召回、摘要或角色行为 |
| IndexedDB 物理实现 | `src/infrastructure/storage/` | 连接、Schema、事务队列、仓库和端口适配器 | 不反向导入 `src/utils/localDB.ts` |
| 冻结的存储兼容门面 | `src/utils/localDB.ts` | 旧版外部导入兼容与测试重置 | 不允许任何生产调用或新增导出；兼容期结束后删除 |
| SillyTavern Compatibility Runtime | `src/compatibility/sillytavern/` | 角色卡扩展、MVU、正则脚本和 iframe 兼容解析与降级 | 不注册为通用 Service，不承载存储或原生能力 |
| Plugin Host RPC | `src/domain/plugins/pluginHostRpc.ts` | 强沙箱插件的权限校验、输入清洗和脱敏 RPC | 不复用 Compatibility Runtime，不直接访问原生平台 |
| Native Adapter | `src/services/ar/NativeArAdapter.ts` | 将 Web 调用适配为 Tauri/Kotlin AR 命令 | 不承载第三方插件权限或角色卡兼容逻辑 |
| 应用用例层 | `src/application/useCases/` | 业务初始化、分页、级联流程和跨 Service 协调 | 不保存 React State，不直接渲染界面 |

## 二、允许的数据方向

```text
界面与业务组合
  ├─→ application/runtime ─→ Kernel 通用机制
  ├─→ React Context ─→ application/useCases ─→ 应用 Service
  ├─→ 应用 Service ─→ Repository/Adapter ─→ infrastructure/storage
  ├─→ 记忆领域端口 ───────────────────────→ IndexedDbMemoryPersistenceService
  ├─→ SillyTavern Compatibility Runtime
  ├─→ Plugin Host RPC
  └─→ Native Adapter ─→ Tauri IPC
```

`localDB.ts` 的仓库内生产调用已经清零。它只为尚未迁移的外部导入和测试重置保留，不再处于正常数据方向上。后续确认不存在外部依赖后应直接删除。

## 三、适配边界命名

- Compatibility Runtime：外部角色卡脚本生态与应用内部类型边界。
- Plugin Host RPC：强沙箱 iframe 与宿主权限边界。
- Native Adapter：Web 前端与 Android 原生能力边界。

旧 Bridge 名称仅作为兼容导出保留。三者的协议、信任等级和生命周期均不同，禁止合并为统一 Service 或统一 Bridge 基类。

## 四、回归守卫

`tests/suites/architectureBoundaries.test.ts` 固化以下约束：

1. 记忆领域不得绕过 `MemoryPersistencePort`。
2. `infrastructure/storage` 不得反向依赖 `localDB` 兼容门面。
3. `src/` 生产代码不得导入 `localDB`，该门面不得重新出现 IndexedDB 物理实现。
4. Compatibility Runtime、Plugin Host RPC、Native Adapter 不得相互导入。
5. `src/kernel/` 不得重新出现业务服务、页面业务、应用装配目录或对应用层的反向依赖。
6. React Context 不得直接访问存储、Compatibility Runtime、Native Adapter 或执行业务 Service 的持久化方法。

若确需改变这些方向，应先更新本文件与 `TECHNICAL.md`，说明新边界及迁移策略，再修改守卫。
