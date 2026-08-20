# 运行时模块边界

本文用于回答 Kernel、兼容运行时、存储层、插件 RPC 和原生适配器为什么同时存在。它们面向不同变化源，不属于同一套服务体系。新增代码必须先判断所属边界，不得为了调用方便跨层互引。

## 一、权威路径

| 能力 | 权威入口 | 职责 | 禁止事项 |
|---|---|---|---|
| Kernel 通用机制 | `src/kernel/index.ts`、`src/kernel/types.ts` | 容器、服务生命周期、消息总线、Pipeline 与扩展契约 | 不放任何应用服务、业务装配、生态格式、存储或平台调用 |
| 应用运行时组合 | `src/application/runtime.ts`、`src/application/bootstrap/` | 把应用服务和默认 Pipeline 注册到 Kernel | 不反向改变 Kernel 的通用机制 |
| 通用数据库服务 | `src/application/services/DatabaseService.ts` | 面向上层提供通用 CRUD、分页、轻量索引统计与跨 Store 事务能力 | 不承载记忆召回、摘要或角色行为 |
| IndexedDB 物理实现 | `src/infrastructure/storage/` | 连接、Schema、事务队列、仓库和端口适配器 | 不反向导入 `src/utils/localDB.ts` |
| 数据迁移应用服务 | `src/application/services/DataMigrationService.ts` | 聚合完整备份、统一脱敏，并委托基础设施以单事务覆盖用户数据 | 不在 React Hook 中直接清 Store 或跨 Repository 编排恢复 |
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

## 三、会话聚合与消息窗口

- `sessions` Store 只保存 `ChatSessionMetadata`、摘要和内部计数基线；旧记录中的内嵌 `messages` 读取时必须丢弃。
- `messages` Store 是消息正文的唯一权威来源。消息的展示字段、重生成字段和状态快照统一经过 `messageRecord.ts` 映射，禁止写入路径各自挑选字段。
- React 内部将会话元数据与已水合的 `ChatMessageWindow` 分开保存；对外兼容的 `ChatSession` 视图只是投影，不得反向作为全量历史写回数据库。
- 虚拟列表只减少 DOM 渲染量；消息分页通过最早消息 ID 对应的绝对 `turnIndex` 游标读取，会话目录分页通过 `(createdAt, id)` 游标读取，禁止使用会受并发新增影响的数字 offset 作为持续分页边界。
- 应用消息新增、编辑、删除或替换统一经过 `commitSessionTurn`、`updateSessionMessage`、`deleteSessionMessage`、`replaceSessionBranch` 跨 Store 事务；低层记忆消息原语不得顺带维护会话统计。
- 自动总结必须在本轮消息事务提交后读取权威消息 Store；不能在输出中间件尚未持久化助手回复时推进摘要边界。
- 角色删除由 Character Service 的聚合仓库在单事务内按 `characterId` 级联全部会话和记忆分轨，禁止遍历 React 已加载的会话分页执行删除。
- 备份恢复的 `replaceCompleteSessions` 是完整替换语义：同一事务内先清理旧消息，再写入最终消息并重算统计，禁止保留旧尾部；普通 UI 分页会话不得调用。
- Prompt 组装必须根据编排配置从数据库读取权威历史窗口；重生成必须传入目标消息边界，不能使用当前 UI 分页切片。
- 每次完成助手输出后，把变量和状态表快照绑定到该消息。重生成与历史分支优先恢复最近完整快照；旧 MVU 消息只作为变量降级来源，缺失的旧状态表不得伪造为可回放结果。

## 四、适配边界命名

- Compatibility Runtime：外部角色卡脚本生态与应用内部类型边界。
- Plugin Host RPC：强沙箱 iframe 与宿主权限边界。
- Native Adapter：Web 前端与 Android 原生能力边界。

旧 Bridge 名称仅作为兼容导出保留。三者的协议、信任等级和生命周期均不同，禁止合并为统一 Service 或统一 Bridge 基类。

## 五、回归守卫

`tests/suites/architectureBoundaries.test.ts` 固化以下约束：

1. 记忆领域不得绕过 `MemoryPersistencePort`。
2. `infrastructure/storage` 不得反向依赖 `localDB` 兼容门面。
3. `src/` 生产代码不得导入 `localDB`，该门面不得重新出现 IndexedDB 物理实现。
4. Compatibility Runtime、Plugin Host RPC、Native Adapter 不得相互导入。
5. `src/kernel/` 不得重新出现业务服务、页面业务、应用装配目录或对应用层的反向依赖。
6. React Context 不得直接访问存储、Compatibility Runtime、Native Adapter 或执行业务 Service 的持久化方法。

若确需改变这些方向，应先更新本文件与 `TECHNICAL.md`，说明新边界及迁移策略，再修改守卫。
