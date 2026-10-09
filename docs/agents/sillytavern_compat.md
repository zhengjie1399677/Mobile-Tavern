# SillyTavern 生态兼容与底层原则

> [!IMPORTANT]
> **此文件为 Mobile Tavern 行为指导手册的子规范，定义了生态兼容、外部化指令以及降级容错的具体细则。**

---

### 1. ⚠️【最高指令：纯底层兼容运行底座原则】
**严禁在系统代码内硬编码（写死）任何具体的行为引导（如剧情总结提示词）、对话前缀/后缀、安全破限（Jailbreak）提示词、分句前标、特定中英文动作/表情匹配正则等。**
*   **必须外部化**：所有这一类用以指导、引导或规范 AI 模型的生成指令，必须通过外部数据（如角色卡、世界书、用户自定义预设包、自定义指令模组）来导入。
*   **必须可调节/可关闭**：系统可以提供基于上述外部数据的默认行为，但所有此类机制必须在用户界面（UI）提供直观的开关、输入框或删除按钮，允许用户完全关闭、编辑或删除它们，严禁由系统代码强制生效且不可移除。

### 2. 纯数据驱动与零硬编码
*   **禁止硬编码特定角色逻辑**：禁止在系统代码内硬编码任何特定角色专属的逻辑、中文词汇匹配过滤、特定名称的表情关联或写死样式数值。例如：
    *   *错误做法*：在系统代码内硬编码“笑了”、“哭泣”等特定情绪的中文判断正则来直接指定表情切换。
    *   *正确做法*：应当由角色卡自身在扩展字段中定义 ExpressionRule（触发规则与图片强绑定），每个规则自带正则表达式匹配串（`triggers`）和对应的图片（`image`），系统只读取并使用 `new RegExp` 进行动态计算。

### 3. 零侵入与平滑降级设计
*   **按需渲染 (Zero-Intrusion)**：若用户导入的角色卡不含任何自定义视觉（Expressions / custom style / background）扩展配置，系统对应的主题、立绘背景层等渲染容器必须完全隐藏不占位，确保回退到系统最干净、通用的默认聊天布局。
*   **安全兜底 (Fallback)**：
    *   在数据解析与图片选取逻辑中，若没有匹配到具体的规则，优先寻找角色卡内声明的 `"default"` 或 `"neutral"` 默认表情。
    *   若依然安全缺失，则平滑降级使用卡片的唯一主头像（`avatar`），严禁抛错或显示破碎图片的占位。
*   **格式处理按需激活**：系统绝不在未经卡片或用户配置明确要求的情况下，强行转换玩家的文本排版格式。
    *   默认情况下，文本解析器执行标准 Markdown 渲染（如将星号 `*` 渲染为同色斜体文字，但不修改字体颜色）。
    *   只有当导入的角色卡在 `visualSettings` 或扩展配置中显式声明了格式要求（例如配置了 `enableAsteriskFormatting: true`）时，系统才激活分色渲染机制，将星号包围的文字转换为柔和的灰色斜体以突出对白，实现向后兼容。

### 4. 预设真实样本验收

- 仓库测试只保存从社区样本提炼的结构快照，不提交作者提示词、样式或脚本正文。
- 本地原文件通过 `npm run verify:preset-samples -- <文件路径...>` 验收；工具只输出文件名、大小、提示词与正则计数、诊断数量和耗时，不输出预设内容（导入兼容分级已随编排链路删除）。
- 预设导入遵循 ST Prompt Manager 语义：只有 `prompt_order` 中排序的 Prompt 转为传统提示词块（`customPrompts`，顺序与启用状态照搬）；未排序的候选 Prompt 仅存在于 ST 候选库、不进入管理器列表，因此不导入，并产生 `SKIPPED_UNORDERED_PROMPTS` 警告。完全没有 `prompt_order` 时降级保留全部 Prompt，避免静默丢失。
- 导入必须自包含：外部文件自带 Prompt 字段（`prompts`/`prompt_order`/主提示词等）时，内容字段只能来自文件，未表达即不写入预设包（记忆表提示词、区块标题、`roleplayMode`、`useMainPrompt`、推理指引、`renderingFormat` 等应用专有字段保持缺失，由运行时出厂默认兜底），不得固化出厂内容、也不得用"当前预设"的字段补位；只有传输结构字段（Instruct 模板、序列前后缀、Story 排列、请求整形）沿用基底；只有纯采样预设（完全不含 Prompt 字段）才允许沿用当前 Prompt。
- 切换预设必须整体替换：目标预设未声明的字段回到运行时默认，禁止沿用上一个预设的值（历史缺陷：未声明这些字段的预设会沿用上一个预设的开关与文案，在对应运行模式下改变真实请求）。受影响字段按运行模式分别是——传统扮演模式：`requestShaping`（合并/压缩/预填充/停止串）、`tableMemoryPrompt`；非扮演模式：`enableReasoningGuidance`、`reasoningGuidancePrompt`、`usePostHistory` / `postHistoryPrompt`、`renderingFormat`。
- 预设激活必须整体替换：切换、导入激活与删除回退只允许改采样、Prompt 快照与预设正则三个字段，并必须经函数式 `updateSettings` 通道落库——值形式 updater 会先求 `getNestedDelta`（只遍历 next 的键）再 `deepMerge`（只覆盖不删除），无法表达"删除字段"，会把上一个预设未声明的运行期字段残留到新预设。
- ST 文件无法表达的运行期开关与提示词字段（`useMainPrompt`、`useJailbreak`、`usePostHistory`、推理指引、记忆表提示词、`sectionHeaders`、`renderingFormat`、`roleplayMode`）随导出写入 `extensions.mobile_tavern_preset`（版本 1）；导入优先恢复该命名空间，未知版本只告警并忽略，不影响通用字段导入。
- 预设子条目身份必须唯一且稳定：`customPrompts` 是唯一的条目列表，边界（启动引导、存储读取、导入）统一经 `ensureUniquePromptBlockIds` 给缺失或冲突的条目补确定性 `id`，匹配口径为「有 `id` 只按 `id` 命中、缺 `id` 回落 `identifier`」（SillyTavern 复制条目会带出重复 identifier，混用两者会让一条操作牵连另一条）。开关/删除只作用于 `customPrompts`，未命中或无变化时返回原数组以避免空写。
- 「底层扮演系统指令」（`useMainPrompt`）与「规则提示词」（`useJailbreak`）按"未声明即启用"解读，运行期一律用 `!== false` 判定与界面一致；`usePostHistory` 未声明即关闭，同样是界面与请求共用的判据。任何"界面显示开启、请求里却是空的"都属于缺陷。预设脏检查必须用同一口径，否则用户改了它既看不到未保存标记、也点不动保存，切换预设时被静默还原。
- 出厂内容迁移（补齐/修复内置提示词区块、回填默认主提示词与记忆表提示词、统一 system 角色）只允许作用于内置预设；自定义与导入预设必须原样保留，禁止由系统代码注入行为引导区块。
- 启动期预设引导必须由**无 IO 用例**完成（`src/application/useCases/presetBootstrap.ts`）：外部静态文件收口、内置预设重建、`saved_presets_bundle` 旧键迁移、旧出厂提示词整块升级与活跃 Prompt 配置的最终形状都在那里；Hook 只允许「读服务 → 调用例 → 写回」，禁止在 Hook 内再解释预设语义或读写存储。
- 内置预设必须是常量：禁止模块级可变单例在启动时被外部文件就地改写（历史缺陷：`setMobileTavernBasicPresetBundle` 会让"导入顺序决定默认值"）。外部文件对内置预设的覆盖只能通过用例的显式返回值传递。
- 预设落库判断必须与切换脏检查共用同一套稳定序列化比较；引导结果必须幂等——同一份数据第二次引导不产生任何写入。
- 预设实体 `PresetBundle`（当前 `schemaVersion: 3`）的 `promptConfig` 是唯一 Prompt 权威：SillyTavern 来源的 Prompt 经 Compatibility Codec 收口为传统提示词块后只写入这里；未识别的来源字段只能进 `extensions` 保真保存，禁止通用代码解释。实体 schema 之外的键不得写进存储（编辑器自己的状态字段必须在落库前剥离）。
- 数据库附着、Agent Marker、TavernHelper/远程脚本和前端 DOM 生命周期不属于通用预设兼容范围，不得因样本流行度绕过边界。

### 5. Runtime Plugin 边界与旧数据降级

- SillyTavern 兼容实现只由 `mobile-tavern.sillytavern-compat` 受信 Runtime Plugin 接入；Database、Prompt、Script、聊天 Hook 和通用 UI 只能依赖 `CompatibilityRuntimeService` 的类型化贡献契约。
- SillyTavern `prompts`、`prompt_order`、Marker 与注入字段只能由 Compatibility Codec 转为传统提示词块；通用 Prompt 管线负责统一组装、请求整形和最终 Token 审计，不得反向识别 SillyTavern identifier。
- SillyTavern 预设解析在代码里只能有一份实现（`promptPresetAdapter`）：排序语义（`100001` 优先、完全缺失 `prompt_order` 时按 `prompts` 原序保留）、候选库丢弃与 `model → assistant` 映射都必须复用同一函数。通用导入用例只允许消费 Codec 的产物，禁止自行解析 `prompts`/`prompt_order`。
- Codec 未装载、或第三方 Codec 未实现可选能力 `readPresetPrompts` 时，SillyTavern 的 Prompt 候选只能降级为不入库（只导入通用预设字段）并产生 `COMPATIBILITY_CODEC_UNAVAILABLE` 警告；这是刻意的边界收窄，不再由通用用例兜底解析生态字段。预设样本验收脚本必须注入同一 Codec，否则分级与计数输出会失真。
- `mobile-tavern.base` 必须在不装载兼容插件时继续提供基础 Agent、纯文本聊天、多模态附件和通用工具；兼容插件卸载时必须清理贡献、Bridge、iframe 运行态和生成标记。
- 会话插件状态以 `runtimePluginState["mobile-tavern.sillytavern-compat"]` 为新权威位置。新写入不得再镜像至旧 `variables`；读取优先命名空间，缺失时读取旧字段。Bridge 需要旧形状时只能由 Compatibility Plugin 瞬时投影，并在 `setSessions`/`saveSession` 边界归一化回命名空间；不得批量改写旧会话或静默删除未知插件状态。
- TavernHelper 全局对象只属于 Renderer/Bridge 实现细节，通用生产代码不得直接读写；状态同步、脚本库就绪检查和 iframe 构建必须经 Renderer 契约。
- 阶段 5 的 Profile UI 可以关闭整个 SillyTavern Compatibility Runtime；关闭后七类贡献均不得注册，普通 Agent 聊天和多模态底座仍应工作。七类贡献为 Codec、Prompt Section、Context Source、Transform、State Reducer、World Info Resolver 和 Renderer。
- 旧 `session.variables` 仅作为历史数据读取降级源，生产持久化入口不得重新双写；角色卡 Bridge 内部、消息级 swipe 快照和设置级全局变量不是会话权威状态，必须保持边界名称清晰。

### 6. 角色卡脚本信任边界

- 角色卡 JavaScript 执行默认关闭，用户必须在设置中显式开启。
- 卡片脚本默认运行在 `sandbox="allow-scripts"` 的 opaque-origin iframe 中；容器必须在首个外部内容之前注入 CSP，默认禁止网络连接、表单提交和父窗口数据访问。
- 隔离 iframe 只能通过 `postMessage` 调用 Compatibility Runtime 的最小桥。宿主必须同时校验 `event.origin === "null"`、`event.source` 对应已登记隔离 iframe、sandbox 不含 `allow-same-origin`，并对方法、参数大小和危险键名使用白名单校验。目前允许的写操作仅为当前会话变量替换，另允许受限高度回报。
- `scriptSecurityMode="trusted"` 是显式受信完整兼容模式：为兼容旧 SillyTavern 脚本对 `window.parent` 和完整 `TavernHelper` 的同步访问，可恢复 `allow-same-origin` 与旧父窗口库继承。该模式不是安全沙盒，界面必须明确提示其可访问应用数据与原生能力。
- `scriptSecurityMode` 缺失时，新设置和未启用脚本的旧数据迁移为 `isolated`；为遵守 `CHANGE-SAFE`，已经启用脚本的旧设置迁移为 `trusted`，由用户确认兼容性后可手动切回隔离模式。
