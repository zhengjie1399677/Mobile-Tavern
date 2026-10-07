# 2026 年 10 月变更记录

- 2026-10-07：**第三方 MCP 推荐模板改为按用途分组，角色扮演优先。**
  1. **背景**：公网免鉴权 MCP 生态目前基本是开发向服务（代码搜索、仓库文档、技术文档检索），而本应用用户几乎全是角色扮演场景，原先平铺的模板列表容易让人误以为"MCP 就是这些开发工具"。
  2. **分组**：`ThirdPartyMcpPreset` 新增 `category`（roleplay / general / developer）与 `THIRD_PARTY_MCP_PRESET_CATEGORY_LABEL`；模态框按「角色扮演向 → 通用查询 → 开发向（默认折叠，可展开）」渲染，避免开发工具占据首屏。
  3. **新增免鉴权条目**：实测 `https://mcp.wiki/mcp`（`initialize` 200、无 `WWW-Authenticate`，工具为 `search_mcp_wiki` / `query_docs_filesystem_mcp_wiki`）并加入「角色扮演向」，用于设定考据与背景补充；DeepWiki 归入「通用查询」，grep.app / GitMCP / GitHub / Brave 归入「开发向」。
  4. **引导**：角色扮演分组顶部明确写出"多数需求已内置"（骰子 / 随机 / 抽选 / 字数命令、记忆写入、联网搜索），MCP 只是扩展通道，不是角色扮演的必需品。

- 2026-10-07：**修复「正则产出卡片的卡片在受信模式下永久停在『正在载入脚本依赖…』」，并把手布局改为长按拖动。**
  1. **根因**：重型 UI 库（Vue/Pinia/jQuery）的加载判定只看"卡片脚本 / 开场白 iframe / 开场白 HTML 代码块"。而状态栏与插图卡几乎都是**渲染期由正则产出** ```html 的——这类卡片往往没有 tavern_helper 脚本、开场白里也没有代码块，于是受信模式下 `areRuntimeLibrariesReady("trusted")` 永远为 false，消息 iframe 永久停在占位符（线上实测：正则误杀修复后，人妻 卡片卡在这一步）。
  2. **修法**：`bridgeCore` 抽出可测的 `shouldLoadUiLibraries()`，新增第四个条件——角色卡 / 全局 / 预设存在**启用的正则脚本**即加载重型库；诊断日志同步输出 `hasRenderableRegexScripts` 与触发原因。
  3. **工作台布局**：入口按钮由「卡片布局」简化为「布局」；排序交互从「上移/下移按钮」换成**长按拖动**（行体长按 320ms，或直接按住左侧抓手），拖动期间只改本地草稿、松手才落库一次；显示开关仍即时保存。
  4. **验证**：`tests/vitest/bridgeProfileLibraries.test.ts` 覆盖四个加载条件（正则卡/全局预设正则/全禁用不加载/脚本与代码块）；`workbenchLayout.test.ts` 改为覆盖 `moveWorkbenchCardTo` 的越界夹取与未知 id；`WorkbenchTab.test.tsx` 用指针事件模拟长按拖动。桌面 dev 实测日志：`触发 UI 库加载，原因: hasRenderableRegexScripts` → `libsReady=true，停止轮询`，占位符消失。

- 2026-10-07：**修复导入/探测 MCP 来源后报 `Unrecognized keys: "createdAt", "updatedAt"`（与 API Key 无关）。**
  1. **根因**：`ExternalSourceRuntimeService.defaultStore()` 把 IndexedDB 存储记录（`StoredExternalSource`，带 `createdAt` / `updatedAt` 元数据）直接透传给 `openExternalSource()`，而 `externalCapabilitySourceSchema` 是 `.strict()` 契约，于是**每次重连 / 探测能力 / 单工具测试都会以 `unrecognized_keys` 失败**。用户表现为：选用 DeepWiki 等模板保存后弹出这段 Zod JSON，误以为是缺少 Key。
  2. **修法**：存储层把私有的 `toSourceInput` 提升为唯一投影 `toExternalCapabilitySource()`，`defaultStore()` 的 `list` / `get` 在端口边界剥掉存储元数据后再交给运行时契约；启停路径复用同一投影。
  3. **回归**：`tests/vitest/externalSourceRuntime.test.ts` 新增用例——用真实 IndexedDB（fake-indexeddb）写入一条带元数据的来源，再用**生产同款 defaultStore** 初始化运行时，断言 `failures` 为空且来源已连接。去掉边界投影后该用例会红，并原样复现用户贴出的 `unrecognized_keys` 报错（已实测）。

- 2026-10-07：**工作台支持自定义卡片布局、新增两张图表卡片，并补充免鉴权 MCP 预置。**
  1. **卡片布局编辑**：新增 `src/domain/ui/workbenchLayout.ts`（顺序/隐藏清单解析：未知 id 忽略、新卡片自动补到末尾、越界移动无副作用）与 `WorkbenchLayoutDialog`（上移/下移 + 显示开关 + 恢复默认，改动即时保存到 `settings.workbenchCardLayout`）；`WorkbenchTab` 改为按用户布局渲染，全部隐藏时给出空态入口；设置加载器对布局做形状收口，非法值回落出厂顺序。
  2. **两张新图表**：`SessionRankWidget`（会话活跃排行 Top 5，可在轮次/字数之间切换，数据取自会话目录元数据，不依赖消息分页）与 `TokenPerformanceWidget`（累计输出 Token、平均 tok/s、累计生成耗时 + 最近 40 条回复的柱状分布，数据只读消息自身持久化的 `tokenCount` / `generationTime`）。
  3. **免鉴权 MCP 预置**：实测公网无鉴权 Streamable HTTP 端点后加入推荐模板——`grep.app 代码搜索`（https://mcp.grep.app）与 `GitMCP 仓库文档`（https://gitmcp.io/docs，端点可替换为 `https://gitmcp.io/<owner>/<repo>`）；DeepWiki（https://mcp.deepwiki.com/mcp）原已在列。三者 `initialize` 均返回 200 且响应头不含 `WWW-Authenticate`，无需申请 Key 即可试用。
  4. **测试**：新增 `tests/vitest/workbenchLayout.test.ts`（顺序/隐藏/越界移动解析）；`tests/vitest/WorkbenchTab.test.tsx` 增加布局编辑器用例（隐藏卡片写入 hidden、下移改变 order）。

- 2026-10-07：**修复「角色卡/预设正则被灾难正则守卫误杀，状态栏、插图与 MVU 卡片静默消失」。**
  1. **根因**：`isPotentiallyCatastrophicRegex()`（`src/compatibility/sillytavern/mvuParser.ts`）的第二个分支只要求"字符类之后再出现任意量词"，于是 `[\s\S]*?` 这种跨行匹配的标准写法被判成灾难正则，整条 `findRegex` 被替换为 `(?!)`（永不匹配）。表现为卡片状态栏、插图与 MVU 卡片在渲染层凭空消失且零报错，切换脚本执行/受信模式也毫无作用。缺陷由 2026-09-01 `3467131` 引入。
  2. **修法**：守卫只拦截"量词直接包裹量词组/字符类"的嵌套量词形态（`(a+)+`、`(a*)*`、`([a-z]+)*`、`[a+]*`），`([\s\S]*?)`、`(abc+).*def*` 等常见写法不再误伤；判定抽到 `regexEngine.ts` 成为单一来源，世界书正则键解析（`worldInfoResolver.ts`）里的同一份误判副本一并修正（此前会把这类正则键静默降级为子串匹配）；被停用的正则改为 `console.warn` 留痕，不再静默失效。
  3. **验证**：桌面 dev + Playwright 真实复现（导入 `test-cards/人妻.json` 并进入会话）。修复前：引擎收到 `(?!)`，消息里 `<SceneInfo>` 原样以纯文本呈现；修复后：`插图` 正则命中，正文 1158 → 20079 字符，`<SceneInfo>` 替换为 19KB 卡片 HTML（含 `<img>`），`<type>non</type>` 同步被 `nsfw` 正则删除。
  4. **回归**：`tests/vitest/sillyTavernRegexCompatibility.test.ts` 新增两条用例——跨行匹配 `[\s\S]*?` 的卡片正则必须能替换文本；`(x+)+` 这类真正的嵌套量词仍然 fail-closed。

- 2026-10-07：**修复「从会话/历史进入对话后角色卡正则与 MVU 全静默失效」。**
  1. **根因**：首屏只加载轻量角色目录（`getCharacterCatalog()`，标记 `extensions.__catalogOnly`，不含 `regex_scripts`、`tavern_helper.scripts`、世界书与开场白）。会话管理器弹窗与聊天历史页的 `openSession` 只调用 `setActiveCharId()` 就切到聊天，渲染层因此拿到的是一张"没有脚本的正则空卡"：卡片正则（状态栏、插图）不执行、MVU 脚本不加载、变量不注入，而且全程零报错。此时 `受信完整兼容模式`开关不可能生效——它只影响兼容 iframe 的沙箱策略，插件链路根本没被使用。诊断证据：同一张卡的「插图」正则 `/<SceneInfo>([\s\S]*?)<\/SceneInfo>/gm` 在离线引擎上可正常产出 19KB 卡片 HTML，而设备上消息原文（含 `<SceneInfo>` / `<type>`）原样显示。
  2. **修法**：`CharacterContext` 增加统一兜底——活跃角色仍是目录投影时自动 `loadCharacterById()` 补载完整卡并回写目录项。修复覆盖所有入口（会话管理器、聊天历史、收藏/归档恢复等），不再依赖每个入口各自记得先加载完整卡。
  3. **回归**：`tests/vitest/characterContextFlow.test.tsx` 新增用例，钉住"目录返回 `__catalogOnly` 投影时，选择该角色必须触发 `getCharacterById` 并让消费组件拿到完整卡字段"。

- 2026-10-07：**输出长度上限放开：出厂默认十万、可选上限一百万。**
  1. **单一来源**：新增 `src/domain/api/outputTokenLimits.ts` 统一持有 `DEFAULT_MAX_OUTPUT_TOKENS`(100000)、`MAX_OUTPUT_TOKENS`(1000000) 与 `MIN_PROMPT_TOKEN_BUDGET`(4096)；出厂预设、采样界面滑杆、预设实体校验（`presetSamplerSchema`）与 Agent Profile 采样校验（`runtimeProfileSamplingSchema`）全部改为引用同一常量。历史缺陷是滑杆上限 150000 与实体校验 1000000 长期不一致。
  2. **厂默认值**：内置「基本预设」的 `maxTokens` 由 1500 改为 100000；采样面板的「恢复默认采样」与滑杆上限同步为 100000 / 1000000，快捷档位改为 2K / 8K / 32K / 100K(默认) / 256K / 1M。
  3. **预算保底**：提示词预算此前固定为 `上下文 − maxTokens`，输出上限放开后会被压到 1 token（历史、世界书、记忆被整段丢光）。现在经 `splitContextBudget()` 切分，输出预留最多为 `上下文 − MIN_PROMPT_TOKEN_BUDGET`，常规取值下与原公式逐字一致，只在极端取值时保留提示词下限。
  4. **既有数据不迁移**：启动引导明令不改写预设内容，因此已存在的预设保留各自保存的 `maxTokens`，需要一次性点选「100K 默认」档位或「恢复默认采样」；预设实体缺少 `maxTokens` 时由运行期投影补出厂默认（现为 100000）。注意导入路径在文件未声明 `max_tokens` / `openai_max_tokens` 时仍写入 600 的保守兜底，与「预设作者显式声明优先」的口径一致，未随本次改动调整。
  5. **测试**：新增 `tests/vitest/outputTokenLimits.test.ts`（常量、出厂默认、实体/Profile 上界、预算切分四种情形）。

- 2026-10-06：**工作台新增第三方 MCP 接入与单工具测试沙盒（外部能力 M3c）。**
  1. **接入入口**：`ThirdPartyMcpImportModal` 提供三种来源——粘贴 Claude Desktop / Cursor 的 `mcpServers` 配置或单个 HTTP(S) URL（`thirdPartyMcpParser` 纯解析，不执行任何外部脚本）、选用预置模板（DeepWiki / Brave Search / GitHub 远端）、手动添加；stdio 本地进程在移动端不可运行，被显式拦截并在结果里给出原因，不做静默丢弃。
  2. **鉴权字段收口**：预置模板声明了 `authHeader` / `authScheme` / `authPlaceholder`，此前只搬运 id/name/endpoint，导致 Brave 预置（`x-subscription-token` + `raw`）会以 `Authorization: Bearer` 发出而必然 401。现在 `presetToFormValues` → `formValuesToCandidate` 是唯一转换入口，鉴权头、方案与占位提示一路带出，秘密仍只经独立加密凭据库写入（来源记录里不出现明文）。
  3. **能力视界**：`ToolCapabilitiesWidget` 改为「MCP / 宿主 Tool」双分签，支持一键巡检与逐来源测速、展开查看工具清单与连接诊断、删除来源；运行时契约补齐 `getSnapshot`（只读内存快照，不发网络请求）与 `testCallTool`（单次轻量测试调用），两者改为必选成员，避免调用方做无意义的存在性判断。
  4. **测试入口的边界**：工作台「测试调用」是用户直连诊断入口，单次、不进审批链与 Agent Journal，但仍校验来源处于启用状态（`EXTERNAL_SOURCE_REVOKED` 语义与工具执行路径一致）；该例外已写入外部能力通道设计文档。
  5. **顺带修复**：首次挂载加载加一次性守卫——`useUnifiedApp` 选择器返回的 `getKernelService` 引用一旦变化会连带重算 `loadPlugins` / `loadMcpSources`，无守卫时形成「effect → setState → 重渲染 → effect」的无限环。
  6. **测试**：`thirdPartyMcpParser.test.ts` 增加预置 → 表单 → 候选的鉴权字段断言（含 Token 去空白、无鉴权模板不产生凭据字段）；`ToolCapabilitiesWidget.test.tsx` 增加「选用 Brave 预置并保存」端到端断言（保存的 source 必须带 `x-subscription-token` / `raw`，凭据按 id 写入），并让异步加载在 act 窗口内收口；`WorkbenchTab.test.tsx` 改为 mock 外部来源用例，不再依赖真实 IndexedDB。
  验证：`npm run lint`、`npm run lint:all`、`npm run lint:changed`、`npm run check:i18n`、`npm test`、`npm run build` 全部通过。
- 2026-10-06：**缓冲型到达改为分帧回放（修掉"空屏后一次性喷出"）。**
  1. **背景**：大量第三方中转站在整段生成期间不发字节、最后一次性下发全文，或直接忽略 `stream`。此时的到达是"一次一大段"，而显示侧此前是"到达即整段提交"，于是屏幕从空白直接跳到全文，并在同一帧完成整段 Markdown 解析，表现为卡顿式喷出。
  2. **策略**：`buildThrottledUpdater` 增加显示层回放——单次到达增量 ≥ `BUFFERED_ARRIVAL_THRESHOLD_CHARS`(240) 判定为缓冲型到达，进入回放；每 `REVEAL_TICK_MS`(60ms) 推进一拍，步长 = `max(40, 积压/6)`，总时长封顶 `REVEAL_MAX_MS`(1200ms) 后直接补齐，避免长文播很久。到达仍按原样累计（`responseChunks` 是唯一权威），只有"显示长度"被节流：**不改请求、不改提交时机、不改最终落库内容**。
  3. **真流式零回归**：小增量继续走原有即时路径（首个 token 立刻显示，其余 60ms 节流），不引入任何额外延迟；取消、切换会话、最终提交（`isStreamActiveRef` 置 false / 清理 `pendingUpdateTimeoutRef`）都会立刻终止回放。思考链不参与回放（可折叠块内且通常先于正文到达）。
  4. **测试**：新增 `tests/vitest/streamRevealPacing.test.ts`（假定时器）：小增量即时显示、缓冲型分帧且单调不回退、最终补齐、总时长有界、停止后不再提交。
  验证：`npm run lint`、`npx eslint --quiet`、该 Vitest、`npm test` 全部通过。
- 2026-10-06：**首字预算放宽到 300s，并给生成等待期加屏幕计时。**
  1. **首字等待 60s → 300s**：`DEFAULT_FIRST_CHUNK_TIMEOUT_MS` 放宽到 300_000。原因：大量第三方中转站在整段生成期间不发送任何字节（忽略 `stream` 或整段缓冲），60s 会把长回复与思考模型直接掐掉，而按「消耗 token 的请求不自动重试」的既定策略不会重发，等于丢一次回复。数据块心跳保持 60s（已开始收数据后的断流信号），超时仍自包含收口、仍不自动重试；挂死时用户可用输入区「停止生成」立即结束。
  2. **等待计时（感官反馈）**：新增 `src/tabs/chat/message-bubble/GeneratingElapsed.tsx`，在首字到达前的「AI 正在构思…」行显示已等待秒数（`chat.generating_elapsed`，8 种语言）。起点取占位消息的 `timestamp`，因此切换会话/重新挂载后计时依旧正确；计时每秒只在自身组件内 `setState`，不带动 `MessageBubble` 与虚拟列表重渲染；本项纯显示层，不改变请求、超时与提交语义。
  3. **顺带清理**：移除 `MessageBubble` 中从未渲染的 `TypingIndicator` 死导入（文件保留，可另行决定删除）。
  4. **测试**：新增 `tests/vitest/GeneratingElapsed.test.tsx`（起点秒数、每秒推进、换新生成重置、缺起点不抛错，假定时器确定性断言）；`tests/vitest/twoPhaseTimeout.test.ts` 常量断言同步到 300s/60s。
  验证：`npm run lint`、`npm run check:i18n`、`npx eslint --quiet`、上述 Vitest、`npm test` 全部通过。
- 2026-10-06：**修复切换会话瞬间的整屏抖动（延迟渲染跨会话泄漏）。**
  1. **根因**：`DialogueHistoryView` 把整个消息数组交给 `useDeferredValue`（流式期间每 60ms 一次更新的低优先级提交）。会话切换后延迟值仍指向上一个会话的消息数组，React 会先把上一会话整屏消息渲染进新会话，随后整体替换；底部一次性定位与虚拟列表 `anchorTo:"end"` 又按错误列表计算，于是切换瞬间出现整屏抖动与错误滚动位置。最新回复带候选分支（swipes）时该行更高，最后一跳更明显。
  2. **修法**：把「会话 id + 消息列表」打包成同一载荷 `SessionMessageListPayload`，由纯函数 `resolveRenderedMessageList`（`src/tabs/chat/utils.ts`）判定归属：同会话才使用延迟值，跨会话立即使用原始列表。延迟渲染在同会话内的收益（滚动/输入即时响应）完整保留。
  3. **测试**：新增 `tests/vitest/chatMessageList.test.ts`，钉住「同会话用延迟列表 / 跨会话绝不用 / 追上后引用一致」三条语义。
  验证：`npm run lint`、`npx eslint --quiet`、`tests/vitest/chatMessageList.test.ts`、`npm test` 全部通过。
- 2026-10-06：**修复 API 通道档案「看起来被合并」的编辑语义缺陷。**
  1. **根因**：档案只有「另存」而没有写回路径，且编辑 Base URL / API Key 会立刻把 `currentApiProfileId` 清空退回「临时调试配置」。用户在选中档案后改字段，改的其实是临时表单，档案本体没动；之后再点「另存」，新档案就是当前表单的副本，于是两条档案内容一模一样 —— 看起来像被合并（存储层始终是数组、逐条独立加密，无数据合并）。
  2. **投影/脏检查单点化**：新增 `src/domain/api/apiProfiles.ts`，把「档案承载字段清单」「选择通道的投影」「未保存判据」「另存构造」收口到同一处；`savedUrls` / `contextLimit` / `sendNames` 等表单专属字段在切换通道时保持不动（与历史语义一致，档案未声明字段仍按 `undefined` 覆盖）。
  3. **界面语义**：编辑字段不再取消档案选择；档案与表单不一致时显示「未保存」标记与「保存到当前通道」按钮；切换档案或切到「临时调试配置」前先确认（需要保留可先「另存」）；「另存」改为复用领域构造。顺带把档案选择器的 `aria-label` 从 Select 根移到触发器，屏幕阅读器与测试都能拿到通道名。
  4. **测试**：新增 `tests/vitest/apiProfiles.test.ts`（字段清单字面量同步守卫、投影不改表单专属字段、脏检查只比较档案字段）与 `tests/vitest/ApiConfigSection.test.tsx`（编辑不丢选择、保存写回、切换前确认取消与确认两条路径）；i18n 新增 4 个键并补齐 8 种语言（`npm run check:i18n` 与词典一致性用例强制）。
  验证：`npm run lint`、`npx eslint --quiet`（改动文件）、`tests/vitest/apiProfiles.test.ts`、`tests/vitest/ApiConfigSection.test.tsx`、`tests/vitest/i18n.test.tsx`、架构边界守卫、`npm test` 全部通过。
- 2026-10-06：**统一聊天请求重试策略：一切消耗 token 的请求都不自动重试。**
  1. **移除流式断流自动重发**：`ChatStreamService` 原先在"未向消费方输出任何内容"时对 `error decoding response body`（reqwest 读取响应体中途断流的统一报错）自动重发一次。该重发会让上游重新生成一次回复、重复计费，与既定策略冲突，现已删除；断流只保留诊断增强（目标主机 + 已接收字节数），错误原样交给上层。重试判断函数更名为 `isResponseBodyInterrupt`，仅用于补诊断，不再触发任何重发。
  2. **行为口径**：首包未交付即失败 → 保留用户消息并提示失败；已交付部分内容 → 保留「内容 + 连接中断」标记；两者都不重发，是否重发由用户在聊天界面显式触发（`useRerollMessage`）。与既有 `tests/vitest/twoPhaseTimeout.test.ts`、`tests/vitest/useSendMessage.test.ts` 的"不自动重试"断言口径一致。
  3. **测试同步**：`tests/suites/chatStreamRetry.test.ts` 更名为 `tests/suites/chatStreamInterrupt.test.ts`，原"瞬态断流自动重试一次"用例反转为"只发 1 次请求 + 错误带诊断"，另两条（部分内容后断流、非瞬态错误）保持"不重发"语义；`tests/suites/index.ts`、`tests/run_all_tests.ts` 同步更新。
  验证：`npm run lint`、`npx eslint --quiet`、`tests/suites/chatStreamInterrupt.test.ts`、`tests/vitest/twoPhaseTimeout.test.ts` + `tests/vitest/useSendMessage.test.ts`、`npm test` 全部通过。
- 2026-10-05：**修复代码审查发现的候选分支、提示词去重与流式超时缺陷，并清理死代码。**
  1. **末尾候选分支（swipes）数据链路修复**：`swipeIndex` / `swipeReasonings` 纳入 messages Store 记录并双向往返，重启后不再丢失候选推理；候选追加、5 条容量与先进先出淘汰、固化统一收口到 `src/domain/chat/messageSwipes.ts`（原先"重掷生成""候选翻页""下一轮固化"三条路径各写一份隐式约定）；`MessageSwiper` 不再条件调用 Hook（修掉 `lint:changed` 的 rules-of-hooks 错误）。
  2. **固化不再清空派生记忆**：`updateSessionMessage` 在正文未变化（只剥离候选字段）时跳过记忆片段、事实与记忆字典的失效，避免发下一条消息或候选翻页时静默丢掉最新一轮抽取结果；新增 fake-indexeddb 回归用例锁定"未变更保留 / 变更失效"两种语义。
  3. **同源核心提示词只注入一次**：SillyTavern 常把同一段正文同时放在根字段与 `prompts[main]`，此前传统路径会注入两遍、界面却已隐藏第二个入口。新增 `domain/prompts/promptSourceBlocks`，导入边界、运行期组装与设置界面共用同一判定（空占位或完全同文才算同源，内容不同必须保留），并补导入侧回归。
  4. **流式超时改为自包含收口**：首字超时不再只依赖 abort 让 reader reject，而是在定时器内直接以 `StreamTimeoutError` 结束生成，避免底层流以 cancel→done 语义时生成器永久挂起（新增探针回归）；`DEFAULT_CHUNK_HEARTBEAT_TIMEOUT_MS` 由 25s 调整为 60s —— 调研结论：SillyTavern 无流式超时，Open WebUI 块间空闲超时默认关闭，NextChat 总超时 60s（思考模型 300s），OpenAI / Anthropic SDK 总超时 600s；本仓库改造前同样是 60s，长思考模型仍可按请求覆盖。
  5. **死代码清理**：删除 `presetRuntimeMigration` 模块（恒返回原样）、`PromptWorkbenchFocusContext` 与主布局专注模式残留、`enablePromptComposition` 实验开关、`LEGACY_DEFAULT_PROMPT_PATTERNS` / `TABLE_MEMORY_PROMPT_MARKER` 与三个不再上报的启动诊断码；架构守卫改为断言这些入口不得回归。
  6. **门禁与文档同步**：更新 `usePresetBundles`、`presetSelectorSection`、`presetBootstrap`、`twoPhaseTimeout` 等测试到"出厂预设无特权 / 导入不自动启用编排 / 心跳 60s"的新契约；`CURRENT_STATE.md` 预设段落改写为"工作台已移除、出厂预设与导入预设同权"；`.gitignore` 忽略 `apk_download/`。
  验证：`npm run lint`、`npm run lint:changed`、`npm run check:i18n`、`npm test`、架构边界守卫与 `npm run build` 全部通过。
- 2026-10-01：**发布 v1.9.1，彻底排查并根治预设修改不生效与脱钩缺陷。**
  1. **版本升级至 v1.9.1**：通过规范脚本 `npm run bump-version patch` 一致性同步 8 处版本入口（`package.json`、`package-lock.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`public/version`、`README.md`、`docs/index.html`），并通过 `npm run check:version` 校验。
  2. **采样调节预设脱钩根治**：定位到历史遗留缺陷 —— `SamplersSection.tsx` 滑块在 `onChange` 时硬编码了 `id: "custom"`，导致用户只要拖动任一滑块（温度、Top-P、重复惩罚、Max Tokens），当前预设的 ID 瞬间被冲掉为 `"custom"`。由于没有预设包的 `sampler.id` 为 `"custom"`，导致：活跃预设匹配立即返回 `undefined`、`activeBundleId` 置空、预设下拉选框丢失高亮、脏检查永久判定为 false、保存按钮被强制禁用、修改无法持久化；且已有会话在发送时因快照重新读取旧预设，导致修改在聊天中无法生效。修复：彻底移除 `id: "custom"`，保持活跃预设 ID 不变，并改用原子函数式更新器 `updateSettings((prev) => ...)`。
  3. **权威活跃预设定位与自愈**：在 `presetBundleLifecycle.ts` 中新增 `resolveActivePresetBundle` 统一入口，支持四级兜底（`sampler.id` → `bundle.id` → `sampler.name` → 内置预设 → 首个预设）。在 `useSettingsLoader` 启动引导中增加自动自愈机制：若检测到本地库已存有历史 `"custom"` 脏 ID 或孤立 ID，自动按名称与活跃预设包校准并写回修复，让老用户历史数据无缝恢复。
  4. **提示词模块并发与闭包安全**：`useCustomPrompts.ts` 的新增、编辑、删除与开关全面收敛为函数式状态更新，消除 stale closure 竞争与深合并对象属性丢失问题。
  5. **端到端闭环测试**：新增 `tests/vitest/presetSaveEffectiveness.test.ts`，验证调节采样、脏检查触发、保存到预设、会话会话快照解析生效以及历史脏数据自愈全流程；全量 165 个测试文件、1141 个单元测试全部通过。
- 2026-10-01：**自由编排升级为工作流画布（Workflow Canvas）并打通预设闭环与生态实测。**
  1. **SillyTavern 200+ 大预设兼容扩容**：针对社区大型模块化预设（如《双人成行-银麒数据版》《双星纪》《绘绘绘》等 200~275 个区块）因防腐阈值导致的导入拒绝，将领域 `MAX_BLOCKS` 放宽至 2000、`MAX_NAME_LENGTH` 放宽至 300；实测验证 `D:\Download` 目录下全部 8 款社区真实 SillyTavern 预设 100% 导入、编译与双向往返保真导出成功（零错误）。
  2. **工作流节点模版库（Workflow Node Library）**：新增 `src/components/presetForm/workflowNodeLibrary.ts` 与选择弹窗 `WorkflowNodeLibraryDialog.tsx`，内置角色卡人设、动态世界书扫描点、对话历史窗口（全量/最近20条）、深度破联规则（in-chat depth 4）、剧情记忆与表格状态、思维链推演等标准功能节点模版，一键插入当前工作流流水线。
  3. **预设与画布一体化控制**：新增 `CanvasPresetBanner.tsx`，在画布顶栏直接呈现当前活跃预设名称与快速切换、未保存修改（脏状态）高亮提示、一键保存到当前预设及另存为副本按钮；会话冻结行为预设时提示影响范围；传统模式下提供「一键升级为自由编排」无损切换入口。
  4. **组件组合根与界面打通**：`PresetForm.tsx` 向 `PromptCompositionEditor.tsx` 完整透传预设管理能力（`savedPresets`/`activeBundleId`/`isActivePresetDirty`/保存回调）；底部工具栏扩充为四列高密度响应式基元。新增单元测试 `WorkflowCanvasIntegration.test.tsx` 并全绿通过，既有架构边界守卫与 19 项编排测试零回归。
- 2026-10-01：**预设实体 v2 领域核心落地（尚未切换存储与消费方）。** 新增 `src/domain/presets/`：`contracts`（Zod 实体契约 —— `schemaVersion: 2`、采样、`prompt`（`version`/`mode`/`source`/`composition`）为唯一 Prompt 权威、正则、只读兼容块 `legacyPromptConfig`、未知字段保真袋 `extensions`）、`promptSnapshot`（v1 快照规则从应用层迁入领域，使 v1 读取与 v1→v2 迁移共用同一实现）、`bundleMigration`（v1→v2 读取迁移：构造候选 → 实体 schema 校验 → 逐级降级修复 → 记录诊断；越界采样值按字段单独丢弃而不是整包作废、非对象正则条目丢弃并留诊断、未知键进 `extensions` 保真保存）。新增应用层唯一投影 `presetProjection`，运行期只经它取得 `PromptConfig` 与采样补丁；对照测试证明投影结果与 v1 `resolvePresetBundleActivation` 在 5 类预设形态（内置/旧预设/自由编排/废弃字段/自定义）上逐字一致。验证：`npm run lint`、6 个相关测试文件 50 用例通过。
- 2026-10-01：**预设实体 v2 全面切换（存储边界 + 全部消费方）。** `UserSettings.savedPresets` 现在是 `PresetBundleV2[]`；存储读取（`settingsRepository`）经领域迁移入口 `readPresetBundleList`：v1 记录自动迁移、损坏记录逐级降级修复并留诊断、越界采样值按字段单独丢弃、未知字段进 `extensions` 保真保存，写入一律 v2。运行期激活统一经唯一投影 `projectPresetActivation`，界面层不再出现 v1 激活路径（架构守卫强制）；目录用例、启动引导、生命周期快照与脏检查、导入用例、备份信封全部持有 v2，备份恢复接受旧备份里的 v1 记录。`defaults.ts` 的内置预设保留可读 v1 字面量作为唯一来源并导出 v2 常量（`requirePresetBundleV2`），内置采样参数完整性 fail-fast。启动引导新增**出厂内容修订标记** `presetFactoryRevision`（可选设置字段，旧数据缺失即视为待迁移）：标记落后时只做一次旧出厂提示词识别并写回新标记，标记为当前值后不再按文本特征扫描、也不再改写用户可见提示词——取代原先每次启动的字符串启发式。同时移除死字段 `hasInjectedFormatPreset`、把 `handleUpdateCustomPrompt` 的 `role: any` 收口为角色联合类型，并把 `vitest.config.ts` 的 `testTimeout` 放宽到 20 秒（千条消息的 IndexedDB 重测试在满载并行下会被默认 5 秒误杀，表现为顺序相关的假红；单跑通过、全量失败）。验证：`npm run lint`、`npm run test:unit`（163 文件 / 1128 用例）、`npm test`（86 个系统套件）全部通过。
- 2026-10-01：**SillyTavern 预设解析单点化。** 同一套生态语义此前被实现了两遍（`preparePresetBundleImport` 与 `promptPresetAdapter` 各自解析 `prompts`/`prompt_order`、各自硬编码 `100001`、各自实现候选库丢弃与 `model → assistant`），必然漂移。现在唯一实现落在 `promptPresetAdapter`：排序语义抽为 `selectOrderedPromptEntries`（`prompt_order` 有则只保留排序条目、完全缺失则按 `prompts` 原序），角色映射抽为 `resolvePromptRole`，`100001` 只出现一次；通用导入用例改为逐字段消费 Codec 分析结果，删除了自身重复解析、重复的 `SillyTavernPresetAnalysis` 类型与 `as unknown as` 强转。Codec 契约新增可选能力 `readPresetPrompts?(input)`，适配器实现一次、插件注册一行；预先不传 Codec 的 `scripts/verify-preset-samples.ts` 改为注入同一 Codec，恢复分级与计数输出。**刻意的边界收窄**：Codec 未装载或第三方 Codec 未实现该可选能力时，SillyTavern 的 Prompt 候选降级为不入库（只导入通用预设字段）并产生 `COMPATIBILITY_CODEC_UNAVAILABLE` 警告——生态字段不再由通用用例兜底解析。验证：`npm run lint`、`npm run test:unit`、`npm test` 全部通过。
- 2026-10-01：**预设目录的读-改-写下沉到 application 用例。** `usePresetBundles` 原先在导入、另存为新预设、保存到当前预设、单个删除、批量删除五处各自重复「读 Store → 拼 nextSaved → 写 Store → 改 React 状态」，并发动作还会互相覆盖。新增 `application/useCases/presetCatalog.ts`：存储经 `PresetCatalogPort`（read/write）注入，`createPresetCatalog` 提供串行化的 `mutate`（前一个变更失败不阻断后续，错误仍抛给调用方），四个纯变换保持既有列表代数（追加 / 命中 id 原位覆盖 / 机械删除），内置预设保护仍由调用方前置过滤。Hook 只剩唯一一处端口装配。两处刻意修正并记录在案：删除动作的基准从"设置快照"改为 Preset Store 权威列表（旧实现在 Store 领先时会静默丢掉只存在于 Store 的预设）；导入路径改为先落库再改内存状态（与删除路径一致，写库失败时不再留下"内存已含、库里没有"的假记录）。
- 2026-10-01：**预设子系统清理与守卫。** 删除冻结门面 `utils/localDB.ts` 残留的 `getStoredSavedPresets`/`saveStoredSavedPresets` 重导出与 12 行 `hooks/settings/presetPromptConfig.ts` 兼容 shim（调用方直连用例层）；`mergeUtils` 去 `any` 并把「`savedPresets` 必须整体替换、禁止深合并」抽成具名常量；新增 `presetSettingsBoundary` 收口「预设拥有的字段禁止写入设置主记录」，消除加载器与持久化各自 `delete` 的隐式约定；清掉预设路径上的 `role: any`、`useRef<any>` 等历史 `any`；`PresetService` 注释里的「准则一/八/十」改为 `ARCH-KERNEL`/`ARCH-FLOW` 稳定标识。架构守卫新增三条：`presetCatalog` 必须存在、`usePresetBundles` 不得自己读库拼数组、启动加载器必须走 `presetBootstrap` 且不得内联出厂提示词启发式。验证：`npm run lint`、`npm run test:unit`、`npm test` 全部通过。
- 2026-10-01：**预设子系统重构第一步：启动期引导收口为可测用例。** 原先 `useSettingsLoader` 的 420 行 `useEffect` 同时承担预设引导与全局设置合并：拉取 `/default_presets.json` 后**就地改写模块级可变单例**、用 `includes("[NARRATIVE ENGINE:")` 这类字符串启发式判定旧出厂提示词并整块覆盖、无条件重建内置预设、在 Hook 内直接读写 `saved_presets_bundle`，且零测试覆盖。现在外部文件收口、内置预设重建、旧键迁移、旧出厂提示词升级、出厂区块迁移与活跃 Prompt 配置的最终形状全部进入无 IO 用例 `src/application/useCases/presetBootstrap.ts`，Hook 只做「读服务 → 调用例 → 写回」；`setMobileTavernBasicPresetBundle` 删除，内置预设改为常量，用例需要的人设、API、记忆等非预设字段仍留在 Hook。落库判断从"每次启动必写"改为按内容比较（`stableSerializePresetSnapshot` 与切换脏检查共用同一套比较语义），新增**幂等回归**：用第一次引导的结果再跑一次必须 `presetsDirty === false && settingsDirty === false`。行为口径未变：出厂内容迁移仍只作用于内置预设，导入预设即便命中同样文案也不被改写；外部静态文件只在数据库缺少主提示词时才拉取。验证：`npm run lint`、`npm run test:unit`（161 个文件 / 1107 个用例）、`npm test`（86 个系统套件）全部通过。
