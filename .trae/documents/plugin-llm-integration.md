# 插件 LLM 接入与预设联动实施计划

## Context（背景与目标）

当前插件 bridge（[runtimeDocument.ts](file:///d:/projects/Mobile-Tavern/src/domain/plugins/runtimeDocument.ts) bridgeSource）只支持 `host.*` / `storage.*` 短请求，无 LLM 能力；CSP `connect-src 'none'` 禁止插件直接联网。用户要接入 LLM 实现 Gal 游戏等场景的实时 AI 互动，并让插件可选同步宿主预设。

**已确认的架构决策**：
- 预设同步：manifest 布尔字段 `llm.syncPreset`，`true` = 宿主注入 `settings.preset` 采样参数，`false` = 插件自管
- 角色卡设定：始终由插件在 `messages` 里自管，宿主不注入角色卡
- LLM 请求由宿主代理（复用 ChatStreamService），apiKey 零暴露给插件
- 权限声明：manifest `permissions` 数组，未声明 `llm.*` 的插件调用被拒

**三个阻塞点（本计划解决）**：
1. bridge 超时硬编码 10 秒（[runtimeDocument.ts:173](file:///d:/projects/Mobile-Tavern/src/domain/plugins/runtimeDocument.ts#L173)）→ LLM 流式会超时
2. bridge 协议纯请求-响应 → 不支持流式 chunk 推送
3. FullscreenPluginRunner 无 kernel 服务访问 → 无法调 ChatStreamService

## 复用的现有基建

| 能力 | 来源 | 复用方式 |
|------|------|----------|
| 流式 LLM | [ChatStreamService.streamLlmResponse](file:///d:/projects/Mobile-Tavern/src/kernel/services/ChatStreamService.ts#L28) | `getKernelService<IChatStreamService>("chatStream")` |
| LLM 配置 | `settings.api.{baseUrl,apiKey,modelName,chatPath,bypassProxy,...}` | `useUnifiedAppContext().settings.api` |
| 预设采样参数 | `settings.preset.{temperature,topP,topK,minP,maxTokens,...}` | syncPreset=true 时注入 reqBody |
| kernel 访问 | [UnifiedAppContext](file:///d:/projects/Mobile-Tavern/src/UnifiedAppContext.tsx#L201) `getKernelService<T>(name)` | ChatTab 已用此模式 |
| 流式调用范例 | [useSendMessage.ts:283-317](file:///d:/projects/Mobile-Tavern/src/hooks/useChat/useSendMessage.ts#L283) | StreamParams 构造 + chunk 消费模式 |
| 试用模式 | `TRIAL_OPENROUTER_KEY` + `getTrialCount()` | 无 apiKey 时降级 |

## 实施步骤

### Step 1：manifest 类型 + 校验扩展

**[types.ts](file:///d:/projects/Mobile-Tavern/src/domain/plugins/types.ts#L3-L14)** — FullscreenPluginManifest 新增字段：
```ts
permissions?: string[];            // ["llm.chat", "llm.chatStream"]
llm?: { syncPreset: boolean };     // 预设同步开关
```

**[packageParser.ts](file:///d:/projects/Mobile-Tavern/src/domain/plugins/packageParser.ts#L168-L208)** validateManifest 扩展：
- `permissions` 若存在必须是字符串数组，值限定于白名单 `["llm.chat", "llm.chatStream", "llm.preset.list"]`
- `llm` 若存在，`syncPreset` 必须是布尔值
- `llm` 存在时隐式要求 `permissions` 含对应 `llm.*`（否则校验失败）

### Step 2：bridge 协议扩展（插件侧）

**[runtimeDocument.ts](file:///d:/projects/Mobile-Tavern/src/domain/plugins/runtimeDocument.ts#L172-L174)** bridgeSource 重写（保持 minified 风格）：

**超时机制改造**：`call(method, params)` 增加可选 `timeoutMs` 参数；`llm.*` 方法调用时传 `0`（禁用超时）或 `300_000`（对齐 LLMService 的 300 秒）。常规方法保持 10 秒。

**新增流式消息类型**：
- 插件 → 宿主：`{ mtPlugin, channel, type: "stream-request", requestId, method, params }`（发起流式）
- 宿主 → 插件：`{ ..., type: "stream", requestId, chunk }`（多次增量）
- 宿主 → 插件：`{ ..., type: "stream", requestId, done: true, usage }`（结束）
- 宿主 → 插件：`{ ..., type: "stream", requestId, error }`（错误）
- 插件 → 宿主：`{ ..., type: "cancel", requestId }`（取消）

**message listener 扩展**：`type === "stream"` 时按 requestId 查找 pending stream handler，调 onChunk/onDone/onError；`done` 或 `error` 后清理 pending。

**MobileTavernPlugin API 新增 `llm` 命名空间**：
```js
llm: Object.freeze({
  chat: (opts) => call('llm.chat', opts),           // 非流式，常规 response
  chatStream: (opts) => callStream('llm.chatStream', opts),  // 流式
  listPresets: () => call('llm.listPresets', {}),   // 预设列表
})
```
`callStream` 返回 `{ onChunk(fn), onDone(fn), onError(fn), cancel() }`，内部管理 stream-request 生命周期。

### Step 3：宿主 LLM 代理（FullscreenPluginRunner）

**[FullscreenPluginRunner.tsx](file:///d:/projects/Mobile-Tavern/src/components/plugins/FullscreenPluginRunner.tsx)** 核心改动：

**3a. kernel 服务注入**：
- 组件顶部新增 `const { settings, getKernelService } = useUnifiedAppContext();`
- 获取 `chatStreamService = getKernelService<IChatStreamService>("chatStream")`

**3b. handleMessage 扩展**（[L68-77](file:///d:/projects/Mobile-Tavern/src/components/plugins/FullscreenPluginRunner.tsx#L68-L77)）：
- 新增 `type === "stream-request"` 分支 → 调 `handleStreamRequest`
- 新增 `type === "cancel"` 分支 → abort 对应 requestId 的 AbortController
- 保留现有 `type === undefined`（常规请求）分支

**3c. handleStreamRequest 新增**（流式核心）：
```ts
async function handleStreamRequest(source, channel, requestId, method, params) {
  // 1. 权限校验：plugin.manifest.permissions 含 method？
  // 2. llm.chatStream：
  //    a. 构造 StreamParams（baseUrl/apiKey 从 settings.api，syncPreset 时采样参数从 settings.preset）
  //    b. reqBody.messages = params.messages（插件提供，含角色设定）
  //    c. signal = new AbortController，存入 pendingStreams Map
  //    d. for await (chunk of chatStreamService.streamLlmResponse(params))
  //         → streamChunk(source, channel, requestId, extractText(chunk))
  //    e. streamDone(source, channel, requestId, usage)
  //    f. catch → streamError(source, channel, requestId, msg)
  //    g. finally → pendingStreams.delete(requestId)
}
```

**3d. respond 辅助函数扩展**（[L193-203](file:///d:/projects/Mobile-Tavern/src/components/plugins/FullscreenPluginRunner.tsx#L193-L203)）：
- 新增 `streamChunk(source, channel, requestId, chunk)` → postMessage `{ type: "stream", requestId, chunk }`
- 新增 `streamDone(source, channel, requestId, usage)` → postMessage `{ type: "stream", requestId, done: true, usage }`
- 新增 `streamError(source, channel, requestId, error)` → postMessage `{ type: "stream", requestId, error }`

**3e. handleRequest 新增非流式方法**（[L156-190](file:///d:/projects/Mobile-Tavern/src/components/plugins/FullscreenPluginRunner.tsx#L156-L190)）：
- `llm.chat` → 非流式，调 chatStreamService 但聚合全文一次性 respond
- `llm.listPresets` → 返回 settings 里可用预设列表

**3f. 权限校验**：
```ts
function checkPermission(manifest, method) {
  const required = method.startsWith("llm.") ? method : null;
  if (required && !(manifest.permissions ?? []).includes(required)) {
    throw new Error("PLUGIN_PERMISSION_DENIED");
  }
}
```
在 handleRequest 和 handleStreamRequest 入口调用。

**3g. syncPreset 采样参数注入**：
```ts
function buildReqBody(params, manifest, settings) {
  const base = { model: settings.api.modelName || FALLBACK_MODEL, stream: true, messages: params.messages };
  if (manifest.llm?.syncPreset) {
    // 宿主注入当前预设采样参数
    return { ...base, temperature: settings.preset.temperature, top_p: settings.preset.topP,
             top_k: settings.preset.topK, min_p: settings.preset.minP,
             max_tokens: settings.preset.maxTokens, ... };
  }
  // syncPreset=false：插件自管，合并 params.sampling（白名单字段）
  return { ...base, ...(sanitizeSamplingParams(params.sampling)) };
}
```

**3h. 流式生命周期绑定**：
- 组件卸载 cleanup 时（[L88-101](file:///d:/projects/Mobile-Tavern/src/components/plugins/FullscreenPluginRunner.tsx#L88-L101)）：遍历 `pendingStreams` Map，abort 所有 AbortController
- 插件退出时同理

**3i. 试用模式降级**：
- `settings.api.apiKey` 为空时，复用 useSendMessage 的试用逻辑（TRIAL_OPENROUTER_KEY + getTrialCount 检查）
- 超过试用次数 → 抛 `PLUGIN_LLM_TRIAL_EXHAUSTED`

### Step 4：测试（TDD，物理隔离）

**[tests/vitest/pluginRuntimeDocument.test.ts](file:///d:/projects/Mobile-Tavern/tests/vitest/pluginRuntimeDocument.test.ts)**：
- bridgeSource 注入后 `MobileTavernPlugin.llm` 存在且方法可调用
- callStream 的 onChunk/onDone/onError 在收到 stream 消息时触发
- cancel 发出 `{ type: "cancel" }` 消息

**[tests/vitest/FullscreenPluginRunner.test.tsx](file:///d:/projects/Mobile-Tavern/tests/vitest/FullscreenPluginRunner.test.tsx)**：
- mock useUnifiedAppContext 返回 fake settings + chatStreamService
- `llm.chatStream` 权限未声明 → 返回 PERMISSION_DENIED
- `llm.chatStream` 权限已声明 + syncPreset=true → reqBody 含 settings.preset 采样参数
- `llm.chatStream` 权限已声明 + syncPreset=false → reqBody 不含预设参数
- 流式 chunk 正确 postMessage 到 iframe
- 组件卸载时 abort 所有 pending stream

**[tests/vitest/pluginPackageParser.test.ts](file:///d:/projects/Mobile-Tavern/tests/vitest/pluginPackageParser.test.ts)**：
- manifest 含 permissions + llm.syncPreset 正常解析
- permissions 非数组 → 校验失败
- llm.syncPreset 非布尔 → 校验失败
- llm 存在但 permissions 缺对应 llm.* → 校验失败

## 安全边界

1. **权限声明**：manifest `permissions` 白名单校验，handleRequest 入口拦截
2. **apiKey 零暴露**：bridge 只传 messages，宿主注入 apiKey/baseUrl；CSP `connect-src 'none'` 保持
3. **消息过滤**：`params.messages` 校验为数组、每项 role/content 为字符串（剥离注入字段）
4. **采样参数白名单**：syncPreset=false 时只接受 `temperature/top_p/top_k/min_p/max_tokens/presence_penalty/frequency_penalty` 白名单字段
5. **流式生命周期**：卸载/退出 abort 所有 pending，防止泄漏

## 验证

1. `npm run lint` — 0 error
2. `npm run test:unit` — 新增测试全过 + 现有 420 测试不破坏
3. 手动验证（可选，需真机/模拟器）：
   - 构造一个声明 `permissions: ["llm.chatStream"]` + `llm.syncPreset: true` 的测试插件
   - 插件内调 `MobileTavernPlugin.llm.chatStream({ messages: [...] })`
   - 验证 iframe 内收到流式 chunk 并渲染
   - 验证卸载插件后无 pending stream 泄漏

## 风险

- **bridgeSource 是 minified JS**：扩展时保持手写 minified 风格，注意转义；测试覆盖防止语法错误
- **流式 postMessage 频率**：LLM chunk 可能高频，考虑合并连续 chunk（如 16ms 节流）避免 iframe 消息过载
- **试用模式配额**：插件 LLM 调用是否计入 getTrialCount 需确认（建议计入，防滥用）
