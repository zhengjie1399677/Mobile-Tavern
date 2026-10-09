# 2026 年 10 月变更记录

- 2026-10-10：**旧 WebView 降级配色层（Chrome <111 可读性修复）+ 工作台图表换口径与性能收口。**
  1. **旧 WebView 降级层**：`src/index.css` 末尾新增 `@supports not (color: oklch(0% 0 0))`，5 个主题 × 19 个颜色变量 + 83 个 Tailwind 调色板变量改为等价 hex（与原 oklch 逐通道等价、对比度抽样未劣化）；半透明表面靠产物中 `@supports` 之外的基线声明自动退化为接近原色的实色底（已用产物逐条核对：只存在于 `@supports` 内的声明数 = 0）。自检第 9 项 `<111` 由 `OK (>=100)` 改为 WARNING；新增两条守卫（降级层完整且干净、调色板覆盖含数量下限），并做反向验证（改坏标记 → 用例失败）。根因：Tailwind v4 产物含 183 处 `oklch()`、989 处 `color-mix()`，Chrome 108 WebView 整条丢弃 → 面板无底色（透明）→ 两层页面文字叠在一起。
  2. **工作台换口径**：图表不再读"已水合消息窗口"（目录会话 `messages` 恒空、只有当前会话最近 50 条），改为经新增 `infrastructure/storage/repositories/activityMetricsRepository`（`createdAt` 索引 + `IDBKeyRange`）读取持久化消息的真实聚合；配套新增领域分桶 `domain/analytics/activityAggregation`、用例 `application/useCases/workbenchActivityUseCases`（版本键缓存）、唯一 Provider `components/workbench/WorkbenchActivityProvider` 与 `hooks/useLocalDayClock`（跨午夜统一基准）。冷启动即可见完整历史，"总会话数"改用目录口径。
  3. **性能**：4 张活跃卡片共享同一份聚合（不再各扫一遍，有用例断言只触发 1 次加载）、6 张卡 `React.memo`、罗盘拖动 rAF 合帧 + 落盘防抖、非工作台页签不重算、流式期间仅重启防抖且版本未变不扫描。
  4. **脉冲图**：修掉 `preserveAspectRatio="none"` 导致的点被拉成椭圆、x 轴标签与数据点不同坐标系、面积基线 70 与 viewBox 75 不一致、基准虚线错位，删除死变量 `maxVal`；`todayKey` 挂载即冻结造成的跨午夜错位（罗盘把记录写回昨天）一并修复。
  5. **未做（列为建议，未改语义）**：四套归一化并存、排行卡用元数据而热力卡用消息、"平均 tok/s"为逐条平均、存储卡 `estimate()` 失败时填假数据却显示"健康"、排行"共 N 个会话"仍是已加载页数、日历热力窗口 120 天。**未做真机/Playwright 视觉验证**。

- 2026-10-09：**排查"部分 Android 机型整屏看不清 + 点不动"并加固现场取证；清理编排时代文档遗留；预设表单拆分与 8 语言文案补全。**
  1. **诊断盲区（确定缺陷，已修）**：主题/遮挡层自检此前只扫 `#root`，而 Base UI 弹层默认 portal 到 `<body>`（`dialog-overlay` 是 `fixed inset-0 bg-black/75`）——弹层遮罩压住屏幕时报告必然显示"无遮挡层"。扫描面改为 `document.body`，报告附 `data-slot` 与 `backdrop-filter` 取值，并新增两条用例。
  2. **渲染层取证**：新增运行期错误黑匣子（`src/utils/runtimeErrorLog.ts`，挂在既有唯一捕获点 `installGlobalErrorHandlers` 上，不重复注册监听），第 14 项报告列出最近 5 条；`index.html` 静态声明 `<meta name="color-scheme" content="dark light">`，防止 WebView 在应用接管主题前做"算法深色"；写入遮罩去掉 `backdrop-blur-[2px]`，并在卡住超过 10s 时先落日志（部分 WebView 会把大面积 `backdrop-filter` 合成成不透明黑，而该层正是故障时唯一还在显示的东西）。
  2b. **底色缺陷（确定缺陷，已修）**：`index.html` 曾用 `background-color: #0d1726 !important` 写死 `html/body`，把 `index.css` 的 `html,body{bg-background}` 永久压掉——任何"内容区没画上底色"的瞬间都会暴露成整块深蓝/近黑，环境光晕照旧画在其上，现场即"整屏发黑"。改为 `var(--background, #0d1726)` 并去掉 `!important`（首帧前仍不白闪）。同时新增**文本度量与视口缩放探针**（第 14 项输出探针行盒比与 `visualViewport.scale`）："线条与文字重叠、字体看不清而计算样式全正常"的典型成因是系统字体缩放/字体回退改写了实际渲染尺寸，这类信息现在可被自检捕获。
  3. **文档清理**：`sillytavern_compat.md` 删除/重写 7 处编排时代条目（导入快照、`legacy` 编排草稿、双视图同步、撤销栈、连带删除提示、`PromptBundleV2.prompt` 权威、验收脚本输出列）；`module_contracts.md` 合并重复的迁移条目、补上"诊断由存储边界聚合落日志"、去掉"编排历史块"。
  4. **预设表单**：正则编辑 Modal 拆分为 `RegexEditorDialog.tsx`（`RegexManagementSection` 845 → 559 行，交互与 className 逐字保持），预设表单内 69 处硬编码中文转为 i18n 键并同步 8 个语言文件。
  5. **验证**：`tsc`、`check:i18n`（引用 1076 / 定义 1232 × 8 语言一致）、`npm test`（197 个 Vitest 文件 / 1371 例 + 86 个系统套件）全绿。**原始故障尚未复现**：等待反馈者截图与"底栏是否可点、故障前操作、滑动是否恢复"三项判别信息；若确认为 `backdrop-filter` 合成异常，再评估「显示兼容模式」开关。

- 2026-10-09：**预设子系统审查修复（两个数据丢失缺陷 + 读取边界加固 + 死代码清理）。**
  1. **修复"预设正则整条轨道被静默清空"**：编辑器字段 `scope` 曾随对象写进设置并进入预设快照，读取时因实体 schema `.strict()` 校验失败而在末级降级里清空**全部**正则。现在 `saveRegex` 经 `toPersistedRegexScript` 剥离编辑器字段，`bundleMigration.toRegexScripts` 改为逐条白名单构造 + 单条 schema 校验（未知字段只从该条剔除并留 `regex-script-fields-dropped` 诊断、坏条目单独丢弃），末级降级保留已校验脚本，不再整轨清空。
  2. **修复"单条脏记录让整份预设列表不可读"**：`readPresetBundleList` 逐条 try/catch，`id` 不符合实体契约（空串/超 200 字符）的记录按不可识别丢弃并留诊断；读取面不再有会抛错的 `parse`（`module_contracts.md` 早已明文禁止）。此前一条脏记录会让 `useSettingsLoader` 的加载整体中断（界面回落出厂默认、`isReady` 恒 false 导致设置不再落盘）。
  3. **迁移诊断可观测**：`settingsRepository.getStoredSavedPresets` 此前只取 `.bundles`、诊断被整体丢弃；现在按诊断码聚合输出 `console.warn`，静默降级至少可在日志里看到。
  4. **脏检查补齐"未声明即启用"开关**：`useMainPrompt`／`useJailbreak` 两侧统一按 `!== false` 折算（与 `PromptService` 同口径），修复"用户改了它却看不到未保存标记、保存按钮不可点、切换即静默还原"。
  5. **其余修复**：`substituteRegex` 界面默认值改为与运行期一致的 RAW(1)；角色轨 `regex_scripts` 统一经 `normalizeRegexScripts` 归一（对象形态不再让预设表单抛错白屏）；导入与删除活跃预设补"未保存修改"提示；内置主/规则提示词删除补二次确认；批量删除不再把内置伪条目纳入勾选；`trimStrings` 可正常键入逗号分隔的第二项；导入失败提示区分解析失败与存储失败，不再误报"格式错误"；预设切换时清空批量选择；折叠态写入移出 `setState` updater。
  6. **死代码与守卫**：删除 v1 激活路径等无消费者导出（`resolvePresetBundleActivation`／`applyPresetBundleActivation`／`PresetBundleSource`／`projectPresetRuntime`／`applyPresetPromptConfig`／`isBuiltinBundle`／`BUILTIN_*`／`PresetBundleV1Like`）、无消费者的 `presetForm/index.ts` barrel 与三处未使用导入；架构守卫补 `applyPresetBundleActivation` 并新增"v1 激活入口不得回归"断言；修正 v2 字样与指向已删测试文件的悬空注释。
  7. **测试**：新增 `tests/vitest/presetBundleMigration.test.ts`（14 例：未知字段不连坐兄弟脚本、超长 id、垃圾输入不抛错、修复前脏快照往返、干净快照无迁移写入）与 `tests/vitest/presetBundleLifecycle.test.ts`（7 例：脏检查含未声明即启用开关、快照形状、活跃预设定位）；`worldbook-preset.spec.ts` 的预设下拉断言改为匹配当前 Select 实现（原断言的原生 `<option>` 与 `📦/📄` 来源标识在代码中已不存在）。
  8. **验证**：`npx tsc --noEmit`、`npm run check:i18n`（8 语言新增 `preset_form.confirm_delete_builtin_prompt`）、`npm test`（197 个 Vitest 文件 / 1368 例 + 86 个系统套件）全绿。**未纳入本次**：`RegexManagementSection.tsx`（837 行）按职责拆分、界面硬编码中文转 i18n 键、预设 e2e 需在真机/浏览器环境实际跑一遍确认。

- 2026-10-09：**彻底删除「自由编排（Prompt 组装）」整条链路；预设实体升级到 v3。**
  1. **删除范围**：`src/domain/prompt-composition/**`（10 个文件）、`PromptCompositionRuntimeAdapter`、`PromptCompositionAssembly`、`domain/presets/promptSnapshot`、`promptSwitchSync`，以及 8 个编排专用 Vitest 与 `tests/suites/promptComposition.test.ts`。运行时 `PromptService` 只保留传统路径；`promptHistoryUseCases`、`MemoryAudit`、`publishMemoryAudit` 去掉编排判断与 `traces` 参数。
  2. **预设实体 v3（`schemaVersion: 3`，无兼容期）**：形状收敛为 `{schemaVersion, id, isBuiltin?, sampler, promptConfig, regexScripts, extensions?}`——`prompt` 编排快照整体删除，`legacyPromptConfig` 更名为 `promptConfig` 并成为**唯一 Prompt 权威**，`PromptConfig.composition`/`usePromptComposition`、`UserSettings.promptCompositionTemplates`、`SavedPresetBundle.promptPlan/composition/usePromptComposition`、`PromptPresetPlan*` 与 `SillyTavernPresetAnalysis` 全部移除。`bundleMigration` 重写为 v1/v2 → v3：只读取传统 Prompt 字段，v1 的 `promptPlan`/`composition`/`usePromptComposition` 与 v2 的 `prompt` 一律丢弃，未知键继续进 `extensions`，损坏记录仍逐级降级而不是失效。
  3. **Compatibility Codec 收窄**：契约去掉 `canDecode`/`decode`/`analyze`/`encode`，只保留可选 `readPresetPrompts`（来源 Prompt 候选列表 → 传统提示词块）；`promptPresetAdapter` 只保留该解析与其辅助函数；导入/导出用例不再产出或消费编排快照，导出始终按传统列表生成 `prompts` 与 `prompt_order`。
  4. **列表侧身份收口**：编排消失后不再需要双视图同步，新增领域函数 `setPromptBlockEnabledById` / `removePromptBlocksByIds`（`domain/prompts/promptBlockIdentity`）替代原 `promptSwitchSync`，沿用「有 `id` 只按 `id` 命中、缺 `id` 回落 `identifier`」口径，未命中/无变化时返回原数组以避免空写。
  5. **已声明的功能后果（不是回归）**：`ContextContribution` 的记忆召回仍在传统路径生效并进入审计；**非记忆类来源（时钟 `{{date}}` 等、兼容插件 `context.source`）此前只有编排适配器一个注入点，现在没有注入点**，仅参与读取与审计——该缺口已写入 `context_source_seam_design.md` 顶部，待提示词重构时接线。导入兼容分级（`level: full/core/recognize_only`）随之删除。
  6. **验证**：`npm run quality:push` 全绿（`tsc`、全仓 ESLint、`check:i18n`、全部 Vitest、86 个系统套件、web 与 server 构建）；新增 `tests/vitest/presetEntityV3.test.ts` 钉住 v1/v2→v3 迁移与列表身份口径。`check:i18n` 同步删除 8 语言 `prompt_composer.*` 死键（死键总数 389 → 157）。编排专用用例随功能删除，传统字段导入导出的回归覆盖待后续补强（`preparePresetBundleImport/Export.test.ts`、`presetEntityV2`、`presetBundleLifecycle`、`usePresetBundles`、`promptBlockIdentity` 等文件已删除或改写）。

- 2026-10-09：**修复"设备型号误报为 wv"，给写入遮罩加逃生入口，自检新增主题/遮挡层诊断（用户反馈"整屏看不清 + 点不动"）。**
  1. **机型解析（确定缺陷）**：`getDeviceModel()` 取 Android UA 括号段里分号的**最后一段**，而 WebView UA 的最后一段是 `wv` 标记、机型在带 `Build/` 的段里，于是所有 Android WebView 用户都被上报成"设备型号：wv"（线上系统报告实测）。改为 `parseAndroidDeviceModel()`：优先取 `Build/` 段并剥掉 `Build/…`；无 `Build/` 时取 Android 段之后第一个非占位段，`wv`、Chrome UA Reduction 的占位 `K` 等不计入机型；识别不出机型时回退 `Android Device (Android X)`。
  2. **写入遮罩逃生入口**：`DbWritingOverlay` 覆盖整个视口（含底栏）并吞掉点击，只要某次 IndexedDB 写入的 `await` 不返回，界面就会永久停在"整屏变暗 + 点不动"，只能杀进程。现在超时 10s 后在浮层内给出「关闭」按钮，Android 返回键（优先级 1500，高于弹窗返回栈）同样可释放遮挡。释放只解除遮挡，**写入本身照常提交**，不改动存储语义。
  3. **自检新增 `14. THEME / OVERLAY`**：新模块 `themeDiagnostics.ts` 采集 `data-theme`、`color-scheme`（inline / computed / meta / `prefers-color-scheme`）、五个主题变量的原始值与解析出的 sRGB、`#root` 实际生效的文字色与背景色及 WCAG 对比度（<2.5 报 ERROR、<4.5 报 WARNING）、环境光晕挂载状态，以及**当前覆盖视口且拦截点击的浮层清单**（排除 `pointer-events:none` 的装饰层与不足视口 90% 的弹层）。"文字与背景撞色"和"有遮罩压在最上层"这两类成因因此可以在报告里直接区分，不必再靠截图反推。诊断只读 DOM，不触碰存储，也不需要 Kernel 服务。
  4. **边界**：不新增全屏遮罩、不改写入队列与主题配色语义、不调整版本号；新增 i18n 键 `db.writing_overlay_timeout` 已同步 8 个语言文件。
  5. **验证**：新增 `tests/vitest/deviceModel.test.ts`（6 例：WebView Build 段、带空格机型、无 Build 段、只有 `wv`、UA Reduction、非 Android）、`tests/vitest/themeDiagnostics.test.ts`（11 例：`oklch/oklab/color(srgb)` 颜色解析、对比度与合成、遮挡层扫描、报告四种分支）、`tests/vitest/DbWritingOverlay.test.tsx`（4 例：无写入不挂载、未超时无入口、超时关闭、返回键释放）；`npx tsc --noEmit` 通过。

- 2026-10-09：**修复预设子条目改名的三类缺陷（用户反馈）。**
  1. **改内置「系统提示词 / 规则提示词」的名字不再平转成新模组**：此前第一次按键就把伪条目平转成自定义模组、换掉条目标识，手风琴 `value` 随之变化，展开态与输入焦点当场丢失，名字只能敲一个字符。现在显示名单独存进 `PromptConfig.mainPromptName` / `jailbreakPromptName`（留空或等于界面默认文案时不落库，仍然跟随语言），只有**角色**调整才继续平转（角色不是顶层字段能表达的属性）；导出到 SillyTavern 文件时经 `extensions.mobile_tavern_preset.promptRuntime` 往返保留。
  2. **同 identifier 的条目不再联动改名/开关/删除**：新增 `ensureUniquePromptBlockIds` 在启动引导、预设存储读取、预设导入三个边界给缺失或冲突的条目补确定性唯一 `id`（保留 `identifier` 作为兼容别名），并把列表侧匹配改为「有 `id` 就只按 `id` 命中」；SillyTavern 复制条目带出的重复 identifier 不再让一条操作牵连另一条。
  3. **搜索态下改名不再让条目当场消失**：手风琴展开态改为受控，`displayedPrompts` 始终保留展开中的条目，避免改名到不匹配关键字时卡片被过滤掉、输入框卸载导致改名中断。
  4. **顺带统一正则脚本身份**：新增 `regexScriptKey` / `upsertRegexScriptByKey`，全局与预设轨此前只比较 `r.id === reg.id`，两个都缺 `id` 时会 `undefined === undefined` 命中，保存一条就把列表里所有缺 id 脚本一起覆盖；现在三轨（全局/预设/角色）的 key、开关、删除、编辑保存共用同一身份口径。
  5. **验证**：新增 `promptBlockIdentity.test.ts`（5 用例）与 `regexScriptIdentity.test.ts`（3 用例），`PromptsConfigSection.test.tsx` 增补 3 条改名行为回归；`npm run quality:push` 全绿（210 文件 / 1476 用例、87 个系统套件、web 与 server 构建）。
  6. **已知残留（不在本次范围）**：编排（自由编排）侧的同步键是 `compatibility.originalIdentifier`，按设计保存 SillyTavern 原始 identifier 以便往返导出；因此两条同 identifier 的条目在**编排视图**里开关仍会互相牵连（列表与编辑器侧已按唯一 `id` 精确命中）。彻底修复需要决定"导入时是否把重复 identifier 改写成唯一值"，会改变 ST 往返身份，属兼容契约变更，留待单独评估；已在 `promptSwitchSync.ts` 头部注明。
  7. **审查补充（推送前自查发现）**：正则轨的 UI 已改用 `regexScriptKey`（缺 `id` 回落到 `scriptName`）作为列表身份，但 `usePresetFormState` 里的开关与删除仍按 `r.id`/`r.scriptName` 手工比对，导致**缺 `id` 的历史脚本点开关静默无效**（旧实现则会命中所有缺 `id` 的脚本）。现在三轨统一走领域函数 `setRegexScriptDisabledByKey` / `removeRegexScriptByKey`：只命中目标脚本，未命中或状态未变化时返回原数组，调用方据此跳过无意义的设置写入与角色卡保存；`RegexManagementSection` 的角色轨 `targetId` 同步改为同一身份函数。`regexScriptIdentity.test.ts` 增补 2 条（连坐与空写回归）。

- 2026-10-09：**遥测补齐：事件自定义字段不再丢失，所有事件自动携带玩家/角色/模型/会话；发布 v1.9.3（用户反馈"日志一堆未知"）。**
  1. **根因（两层丢失 + 一层缺失）**：`TelemetryService.buildLog` 只回填固定列，`keyboard_viewport_diagnostic` 的视口尺寸、`ar_*` 的 status 等自定义字段在 JS 侧构建日志时就被丢掉；即便透传，Rust `TelemetryLog` 也是封闭结构体，serde 默认忽略未知字段，落盘与上传前再丢一次。归属信息方面，`player_name`/`session_id` 此前只有 `api_error` 与 `llm_performance` 手工传参，其余事件一律是"未知/无"。
  2. **修法（三处）**：`buildLog` 把未命中固定列的 `extraData` 键原样展开进日志体（固定列后置，事件载荷不能覆盖 schema 列）；`TelemetryLog` 新增 `#[serde(default, flatten)] extra: BTreeMap<String, serde_json::Value>`，未知字段在落盘、序列化、再次读取三个环节都保留；新增遥测归属上下文 `ITelemetryService.setContext()`，由 `AppContextAssembler` 在玩家/角色/模型/会话变化时注入一次，解析顺序为"事件显式传参 → 活跃上下文 → 既有兜底值"。
  3. **口径补齐**：新增固定列 `device_platform`（WebView 上报的设备/架构串，`platform` 仍固定为宿主 "Tauri"）与 `chat_session_started_at`（聊天会话创建时间，ISO 8601 UTC），并把 `session_start_time` / `session_duration_sec` 在代码与结构体注释中明确为 **App 进程会话**，不再与 `session_id` 的聊天会话混淆；归属上下文改为模块级共享，`utils/telemetry.ts` 在 Kernel 尚未注册遥测服务时的兜底实例同样带上归属信息。
  4. **边界**：上下文覆盖式写入（换角色、清空会话不能残留旧归属）；未设置上下文时行为与旧版一致（未知/无/空）；旧版客户端日志与 `rust_panic` 日志无 `extra`/`device_platform`/`chat_session_started_at` 字段仍可反序列化。
  5. **版本来源修正**：workspace 根 `Cargo.lock` 才是 cargo 实际读取的锁文件，此前 `bump-version` 只更新 `src-tauri/Cargo.lock`，导致根锁里 `app` 版本长期停在 1.8.8。脚本与 `version_bump.md` 已纳入根锁，本次 `bump-version patch` 同步 9 个文件，`npm run check:version` 通过。
  6. **验证**：`cargo test --lib telemetry` 3/3 通过（含自定义字段往返保留、旧日志兼容、新列默认值）；新增 `tests/vitest/telemetryService.test.ts` 7 用例（上下文注入、显式传参优先、兜底值不回归、覆盖式清空、固定列不被覆盖、设备/会话新列、跨实例共享）；`npm run lint` 通过；`npm test` 208 文件 / 1465 用例、87 个系统套件全绿。

- 2026-10-08：**MCP 气泡内部"子条目"支持单独收起（用户反馈）。**
  1. 展开的来源行新增「收起」按钮：只折叠该来源的工具列表，**不关闭整个气泡**；
  2. 选中工具后的参数/结果区头部新增 ×（`收起工具面板`）：清空当前工具选择并回到列表，来源保持展开，可继续选别的工具；
  3. 新增 `tests/vitest/McpChatPopover.test.tsx` 钉住两条收敛行为（面板本体保持打开）；全量单测 1445 通过，lint / eslint 全绿。

- 2026-10-07：**MCP 降级为默认关闭的手动能力：总开关 / 只手动调用 / 结果只插数据。**
  1. **总开关（默认关）**：新增 `UserSettings.enableExternalCapabilities`（默认 false）与运行时门禁 `externalCapabilityGate`；`ExternalSourceRuntimeService` 启动时不再擅自连接来源，设置加载或用户拨开关后才 `reload()`（关闭即断开、清空诊断）。工作台「扩展能力」卡片加总开关与关闭态说明。
  2. **不强行显示**：聊天快捷栏的 MCP 入口只在总开关打开时渲染；关闭时输入 `/tool` 会明确提示"去工作台开启"。
  3. **只允许手动调用**：`resolveSessionEnabledToolNames` 永久过滤 `mcp.*`——模型不再获得任何外部来源工具，从根上杜绝自动调用与提示词污染；调用只走聊天内手动 `testCallTool`。
  4. **结果只插数据**：取消自动发送；调用成功后气泡内显示结果预览，提供「插入输入框 / 复制 / 重试」。插入只取数据正文（新增 `extractToolResultData`，取 `{text,raw,isError}.text`），绝不插 JSON 包装；`isError` 结果不提供插入、也不进入对话。
  5. **气泡可关**：头部 ×、Android 返回键（`useMobileBackHandler`，优先级高于聊天页返回）、Escape 与点击外部；面板最大高度收窄到 52dvh，留出可点的外部区域。
  6. **模板分类纠错**：`mcp.wiki` 由"角色扮演向"改为"通用查询"，描述改为"MCP 协议文档 wiki，偏开发/文档向"；空分组自动隐藏。
  7. **测试**：单测 1443 通过（新增门禁、数据提取、组合过滤用例；更新 ToolCapabilitiesWidget / sessionToolComposition 断言）；E2E 重写为"默认无入口 → 打开总开关 → 开合气泡（×/Escape/外点）"，桌面 + 移动通过。

- 2026-10-07：**MCP 入口挪进快捷栏；快捷栏「重载上一段剧情」精简为「重发」。**
  1. `McpChatPopover` 新增 `triggerVariant`（bar/icon）：气泡触发按钮从输入框行内图标改为快捷栏里的「MCP」按钮（输入框「+」→「快捷栏」展开后可见），仍锚定气泡、不受虚拟键盘遮挡；`/tool <查询>` 继续直接打开同一气泡。
  2. zh-CN / zh-TW 的 `chat_input.reroll_last` 由「重载上一段剧情」精简为「重发 / 重發」（该键仅用于快捷栏）。
  3. E2E 更新为"先展开快捷栏再点 MCP 按钮"的路径，桌面 + 移动全绿。

- 2026-10-07：**修复聊天 MCP 气泡弹层调用多参数工具报 `-32602 Invalid arguments`（GitMCP 等）。**
  1. **根因**：弹层此前只把输入框草稿映射到单个"主参数"，`owner` / `repo` 这类必填项保持为空，被 MCP 服务端按严格 schema 拒绝；用户看到的就是"调用失败：Invalid arguments for tool …"。
  2. **修法**：按工具 JSON Schema 生成**逐参数表单**——必填标 `*`，string/number/boolean/JSON 各自控件；`query`/`prompt` 等查询类字段用草稿自动带入；草稿里出现 `owner/repo` 形态时自动拆分给 owner / repo，出现 URL 时带入 url；调用前本地校验必填项，缺参直接内联提示，不再打到服务端。
  3. **顺带**：工具描述按两行截断（此前长描述撑满列表）。
  4. **测试**：`listToolArgumentFields` / `deriveInitialToolArguments` / `buildToolArguments` / `findMissingRequiredArguments` 均有单测覆盖；气泡 E2E（按钮 / `/tool` / 空态跳工作台）保持全绿。

- 2026-10-07：**聊天内 MCP 改为气泡弹层（Popover），删除底部大面板；工作台布局动效保留。**
  1. **MCP 形态重做**：删除 `ExternalToolInvocationSheet`（全屏底部面板：按布局视口定位，虚拟键盘弹出时底部按钮被遮挡、位置与安全区也容易错位），改为输入框左侧「MCP 能力」按钮锚定的 Base UI Popover。面板内直接完成聊天侧设置：来源启停（同步自动挂载）、连通状态、工具清单；选中工具后用输入框草稿自动匹配主参数（query/prompt 等）并显式调用，结果格式化后作为上下文送入当前会话；空态与页脚都可一键跳工作台「扩展能力」。`/tool <查询>` 命令保留并打开同一气泡。
  2. **逻辑与 UI 解耦**：主参数推导、结果序列化、送入对话的格式化抽到 `components/externalTools/externalToolInvocation.ts`，单测直接覆盖；气泡组件只负责交互与设置。
  3. **布局动效保留**：布局编辑器保留跟手位移、周边避让缓动与长按禁选文本等改动；同步更新断言与选择器（标题「编辑布局」→「工作台布局」）。
  4. **测试**：`externalToolInvocation.test.ts` 改指新模块；`mcp-invoke-entry.spec.ts` 重写为气泡流程（按钮打开 / `/tool` 打开 / 空态跳工作台）；`workbench-layout-drag.spec.ts` 与 `WorkbenchTab.test.tsx` 同步新标题。桌面 + 移动 E2E 全绿，全量单测 1440 通过。

- 2026-10-07：**按"完全回退到分叉节点、不回退外部长期记忆"重做分支状态语义。**
  1. **状态回退补全**：回溯分支此前只从消息快照恢复变量/状态表，快照缺失（旧会话、外部导入历史）就直接没有状态；现在新增 `IScriptService.replayMvuState()`——从角色基线开始，按消息前缀逐条重放 AI 消息里的 MVU 指令（store 变换 + `parseMvuMessage`，带无指令快速跳过），把变量真正回退到分叉节点。
  2. **去除伪造状态表**：旧实现给"无快照的中段分支"调用 `initDefaultSheets()` 造一份默认表，等于凭空发明历史（违反 `runtime_boundaries.md` 的"缺失状态不得伪造"）。现在只认节点快照 / 分支点在末尾时的当前表，否则保持 `undefined` 由运行时按缺失降级。
  3. **节点状态一起回退**：`pinnedMessageIds` / `mutedMessageIds` 按分支内新消息 ID 重映射后继承，`activePromptSceneProfileId` 一并复制。
  4. **长期记忆不回退**：新增 `domain/chat/branchState`（`carryOverBranchMemory` / `remapBranchMessageIds`），把源会话当前的词典、事件片段、时态事实整体复制进新分支——会话与主键重写、来源消息映射到分支内新 ID、supersede 链保持、分叉点之后的来源引用原样保留（那条记忆本就属于外部时间线）。记忆复制失败时回滚刚创建的分支，不留半成品。
  5. **测试**：`branchState.test.ts` 覆盖重映射（含 supersede 链与"分叉点之后引用保持原样"）；`backtrackBranchState.test.ts` 用 fake-indexeddb 跑通四条：中段分叉取节点快照、无快照回放 MVU 且不造表、回忆控制/场景/长期记忆完整携带、记忆复制失败回滚分支。全量单测与质量门禁通过。

- 2026-10-07：**审查并修复角色卡聊天"平行宇宙"分支；修复预设正则被来源判定跳过、工作台拖动、卡片 HUD 残留与聊天内 MCP 显性调用。**
  1. **平行宇宙只剩空柱（分支审查主问题）**：sessions Store 拆分后 `queryDirectory` 返回的 `session.messages` 恒为空数组，宇宙图给每条分支画出的时间柱长度都是 0，轮次节点与记忆晶体全部不可见。新增 `loadUniverseSessionsForCharacter()`（`sessionDirectoryUseCases`）按会话补最近 160 条消息窗口后，`SessionManagerModal` 用它渲染；每个会话最多水合 40 条分支。
  2. **记忆晶体挂错节点（轮次错位）**：图里用"渲染下标 + 1"去匹配 `fragment.sourceTurnEnd`，而碎片写的是 messages Store 的绝对 `turnIndex`（0 基，`commitTurn` 分配）。现在统一用 `message.turnIndex` 做节点身份与碎片匹配，审计回调也传绝对轮次；`MemoryFragmentEditor` 只把展示文案改为 1 基。
  3. **预设正则的 AI 输出脚本整条被跳过**：`FormattedText` 用 `activeSession.messages[messageIndex].sender` 反查消息来源，而 `messageIndex` 是渲染列表下标——野牛静默消息被过滤后两者错位，AI 消息被判成用户消息，`placement=[2]`（AI 输出）的预设/角色卡正则不执行（双星纪的思维链美化即此类）。现在来源由 `MessageBubble` 显式传入 `isAiMessage`，虚拟列表也改传会话绝对下标；depth、iframe id 同步修正。
  4. **折叠容器被渲染白名单拆壳**：预设的 CoT 美化产出的是 `<details class="jdg"><summary>…</summary>…</details>`，而通用渲染白名单既不含 `details`/`summary`，于是即使正则命中也会被拆掉包壳、思维内容仍然裸露（用户看到的现象就是"正则没生效"）。白名单补上 `details`/`summary`，`details[open]` 按布尔属性处理（不是空字符串告警）。
  5. **预设正则字段自愈**：老版本的设置记录里没有 `presetRegexScripts` 字段（预设正则早于该字段），启动时从活跃预设包回填一次（仅在字段缺失时，用户主动清空不会复活）；`verify-preset-samples` 脚本字段名 `presetRegexScripts` 修正为 v2 实体的 `regexScripts`（此前恒显示 0，掩盖问题）。
  6. **工作台拖动仍未生效**：长按后才设 `touch-action:none` 在 Android 上是无效的（手势开始时就已决定是否滚动），浏览器随后发 `pointercancel` 把拖动掐断。现在行体固定 `touch-action: pan-y` 保留滚动，拖动激活后由 window 上**非被动 `touchmove`** 阻断默认滚动，并在列表上下边缘自动滚动；抓手仍可立即拖动。
  7. **卡片 HUD 残留（白星星）**：主 Tab 是 Keep-Alive，退回首页不会卸载聊天页，原清理 effect 只在切换角色/会话时运行；隐藏 iframe 还在继续把 HUD 写回父页面。`HiddenScriptLayer` 新增 `isVisible`：聊天页不可见即卸载后台脚本 iframe 并执行残留回收；`startCompatibilityDomResidueGuard` 的观察范围从"顶层节点"扩到子树，覆盖挂在 `#root` 内部的悬浮节点（仍以 `__react*` 标记保护 React 节点）。
  8. **MCP 在正文聊天里调用不了**：生成链路只读会话冻结快照的 `contributionOrder.tool`，工作台里新启用的来源对已有会话永远不可见。新增唯一解析入口 `resolveSessionEnabledToolNames()`（冻结快照也叠加当前已启用外部来源；直连 API 角色仍不暴露工具），发送链路与 Agent Handle 共用。另加**显性调用**：输入区快捷栏「调用能力」按钮与 `/tool` 命令打开 `ExternalToolInvocationSheet`，用草稿文本自动匹配工具、预填主参数（query/prompt 等），调用结果格式化后作为上下文送入对话。
  9. **测试**：单元侧新增 `sessionDirectoryUseCases.test.ts`（空会话补消息窗口/已水合不重复读）、`BranchUniverseDiagram.test.tsx`（绝对轮次匹配）、`formattedTextRegexGating.test.tsx`（显式来源门控正反两例）、`sessionToolComposition.test.ts`（冻结快照叠加外部来源、直连 API 不暴露工具）、`externalToolInvocation.test.ts`（主参数推导与结果截断）、`parentDomResidue.test.ts`（子树回收 + React 标记保护）、`formattedTextRuntime.test.ts`（`details/summary` 保留与 `open` 布尔处理）；端到端新增 `preset-regex-render.spec.ts`（预设展示正则折叠并点击展开、野牛静默消息下标错位、平行宇宙非活跃分支水合、受信卡脚本注入父页面 HUD 后退出即回收）、`workbench-layout-drag.spec.ts`（CDP 真实触摸序列长按拖动并持久化）、`mcp-invoke-entry.spec.ts`（快捷栏按钮与 `/tool` 命令都能打开调用面板），桌面与移动项目共 12 次全绿。反向验证：临时还原旧实现时，错位用例、平行宇宙用例、HUD 回收用例与触摸拖动用例都会失败（已逐条实测）。
  10. **已知的既有 E2E 债务（非本轮引入）**：`worldbook-preset.spec.ts` 仍在断言已被 Keep-Alive 页签与自定义下拉替换掉的旧 DOM（全局 `getByText` 命中隐藏页签、`option` 列表断言），`ui-performance.spec.ts` 仍在断言底栏字号 ≥12px 而当前实现是 10px；对应 UI 文件在本轮提交中零改动。全量 `test:e2e` 目前为 39 通过 / 5 失败（均为上述既有用例），待单独收口。

- 2026-10-07：**修复卡片 iframe 白屏（多个角色卡受影响）、工作台拖动失效、HUD 残留，并让 MCP 启用即挂载。**
  1. **白屏根因（关键）**：`SafeIframe` 的清理 effect 依赖 `srcDocStoreKey`，而该 key 每次渲染都会变（带 `Date.now()`）。于是每次重渲染都会执行"清空 srcdoc + 跳 `about:blank`"，把同一 DOM 节点上刚写好的卡片内容擦掉——表现为卡片 iframe 变成一整块白屏（多个卡片、首次进入尤其明显，重新进入因不再重渲染才正常）。现在 store key 变化只回收旧 key 内存，**绝不再碰 iframe 本体**；只有真正卸载时才清空。桌面探针实测：修复前 `srcdocLength=0`，修复后 `srcdocLength=57078`、iframe 内部 DOM 16944 字符。
  2. **工作台拖动**：长按判定期间即把该行 `touch-action` 设为 `none`（此前 Android WebView 会在长按窗口内先启动滚动并发出 `pointercancel`，表现"完全拖不动"）；抓手按下额外 `setPointerCapture`。
  3. **HUD 残留**：新增 `startCompatibilityDomResidueGuard()`（经 Renderer 契约暴露为 `startDomResidueGuard`）：兼容脚本存活期间用 MutationObserver 记录父页面顶层新增节点，卸载时回收其中**没有 React 标记**（`__react*` 自有属性）且不在 `#root` 内的节点——覆盖没有 id/class 的注入物（例如角色卡 HUD 的悬浮星形），与既有的命名约定兜底互补。
  4. **MCP 启用即挂载**：新增 `syncExternalSourceToolMounts`，工作台启停来源时自动把该来源工具加入/移出**当前自定义 Profile** 的显式清单（内置 Profile 本身隐式包含所有启用来源，无需改动）；新会话即自动带上。同时按用户反馈**移除开发向预置与分组**（grep.app / GitMCP / GitHub），只保留角色扮演向（Wiki 知识检索）与通用查询（DeepWiki、Brave 搜索）。

- 2026-10-07：**修复「装配」里角色无法选择：内置 Profile 只读状态缺可执行入口。**
  1. **根因**：`AgentProfileEditor` 以 `editable = !profile.builtin` 控制全部控件，内置的 Tavern Agent / Base Agent 属于只读模板，于是「1. 角色」下拉整体 `disabled`——用户看到"需要有效角色"却怎么也选不了。原提示只有一行小字"先点击复制，再编辑副本"，没有可点击入口。
  2. **修法**：只读提示升级为高对比度告警块，并内置「**复制并编辑副本**」按钮（调用既有 `copyProfile` 流程：提示命名 → 复制 → 切换到副本并把编辑器留在打开状态，副本可直接编辑）。
  3. **预填**：新增 `defaultCharacterId`，档案未绑定角色时用当前会话/当前角色预填「1. 角色」，不再是空选项。

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
