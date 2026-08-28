# 模块边界契约文档

> 本文件将散落在代码注释中的关键模块间契约提取为独立文档，便于新贡献者快速理解边界约束。
> 任何修改这些契约的代码变更必须同步更新本文档。

---

## 1. IndexedDB 事务完成时序契约

### 契约规则

**所有 readwrite 事务的写操作，Promise resolve 点必须是 `transaction.oncomplete`，不能是 `request.onsuccess`。**

- `request.onsuccess` 仅表示请求入队成功，不保证事务已 commit
- 跨事务读取时，若上一事务尚未 commit，读取的是旧数据，导致时序竞态
- readonly 事务不受此约束（读操作用 `request.onsuccess` resolve 是安全的）

### 标准模式

```typescript
return enqueueWrite(async (ctx) => {
  const db = await getDB();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("store", "readwrite");
    const request = transaction.objectStore("store").put(record);
    request.onerror = () => reject(request.error);
    // resolve 必须在 oncomplete，不能在 onsuccess
    transaction.oncomplete = () => resolve();
    bindTransactionAbort(ctx, transaction, reject);
  });
}, key, signal);
```

### 涉及文件

| 文件 | 说明 |
|------|------|
| `src/infrastructure/storage/idbQueue.ts` | `bindTransactionAbort` / `bindReadonlyTransactionAbort` helper |
| `src/infrastructure/storage/indexedDbMemoryStore.ts` | 所有 readwrite 事务均遵循 oncomplete 契约 |
| `src/infrastructure/storage/repositories/*.ts` | Repository 层写操作均遵循 oncomplete 契约 |
| `src/infrastructure/plugins/pluginStorage.ts` | `transactionDone` helper 封装 oncomplete 模式 |

### 违规检测

- 代码审查：搜索 `readwrite` 事务中的 `onsuccess.*resolve` 模式
- 测试：fake-indexeddb 不复现此问题，需依赖真实 WebView 集成测试

---

## 2. SafeProxy 降级语义契约

### 契约规则

1. **仅非关键服务**缺失时返回 SafeProxy，关键服务缺失抛 FATAL 错误
2. **关键业务路径**必须用 `kernel.hasService(name)` 显式判断，不能依赖 SafeProxy 降级
3. SafeProxy 属性访问有**接管计数器**，达到阈值（10 次）上报 `safe_proxy_threshold_exceeded` 遥测
4. Kernel 重建（HMR/测试）时通过 `resetSafeProxyState()` 清理模块级状态

### 关键路径 vs 降级路径

| 场景 | 正确做法 | 错误做法 |
|------|----------|----------|
| PromptService 表格记忆初始化 | `if (kernel.hasService("memory"))` | `const svc = getService("memory"); if (svc)` |
| useChat memoryService 注入 | `hasService ? getService : undefined` | 直接 getService 后检查 truthy |
| 非关键 UI 装饰功能 | 可依赖 SafeProxy 降级 | — |

### SafeProxy 行为

- `get` trap：返回新的 SafeProxy（链式降级）
- `then` 属性：返回 `(resolve) => resolve(undefined)`，防止 await 永久挂起
- `has` trap：暴露 `SAFE_PROXY_SYMBOL` 供 schema 校验识别
- 开发严格模式：属性访问直接抛 DevError
- 生产模式：首次告警 + 阈值遥测

---

## 3. Kernel 服务生命周期契约

### init 拓扑排序

- `registerServiceBatch` 用 Kahn 算法按 `dependencies` 计算拓扑顺序
- 被依赖的服务先 init，依赖者后 init
- 必选依赖初始化失败后，依赖者不得继续启动；整个批次拒绝并回滚已成功注册项
- `optionalDependencies` 不参与拓扑（缺失不阻止启动）

### destroy 拓扑逆序

- `computeDestroyOrder()` 基于依赖关系计算销毁顺序
- **出度为 0**（没人依赖它）的服务先销毁
- 销毁后递减其依赖项的出度，归零则入队
- 循环依赖兜底：未排序服务按注册顺序逆序追加

### 规则

- 若 A 依赖 B，则 A 必须先于 B 销毁（A 的 destroy 钩子可能需要调用 B）
- 单服务与批量注册均返回基于实例身份的 disposer；旧 Scope 不得销毁同名后注册替代服务
- 应用组合根把核心服务批次、默认中间件、Capability 与 UI Slot 统一挂入 Application Scope
- `destroyService` 有 5 秒超时，超时后 abort 并继续
- destroy 完成后调用 `resetSafeProxyState()` 清理模块级缓存

---

## 4. React 异步操作卸载保护契约

### 契约规则

组件卸载后，fire-and-forget 异步操作的 `.then` 回调不得调用 `setState`。

### 标准模式

```typescript
const isMountedRef = useRef(true);
useEffect(() => () => { isMountedRef.current = false; }, []);

// fire-and-forget 调用
someAsyncOp().then(() => {
  if (!isMountedRef.current) return;  // 卸载守卫
  setState(...);
});
```

### 涉及位置

| 文件 | 场景 |
|------|------|
| `src/hooks/useChat.tsx` | fire-and-forget 元数据更新完成后的界面同步 |
| `src/hooks/useChat/useChatUI.ts` | `triggerScroll` setTimeout 卸载清理 |

### 注意

- 数据落盘操作仍然应该完成，只是不在卸载后更新 React state
- `setTimeout` 必须在 `useEffect` cleanup 中 `clearTimeout`

---

## 5. Pipeline 三态语义契约

### 三个执行阶段

1. **preprocess（前置）**：中间件按优先级顺序执行，可修改输入
2. **handler（核心）**：唯一核心处理器执行
3. **postprocess（后置）**：中间件按优先级逆序执行，可修改输出

### 异常策略

- 任一中间件抛出异常，整个 pipeline 中止并向调用方 reject；生产日志不能把失败转换为成功结果
- 漏调 `next()` 且未显式 `interrupt()` 属于失败，必须 reject；只有 `interrupt()` 是正常受控终止
- 调度器会等待已调用的 `next()`，即使中间件漏写 `await` 也不会让外层执行提前完成；新代码仍必须保留 `await next()` 以维持清晰的洋葱模型语义
- `context.isInterrupted` 只是本次执行的可观测输出；预置或手改该字段不能替代 `interrupt()` 或绕过管道
- 中间件超时（`MSG_TIMEOUT_MS = 5000ms`）触发 abort 熔断
- 超时不阻断事件链，后续订阅者仍会收到消息

---

## 6. AbortSignal 协作式中断契约

### 契约规则

1. 所有异步操作接受可选 `AbortSignal` 参数
2. `AbortSignal` 仅作协作式中断，不强制透传至底层
3. IDB 写队列通过 `bindTransactionAbort` 将 signal 传导至 `transaction.abort()`
4. 超时保护通过 `AbortSignal.timeout()` 或 `setTimeout + controller.abort()` 实现

### AbortSignal.any 兼容性

- 环境支持 `AbortSignal.any` 时优先使用
- 不支持时手动用 `AbortController` 合并多个 signal
- **不得**在回退时丢弃超时保护

### 事件监听器清理

- `addEventListener("abort", fn, { once: true })` 自动清理
- 长生命周期监听器必须在完成后 `removeEventListener`
- `useEffect` cleanup 中必须移除所有 signal 监听器

---

## 7. 多数据库物理隔离契约

### 数据库划分

| 数据库 | 用途 | 版本 |
|--------|------|------|
| `MobileTavernLiteDB` | 主数据库（角色/会话/消息/记忆/设置） | v14 |
| `MobileTavernPluginDB` | 插件数据库（包元数据/存档/文件字节） | v2 |
| `MobileTavernResourceDB` | 用户本地界面资源（主题图片/视频/音频的元数据与文件字节） | v1 |
| `MobileTavernAttachmentDB` | 消息附件元数据、引用状态与媒体字节 | v1 |
| `MobileTavernAgentJournalDB` | Agent Turn、Provider/媒体决定、Tool Call/审批/Result | v1 |
| `MobileTavernToolPluginDB` | External Tool Plugin Manifest、Artifact、加密凭据、授权状态与最多 8 个历史版本 | v2 |
| `MobileTavernSessionBackupDB` | 收藏会话元数据与不可变完整备份版本 | v1 |

### 隔离规则

- 各数据库的连接管理独立，互不影响
- 插件数据库的 schema 升级不触发主数据库的 `onupgradeneeded`
- 插件数据库的写操作不经过主数据库的 `enqueueWrite` 队列
- 本地界面资源不得写入 `settings` 大对象，也不得借用插件包数据库；资源元数据与文件字节必须分 Store 保存。
- 资源 Blob URL 只能由 `LocalResourceService` 创建和回收；React UI 不能直接读取资源 Repository。
- 跨主题和后续 UI 插件持久化引用统一使用 `tavern-resource://<id>`，运行时必须经 `LocalResourceService.resolveResourceReference()` 解析，禁止持久化会话级 Blob URL。
- 消息只持久化 `att_*` 引用，附件元数据与字节分别进入 `metadata`、`contents` Store；聊天 UI 只能通过 `AttachmentService` 读取和创建 Blob URL。
- 主消息库与附件库不能共享 IndexedDB 事务：新附件先进入 `staging`，消息事务成功后从权威消息快照重建引用并转为 `committed`；最后引用移除后进入 `orphaned`，启动修复和 GC 负责崩溃恢复。
- Agent Journal 只保存可重放的安全数据，不得写入 Profile config、API Key、访问令牌或 Processor 私有输入；会话删除必须同步清理 Journal。
- Tool Plugin 数据库只保存通过严格 Schema、包限制与规范化 SHA-256 校验的 Manifest、单入口 Artifact、启用状态、权限授权、加密凭据和版本历史；Artifact 与凭据分 Store 保存，执行由应用层 Runtime 编排，不得与 `.mtplugin` 包数据库混用。
- Tool Plugin 新安装或升级默认停用且无授权；缺少必需权限时禁止启用，撤销必需权限必须自动停用。回滚必须停用并清空授权，卸载必须删除当前 Manifest、全部历史版本和授权状态。
- v6 完整备份必须携带消息引用的附件字节和 Agent Journal；覆盖恢复先验证引用与会话归属，再将附件字节、状态和反向引用在附件库单事务中一次提交，随后替换 Journal 与主库。主库提交后禁止再执行可能失败的附件引用重建；主库提交前任一步失败都必须恢复旧附件引用快照与 Journal。
- 收藏会话备份必须先写入新的不可变版本、回读并校验 SHA-256，再切换元数据指针和回收旧版本；任一步失败时旧指针与旧载荷必须保持可恢复。载荷只包含目标会话完整消息、摘要/插件状态、角色卡快照、目标会话记忆、引用附件与 Agent Journal，不得包含全局设置或凭据。

---

## 7.1 Message Content V2 与 Provider 投影契约

- `messages` Store 的 V1 记录继续使用 `content: string`；V2 记录使用 `contentVersion: 2` 和唯一权威的 Content Parts 数组，不得并列持久化派生文本字段。
- 运行态 `Message.content` 是 V2 文本 Part 的兼容投影，供旧 UI、Prompt、摘要和记忆链路使用；编辑文本时必须同步改写 Content Parts，并原位保留附件。
- Content Parts 只保存通用的 `text/image/audio/video/file` 语义和 `assetId`，不得保存 OpenAI、Anthropic 或其他 Provider 方言。
- Provider 请求投影发生在应用用例边界，并读取已注册 Provider 的声明式能力。能力未知时默认拒绝；图片可直投 OpenAI-compatible `image_url`，音频通过 ASR 转写，视频通过关键帧降级，不支持的媒体或方言必须明确报错，禁止静默丢弃。
- 图片、音频、视频和文件的原件不得进入 `sessions`、`messages` 或 `settings` 大对象；Blob URL 不得持久化。

## 7.2 AgentHandle、Provider、Tool 与媒体处理契约

- React 聊天端只持有 AgentHandle 和界面状态；现有发送链由格式中立的 `mobile-tavern.chat.driver` 包装，不得绕过 AgentHandle 新增第二条发送入口。
- AgentHandle 同一时刻只允许一个活跃 Turn；`stop()`、Handle 销毁和 Runtime 销毁必须中止 Turn，并等待清理完成后移除活跃句柄。
- Driver、Provider、Tool 与媒体 Processor 使用稳定 ID/版本注册，每次注册返回基于实例身份的 disposer；重复 ID 必须拒绝，Profile Scope 卸载后不得残留贡献。
- Tool 输入和输出都必须经过 Schema 校验；执行前检查权限，使用有限超时和 Turn AbortSignal；Call、Result、失败与最终 Turn 状态按序进入 Agent Journal。
- Tool 必须声明风险级别、副作用、执行 Scope 与 `allow` / `deny` / `ask` 策略；具有副作用或高风险的 Tool 不得默认 `allow`。`ask` 只能授予单次 Call，审批取消、超时、宿主不可用和最后一个审批 UI 卸载均按拒绝处理。
- Tool 可见性由会话 Composition Snapshot 的 `tool` Contribution 冻结；旧会话不得因当前 Profile 增加 Tool 而静默获得能力。审批请求与决定复用 Agent Journal，并由聊天投影展示，不建立第二套日志或授权存储。
- OpenAI-compatible 流式 `tool_calls` 必须按 index 聚合分片名称与 JSON 参数；每一步经当前 Turn 的 `executeTool` 执行后，以 Assistant `tool_calls` 和 Tool Result 消息继续请求。循环必须有固定上限，停止、超限和非法参数均进入现有失败/取消语义。
- Provider 必须声明输入模态、MIME/数量/大小限制、流式与工具能力；实际 Provider/模型选择及 `MediaProjectionDecision` 写入 Journal，重试不得重新猜测。
- 音频 ASR 结果作为模型可见文本写回 V2 消息；视频关键帧作为派生附件 ID 写回 video part，使重发、分支、备份与 GC 能从持久化事实重建。

### LLM Provider 防腐契约

- Provider 身份必须由解析后的 URL hostname 与模型 ID 共同判定，禁止通过查询串或路径字符串伪装官方端点；未知中转站使用保守能力默认值。
- 请求字段白名单、模型能力裁剪、关闭思考方言、工具消息修正与历史 `reasoning_content` 回放统一由 `src/application/services/llmCompatibility/` 处理。发送与重生成不得各自维护厂商判断。
- 流式响应先归一为内部 `StreamChunk`，再进入聊天消费端；OpenAI-compatible 别名、DashScope 包装、Gemini candidates 与 Anthropic SSE 的外部字段不得越过该边界。
- 运行时参数自愈只允许关闭已确认不支持的能力，缓存键至少包含规范化完整 Base URL 与模型 ID；一个中转站或租户路径的失败不得污染其他端点。
- DeepSeek、GLM 与 Qwen 的历史思考内容只在 Provider 请求投影中回放，不写入通用 Content Parts；同一工具循环中的 Assistant Tool Call 必须携带本步骤已返回的思考内容。

## 7.3 受控 Tool Plugin 管理契约

- `mobile-tavern.tool-plugin` v1 Manifest 必须声明来源、版本、规范化内容哈希、最低 Runtime、目标 Profile、依赖、权限、Tool Schema、风险、副作用、执行 Scope 和清理策略。
- 用户导入仅允许 `worker` 或 `sandbox` 执行位置；`app` 进程执行必须在 Schema 边界拒绝。Tool 不得使用 Manifest 未声明的权限，具有副作用的 Tool 不得标记为低风险。
- React 管理界面只能通过 `toolPluginManagementUseCases` 访问独立存储。`ToolPluginRuntimeService` 只为已启用、兼容、依赖可用、权限与必需凭据齐全的 v2 插件注册 Tool；外部 Worker 每次调用新建并回收，只能通过宿主代理使用 Manifest 声明的 HTTPS 网络能力。

---

## 8. 遥测上报契约

### 上报通道

| 函数 | 用途 | 时机 |
|------|------|------|
| `reportImmediate` | 即时上报 | SafeProxy 接管、关键错误 |
| `reportUsage` | 用量上报 | 性能指标、功能使用 |
| `reportDbQueueTimeout` | 队列超时 | 写队列堆积 |

### 安全要求

- 遥测管道自身异常不得影响 Kernel 主流程
- `detail` 字段不得包含 `sk-*` / `Bearer *` / 邮箱等敏感模式
- Rust 侧落盘前应正则扫描过滤

---

## 9. 会话消息与摘要完整性契约

### 消息单一来源

- `sessions` Store 只保存会话元数据，`messages` Store 是消息正文的唯一权威来源。
- 查询会话时必须丢弃旧版本记录中残留的内嵌 `messages` 字段，再由应用用例分页水合；不得因为残留切片非空而跳过分页。
- React 中元数据与消息窗口分开保存；兼容 `ChatSession` 只作为投影视图，不能用于推断完整历史。
- 虚拟列表不替代存储分页；向上加载使用最早消息 ID 对应的绝对 `turnIndex` 游标，禁止数字 offset 作为页面边界。
- 会话目录的持续分页使用 `(createdAt, id)` 稳定游标；分页期间新增最近会话不得导致后续页面跳项。
- Prompt 历史从数据库按配置读取；重生成历史必须排除目标消息及其后续分支。

### Prompt 预设与最终消息包

- `SavedPresetBundle.promptPlan` 是新预设的唯一权威 Prompt 快照，当前版本为 `1`；`mode` 明确区分 `legacy` 与 `composition`，`source` 只记录来源，不参与通用编译。
- 旧 `composition` / `usePromptComposition` 仅作为读取降级字段；应用服务归一化后不再写回。完全缺少快照的旧预设必须回到 `legacy`，不能继承当前预设模式。
- SillyTavern Codec 只输出中立 `PromptComposition`。有 `prompt_order` 时按 100001 优先顺序导入；完全缺失时按 `prompts` 原顺序保留。
- `PromptAssemblyResult.messages` 是 Provider 投影前唯一权威消息；发送和重生成不得从 `systemInstruction + history` 再建第二份消息。
- 自由编排依次执行场景覆盖、领域编译、请求整形和最终 Token 审计。role wrapper、system squash 与 assistant prefill 的开销必须进入最终预算报告；不可裁剪内容超限必须产生明确错误诊断。
- Prompt 历史查询窗口同时满足编排历史块与世界书扫描；未声明 `chat_history` 只代表不发送历史，不代表禁用世界书触发上下文。

### 会话目录与删除安全

- 旧会话读取时默认补齐 `lifecycle=active`、`updatedAt=createdAt` 和正整数 `contentRevision`；消息、摘要、状态、分支或其他影响恢复结果的写入成功后必须单调推进修订号。
- “全部”只显示未归档原会话，“收藏”显示独立备份，“已归档”只显示归档原会话；搜索首期只覆盖权威会话名称和角色名称，不得把未水合消息冒充全文搜索。
- 普通会话不得永久删除；应用服务与数据库服务都必须校验 `lifecycle=archived`。删除角色卡不得级联绕过该守卫，有会话的角色卡必须先处理会话。
- 收藏后的源会话继续写入只产生 `outdated` 状态，不自动复制；手动更新失败时旧备份仍可恢复。源会话永久删除后收藏元数据与备份载荷继续保留。

### 消息事务与状态恢复

- 单条或多条输出通过 `commitSessionTurn` 同时提交消息、变量、状态表和聚合统计。
- 删除消息通过 `deleteSessionMessage` 同时回退统计，并失效该轮次及之后的摘要和派生记忆。
- 重生成通过 `replaceSessionBranch` 原子替换分支，不能先删旧分支再尝试保存新回复。
- 历史消息编辑通过 `updateSessionMessage` 原子提交正文和变量，并失效该轮次之后的摘要、状态快照及派生记忆。
- 后台记忆抽取写入词典、事件和事实前，必须在同一事务内确认来源消息仍属于目标会话。
- 完整导入通过 `replaceCompleteSessions` 替换旧消息集合，不能留下旧尾部或从 UI 切片计算统计；该命名用于阻止普通分页会话误调用完整覆盖语义。
- 助手输出携带版本化变量与状态表快照；历史分支和重生成优先恢复最近快照，旧 MVU 变量仅作为降级兼容。

### 摘要单调保存

- `updateSessionMetadata` 不得修改已有会话的 `summaries`、总结指针或消息统计，避免流式输出、标题或图片状态携带的陈旧快照覆盖时间线。
- 摘要追加、更新、删除分别经过 `appendSessionSummary`、`updateSessionSummary`、`deleteSessionSummary` 原子操作。
- 摘要操作不得使用会丢弃中间写入的同键“仅保留最新操作”合并；并发追加必须逐条提交。
- 删除中间消息时，该消息所在边界及之后的全部摘要都必须失效，不能只删除第一条命中摘要。

---

## 10. EffectScope 可撤销生命周期契约

### Scope 状态与释放顺序

- Scope 状态固定为 `active`、`disposing`、`disposed`；只有 `active` 状态允许增加 Effect 或创建子 Scope。
- `dispose()` 按注册逆序释放 Effect，保证后注册的上层资源先于其依赖回收。
- `dispose()` 幂等并复用同一释放 Promise；Effect 即使被提前释放，也只能执行一次。
- 提前释放与 `dispose()` 并发时，Scope 必须等待已经开始的 disposer 完成，不能提前进入 `disposed`。
- 子 Scope 以一个普通 Effect 挂入父 Scope，因此父 Scope 回收时按统一逆序规则回收子 Scope。

### 错误与回滚语义

- 单个 Effect 抛错不能阻止其余 Effect 释放。
- 全部清理结束后以 `EffectScopeDisposeError` 聚合错误，调用方负责记录或判定插件卸载失败。
- 插件初始化回滚必须复用 Scope 释放语义，不能维护第二套手写清理列表。

### Extension 注册身份

- `registerExtension()` 返回幂等 disposer，可直接加入 EffectScope。
- 同一扩展点和 ID 的后注册项替换旧项；旧 disposer 只能释放自己的注册记录，不得误删后注册替代项。
- Kernel 整体销毁后调用遗留 disposer 必须安全无副作用。

### Subscription 与 Pipeline 注册身份

- `subscribe()` 返回的 disposer 只释放本次订阅记录；同一 handler 的后注册项不能被旧 disposer 误删。
- 默认 Pipeline 由应用组合根显式注册，Kernel 销毁后重新启动必须重新建立命名 Pipeline。
- 快速路径必须按中间件注册身份判断完整标准集合，不能只比较数量或函数名。
- 应用组合层的 UI Slot 注册必须返回 disposer；异步装配失败时先回滚已注册项，再传播原始错误。

---

## 11. Runtime Plugin 与 Profile 装载契约

### 所属边界与信任级别

- `RuntimePluginDefinition`、Profile Loader 与 legacy runtime plugin 位于 `src/application/runtimePlugins/`；Kernel 只提供 Scope、注册和校验机制，不理解插件、Profile 或配置。
- 当前 Runtime Plugin 仅允许随 App 编译的受信代码。用户安装的 `.mtplugin` 继续使用强沙箱 Plugin Host RPC，不能共享 Runtime Plugin 权限。
- `src/application/runtime.ts` 只选择并挂载 Profile；现有服务、默认 Pipeline 和能力清单统一由 `mobile-tavern.legacy-runtime` 承接，禁止恢复三条散落的直接注册路径。
- 通用 Capability 清单由承载它的 Runtime Plugin 显式声明；注册器必须要求调用方传入清单，不得恢复全局 `capabilityCatalog.ts` 或隐式默认目录。
- 每个 Runtime Plugin 必须声明 Zod `configSchema`；Profile 引用的公开配置在任何 Effect 产生前完成解析。Capability Slot 使用类型化 Token 声明 `single`/`multiple` 基数与必选性，重复 Provider、Token 定义冲突、缺失必选 Binding、未知 Contribution 和错误基数必须拒绝装载。

### 解析、快照与失败语义

- Profile 必须校验稳定 ID、正整数版本、插件定义唯一性、引用唯一性和可选的精确版本约束。
- `requires` 必须完整存在并进行稳定拓扑排序；缺失依赖、重复依赖和循环依赖均在产生 Effect 前失败。
- 每个 Profile 与插件拥有独立子 Scope。插件应把每次注册立即加入自己的 Scope；初始化中途失败时由 Profile Scope 统一逆序回滚。
- 插件 `setup` 返回的 disposer 也由插件 Scope 托管；Profile 卸载按插件依赖逆序释放且保持幂等。
- `ResolvedRuntimeProfileSnapshot` 只保存 Profile ID/版本、插件 ID/版本、Provider Binding 与 Contribution 顺序。插件 config、API Key、令牌、服务实例与 Blob 均不得进入快照。
- Runtime Profile 偏好只保存内置引用或用户复制后的能力布尔值，并由 Zod 在 Infrastructure 边界校验；启动时重建为当前插件版本的定义，损坏或悬空选择回退 Tavern Agent并返回诊断。
- 内置 Profile 只读；用户必须先复制才能修改 Compatibility、音频 ASR 或视频关键帧开关。开关必须改变实际注册贡献，不能只改变 UI 文案。
- 会话 Composition Snapshot 一经创建不得被全局 Profile 静默覆盖；发送与重发在 Profile ID 不一致时必须阻止并引导显式切换。
- 从会话列表打开其他 Profile 的会话时，必须验证精确 Profile ID/版本并写入经过 Schema 校验的一次性恢复意图；重启装载目标组合后从数据库恢复目标会话和角色并清除意图，缺失或版本漂移不得继续重启。

---

## 12. Compatibility Host 与生态状态契约

- `CompatibilityRuntimeService` 是常驻但默认为空的 Application Host，只提供 Codec、Prompt Section、Context Source、Transform、State Reducer 和 Renderer 六类可撤销 Registry；它本身不得包含 SillyTavern 语义或依赖 React。
- `mobile-tavern.base` 不装载生态兼容实现；`mobile-tavern.tavern` 显式装载 `mobile-tavern.sillytavern-compat`。插件卸载必须逆序移除全部贡献、清理 Bridge 和生成状态，同一 Host 随后可以重新装载。
- Database、Prompt、Script、聊天 Hook 和消息 UI 只能依赖 Compatibility Host 契约，不得直接导入 `compatibility/sillytavern`，也不得直接读写 TavernHelper 全局字段。
- 插件私有会话状态单写 `runtimePluginState[pluginId]`；读取时优先命名空间、缺失时降级读取旧 `variables`。Compatibility Bridge 需要旧会话形状时只允许插件内部瞬时投影，保存边界必须归一化回命名空间并清除旧字段，不得因插件关闭或旧备份恢复静默丢失数据。
- `runtimePluginState` 进入统一备份；恢复时必须校验插件 ID、危险键名和对象边界。插件配置、凭据、媒体字节和运行实例不得写入该命名空间。

---

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-07-29 | 初始创建，提取 8 项关键契约 |
| 2026-08-13 | 增加会话消息单一来源与摘要原子保存契约 |
| 2026-08-20 | 增加元数据/消息窗口分离、游标分页、消息事务、完整导入和状态快照契约 |
| 2026-08-24 | 增加 EffectScope 逆序幂等释放、并发等待、错误聚合，以及 extension/subscription/Pipeline 注册身份契约 |
| 2026-08-24 | 增加 Application 层 Runtime Plugin/Profile 依赖解析、脱敏快照、Scoped 装载回滚与 legacy runtime 装配契约 |
| 2026-08-24 | 增加 AgentHandle、Provider/Tool/媒体 Processor、Agent Journal、会话组合快照与 v6 备份契约 |
| 2026-08-24 | 增加空 Compatibility Host、六类可撤销贡献、base/tavern Profile 隔离与插件状态命名空间契约 |
| 2026-08-24 | 增加 Runtime Profile 公开偏好、复制/开关/诊断 UI、会话快照切换守卫，并删除旧静态 Capability Catalog 与 legacy driver ID |
| 2026-08-24 | 完成插件配置 Schema、类型化 Capability Token/冲突校验、OpenAI 多步 Tool Loop、跨 Profile 会话自动恢复及兼容状态命名空间单写契约 |
| 2026-08-26 | 增加内置 Tool、会话冻结的 Tool 可见性、风险/副作用/Scope 策略、一次性审批与 fail-closed Journal 契约 |
| 2026-08-28 | 增加会话 active/archived 生命周期、修订投影、归档删除守卫和独立收藏备份版本切换契约 |
| 2026-08-29 | 增加 LLM Provider 身份解析、请求/响应防腐、思考回放和按完整端点隔离的参数自愈契约 |
