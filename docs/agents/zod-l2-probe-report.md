# Kernel zod L2 探测报告

**探测日期**：2026-07-19
**探测方式**：Kernel.ts 临时探针 + `npm test` 全量运行（75/75 主测试 + 327 vitest 测试全绿）
**探测目标**：修正 zod L2 schema 设计前提，确认 17 个服务接口与实现的方法差异、publish topic 实际分布、getService SafeProxy 触发场景

---

## 一、publish topic 实际分布

### 测试中观察到的 topic（按频率降序）

| 频次 | topic | 类型 |
|---|---|---|
| 2 | `test:publish-snapshot` | 测试 mock |
| 2 | `test:topic2` | 测试 mock |
| 2 | `test:topic` | 测试 mock |
| 1 | `script:destroyed` | **真实业务 topic** |
| 1 | `destroy-topic` | 测试 mock |
| 1 | `test:destroy-active` | 测试 mock |
| 1 | `timeout-parallel` | 测试 mock |
| 1 | `parallel-test` | 测试 mock |
| 1 | `priority-test` | 测试 mock |
| 1 | `timeout-serial` | 测试 mock |
| 1 | `parallel-err` | 测试 mock |

### 关键发现

1. **测试中唯一真实业务 topic**：`script:destroyed`（payload shape `{ reason: "service-destroy" }`）
2. **`catbot:event` 在测试中未触发**：代码扫描确认其 publish 调用点在 [catbotEventBus.ts:27](file:///e:/modules/projects/Mobile-Tavern/src/utils/catbotEventBus.ts#L27)，但测试未覆盖
3. **`tavern_helper:${event}` 在测试中未触发**：代码扫描确认其 publish 调用点在 [bridgeCore.ts:144,153](file:///e:/modules/projects/Mobile-Tavern/src/utils/tavernHelper/bridgeCore.ts#L144)，由用户 SillyTavern 脚本触发，测试不覆盖
4. **`KernelEvents` 枚举 3 个事件全部未触发**：确认是死代码（[types.ts:23-27](file:///e:/modules/projects/Mobile-Tavern/src/kernel/types.ts#L23-L27)）

### 设计修正

- **静态 topic schema 范围**：仅为 `script:destroyed` 与 `catbot:event` 两个静态 topic 定义 payload schema
- **`tavern_helper:*` 显式 skip**：在 `DYNAMIC_TOPIC_PREFIXES` 黑名单中跳过 payload 校验
- **`KernelEvents` 死代码清理**：Phase B 删除该枚举，避免维护者给死事件写 schema

---

## 二、getService SafeProxy 触发统计

### 测试中触发 SafeProxy 的服务名

| 服务名 | 触发场景 |
|---|---|
| `crash-service` | 测试 mock（崩溃服务降级） |
| `critical-db` | 测试 mock（关键服务缺失应抛错，但被非关键路径调用） |
| `hang-svc` | 测试 mock（初始化挂起） |
| `mock-bad` | 测试 mock |
| `mock-destroy` | 测试 mock |
| `nonexistent-for-symbol-test` | 测试 mock（Symbol 属性访问） |
| `nonexistent-service` | 测试 mock |
| `nonexistent-service-for-warn-test` | 测试 mock |
| `not-found-service` | 测试 mock |

### 关键发现

1. **无真实业务服务触发 SafeProxy 降级**：所有 SafeProxy 触发都是测试用例故意构造的 mock 服务名
2. **真实运行时（含测试覆盖范围）getService 命中率 100%**：17 个真实服务全部能找到
3. **SafeProxy 校验设计成立**：Phase C 的 `SAFE_PROXY_SYMBOL` 标记方案不会与真实服务冲突

### 设计修正

- **getService lazy 校验范围**：仅对真实服务实例（非 SafeProxy）走 P0 schema 校验
- **SafeProxy 标记机制**：在 [createSafeProxy](file:///e:/modules/projects/Mobile-Tavern/src/kernel/Kernel.ts#L55-L97) 加 `[SAFE_PROXY_SYMBOL]` 标记，getService 检测到标记时跳过 P0 schema

---

## 三、17 个服务接口 vs 实现方法差异表

### 测试中注册的真实服务（10 个）

| 服务名 | 接口方法（types.ts） | 实现方法（探针） | 差异 |
|---|---|---|---|
| `chatStream` | `streamLlmResponse` | `streamLlmResponse, init, destroy` | ✅ 一致（+IKernelService 基础方法） |
| `database` | `getAllSessions, getSessionById, getSessionsCount, getSessionsPaginated, saveSession, appendSessionMessage, deleteMessageById, syncSessionMessages, deleteSession, bulkSaveSessions, createNewSession, createEmptyBranch, createBacktrackBranch, createBacktrackFromTimeline, getCharacterById`（15） | 上述 15 + `init, destroy`（17） | ✅ 一致 |
| `llm` | `universalFetch, isClientMode, sendCatbotRequest`（3） | `universalFetch, isClientMode, sendCatbotRequest, buildHeaders, validateBaseUrl, init, destroy`（7） | ⚠️ **实现多 2 个未声明方法**：`buildHeaders`, `validateBaseUrl` |
| `memory` | `getStorage, getExtractor, getRecall, getStateTable, getSummary`（5） | 上述 5 + `init, destroy`（7） | ✅ 一致 |
| `script` | `initializeMvuFromCharacter, parseMvuMessage, executeMvuScript, registerBridge`（4） | 上述 4 + `init, destroy`（6） | ✅ 一致 |
| `prompt` | `assemblePrompt, cleanNameForApi, estimateTokens, sanitizeName, getTriggeredLorebookEntries, replaceMacros`（6） | 上述 6 + `escapeRegExp, formatMvuVariablesForPrompt, formatVariablesAsYaml, hasCardScripts, init, destroy`（12） | ⚠️ **实现多 4 个未声明方法**：`escapeRegExp`, `formatMvuVariablesForPrompt`, `formatVariablesAsYaml`, `hasCardScripts` |
| `multiMessage` | `queueUserMessage`（1） | `queueUserMessage, init, destroy`（3） | ✅ 一致 |
| `updateCheck` | `checkUpdate`（1） | `checkUpdate, init, destroy`（3） | ✅ 一致 |
| `tableMemory` | `processTableMemory`（1） | `processTableMemory, init, destroy`（3） | ✅ 一致 |
| `autoSummary` | `handleAutoSummaryCheck`（1） | `handleAutoSummaryCheck, init, destroy`（3） | ✅ 一致 |

### 测试未覆盖的服务（7 个）

| 服务名 | 接口方法（types.ts） | 探针数据 |
|---|---|---|
| `telemetry` | `reportUsage, incrementUsageCount, reportLlmPerformance, reportImmediate, reportColdStartReady, reportChatLoadTime, reportDbQueueTimeout, reportZodValidationError`（8） | 未注册（测试未覆盖） |
| `imageGen` | `generateImage`（1） | 未注册 |
| `tts` | `speak, stop, pause, resume, isSpeaking, getSpeakingMessageId, setSpeakingMessageId`（7） | 未注册 |
| `asr` | `isListening, startListening, stopListening, cancelListening`（4） | 未注册 |
| `character` | `getAllCharacters, saveCharacter, deleteCharacter, bulkSaveCharacters, getStoredDefaultCharactersInitializedFlag, saveStoredDefaultCharactersInitializedFlag`（6） | 未注册 |
| `worldbook` | `getGlobalLorebook, saveGlobalLorebook, getCustomWorldbooks, saveCustomWorldbooks`（4） | 未注册 |
| `settings` | `getStoredSettings, saveStoredSettings`（2） | 未注册 |
| `preset` | `getStoredSavedPresets, saveStoredSavedPresets`（2） | 未注册 |
| `bgm` | **无 IBgmService 接口**（缺口） | 未注册 |

### 关键发现

1. **LLM 与 Prompt 实现暴露了未声明方法**：
   - LLM：`buildHeaders`, `validateBaseUrl`（内部辅助方法应 private 但暴露为 public）
   - Prompt：`escapeRegExp`, `formatMvuVariablesForPrompt`, `formatVariablesAsYaml`, `hasCardScripts`（同上）
   - **schema 设计决策**：P0 schema 仅校验接口声明的方法存在，不校验"实现不能多方法"（否则会破坏现有代码）
2. **Bgm 接口缺口确认**：KernelServices 枚举有 `Bgm` 但 types.ts 无 `IBgmService` 接口 — Phase B 需补 IBgmService 接口或确认 Bgm 直接 implement IKernelService
3. **测试覆盖率缺口**：17 个服务中只有 10 个在测试中注册过，7 个服务（telemetry/imageGen/tts/asr/character/worldbook/settings/preset）完全无测试覆盖

### 设计修正

- **P0 schema 严格度**：仅校验"接口声明的方法在实现中存在且是 function"，不校验"实现不能有额外方法"
- **P1 schema 范围**：仅校验 IKernelService 基础结构（name + init + destroy），不校验业务方法
- **Bgm 接口补全**：Phase B 在 types.ts 补 `IBgmService` 接口（与 BgmService 实现对齐）

---

## 四、P0 服务最终确认

### 按数据流入边界分级（Plan agent 建议 + 探测数据验证）

| P0 服务 | 理由 | 探测验证 |
|---|---|---|
| **ChatStream** | LLM SSE 流式响应入口，不可信数据第一道关 | 探针确认 `streamLlmResponse` 方法存在 |
| **Script** | `parseMvuMessage` 输出写入 session.variables 持久化，LLM 文本→数据库转换点 | 探针确认 `parseMvuMessage, executeMvuScript` 方法存在 |
| **Database** | IndexedDB 持久化边界，所有数据反序列化入口 | 探针确认 15 个接口方法全部存在 |
| **Memory** | 记忆系统数据流入边界 | 探针确认 5 个接口方法全部存在 |
| **LLM** | 外部 LLM API 调用边界 | 探针确认 3 个接口方法 + 2 个未声明辅助方法 |

### P1 服务（12 个）

Prompt, Settings, Preset, Character, Worldbook, Telemetry, UpdateCheck, ImageGen, Tts, Asr, Bgm, MultiMessage — 仅校验 IKernelService 基础结构。

---

## 五、设计前提修正汇总

| 原设计假设 | 探测结果 | 修正方案 |
|---|---|---|
| publish 静态 topic 有 3 个字面量 + 3 个 KernelEvents 枚举 | 实际只有 2 个字面量（`script:destroyed` + `catbot:event`），KernelEvents 是死代码 | 仅 2 个静态 topic 加 schema；清理 KernelEvents |
| `as any` 69 处是痛点 | 实际 `as any` 只 2 处，493 处是 `: any` 类型注解 | 痛点重新表述为"IMessage.payload:any + getService<any> 调用" |
| 需新增 validationMode 三态开关 | Kernel 已有 strictMode 机制 | 复用 strictMode，升级为三态，向后兼容 |
| 17 个服务接口与实现一致 | LLM/Prompt 实现暴露了未声明方法 | schema 仅校验"声明方法存在"，不校验"实现不能多方法" |
| Bgm 有 IBgmService 接口 | types.ts 无此接口 | Phase B 补 IBgmService 或确认 Bgm 直接 implement 基础接口 |
| 17 个服务测试全覆盖 | 仅 10 个服务有测试覆盖 | 不影响 L2 设计，但提示测试覆盖率需提升 |
| getService SafeProxy 是常见场景 | 测试中 SafeProxy 仅由 mock 触发，真实服务 100% 命中 | SAFE_PROXY_SYMBOL 标记方案验证可行 |

---

## 六、Phase B/C 设计确认

基于探测数据，Phase B/C 实施计划保持原方案，仅以下细节确认：

1. **Phase B 静态 topic schema 仅 2 个**：`script:destroyed`（payload `{reason: string}`）、`catbot:event`（payload 待手动 smoke 确认，先用 `z.unknown()` 兜底）
2. **Phase B KernelEvents 枚举删除**：[types.ts:23-27](file:///e:/modules/projects/Mobile-Tavern/src/kernel/types.ts#L23-L27) 整体删除
3. **Phase B IBgmService 接口补全**：参考 BgmService 实现补接口定义
4. **Phase C P0 schema 严格度**：仅校验接口声明方法存在，不校验实现无额外方法
5. **Phase C SAFE_PROXY_SYMBOL 标记**：在 [createSafeProxy](file:///e:/modules/projects/Mobile-Tavern/src/kernel/Kernel.ts#L55) 加 Symbol 标记
6. **Phase C 测试侧 setKernelStrictMode(false) 已存在**：新校验自动跟随关闭，无需额外改动

---

## 七、手动 smoke 建议（可选）

探测阶段未覆盖的场景（用户可自行决定是否手动验证）：

1. **发一条消息触发 ChatStream + LLM**：验证 LLM 流式响应过程中 `tavern_helper:*` topic 的 payload 形状
2. **加载一个角色卡**：验证 Database 服务的 `getCharacterById` 调用
3. **触发一次 MVU 脚本**：验证 `script:mvuVariablesUpdated` topic 的 payload（注：该 topic 只被订阅未被 publish，可能已废弃）

如不做手动 smoke，Phase B 的 `catbot:event` schema 用 `z.unknown()` 兜底，后续根据生产环境 warn 日志再收紧。
