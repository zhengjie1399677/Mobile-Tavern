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
- `optionalDependencies` 不参与拓扑（缺失不阻止启动）

### destroy 拓扑逆序

- `computeDestroyOrder()` 基于依赖关系计算销毁顺序
- **出度为 0**（没人依赖它）的服务先销毁
- 销毁后递减其依赖项的出度，归零则入队
- 循环依赖兜底：未排序服务按注册顺序逆序追加

### 规则

- 若 A 依赖 B，则 A 必须先于 B 销毁（A 的 destroy 钩子可能需要调用 B）
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
| `src/hooks/useChat.tsx` | fire-and-forget `saveSession` 的两处 `.then` |
| `src/hooks/useChat/useChatUI.ts` | `triggerScroll` setTimeout 卸载清理 |

### 注意

- 数据落盘操作（如 `saveSession`）仍然应该完成，只是不更新 React state
- `setTimeout` 必须在 `useEffect` cleanup 中 `clearTimeout`

---

## 5. Pipeline 三态语义契约

### 三个执行阶段

1. **preprocess（前置）**：中间件按优先级顺序执行，可修改输入
2. **handler（核心）**：唯一核心处理器执行
3. **postprocess（后置）**：中间件按优先级逆序执行，可修改输出

### 异常策略

- 任一中间件抛出异常，整个 pipeline 中止
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

## 7. 双数据库物理隔离契约

### 数据库划分

| 数据库 | 用途 | 版本 |
|--------|------|------|
| `MobileTavernLiteDB` | 主数据库（角色/会话/消息/记忆/设置） | v13 |
| `MobileTavernPluginDB` | 插件数据库（包元数据/存档/文件字节） | v2 |

### 隔离规则

- 两个数据库的连接管理独立，互不影响
- 插件数据库的 schema 升级不触发主数据库的 `onupgradeneeded`
- 插件数据库的写操作不经过主数据库的 `enqueueWrite` 队列

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

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-07-29 | 初始创建，提取 8 项关键契约 |
