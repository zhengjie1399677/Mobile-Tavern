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
- 本地原文件通过 `npm run verify:preset-samples -- <文件路径...>` 验收；工具只输出文件名、大小、兼容等级、计数、诊断数量和耗时，不输出预设内容。
- `full` 表示通用 Prompt 语义完整兼容；`core` 表示 Prompt 核心可用但插件脚本不执行；`recognize_only` 表示仅安全识别和降级导入。
- 预设导入遵循 ST Prompt Manager 语义：只有 `prompt_order` 中排序的 Prompt 转为编排区块（顺序与启用状态照搬）；未排序的候选 Prompt 仅存在于 ST 候选库、不进入管理器列表，因此不导入，并产生 `SKIPPED_UNORDERED_PROMPTS` 警告。完全没有 `prompt_order` 时降级保留全部 Prompt，避免静默丢失。
- 导入后的外部编排必须进入版本化 `promptPlan` 快照；`source="sillytavern"` 只用于来源与往返诊断，运行时只能消费中立 `PromptComposition`。用户暂不启用自由编排时仍要把快照保存在该预设内，禁止继承其他预设的编排。
- 旧 Mobile Tavern 预设缺少版本快照时明确按 `legacy` 运行，并生成独立、可见的迁移编排草稿；不得因为当前设置正启用自由编排而静默改变旧预设行为。
- 导入必须自包含：外部文件自带 Prompt 字段（`prompts`/`prompt_order`/主提示词等）时，内容字段只能来自文件，未表达即不写入预设包（记忆表提示词、区块标题、`roleplayMode`、`useMainPrompt`、推理指引、`renderingFormat` 等应用专有字段保持缺失，由运行时出厂默认兜底），不得固化出厂内容、也不得用"当前预设"的字段补位；只有传输结构字段（Instruct 模板、序列前后缀、Story 排列、请求整形）沿用基底；只有纯采样预设（完全不含 Prompt 字段）才允许沿用当前 Prompt。
- 切换预设必须整体替换：目标预设未声明的字段回到运行时默认，禁止沿用上一个预设的值（历史缺陷：未声明这些字段的预设会沿用上一个预设的开关与文案，在对应运行模式下改变真实请求）。受影响字段按运行模式分别是——传统扮演模式：`requestShaping`（合并/压缩/预填充/停止串）、`tableMemoryPrompt`；非扮演模式：`enableReasoningGuidance`、`reasoningGuidancePrompt`；自由编排模式：`prompt.postHistory`（来自 `usePostHistory` / `postHistoryPrompt`）、`renderingFormat`。
- 预设激活必须整体替换：切换、导入激活与删除回退只允许改采样、Prompt 快照与预设正则三个字段，并必须经函数式 `updateSettings` 通道落库——值形式 updater 会先求 `getNestedDelta`（只遍历 next 的键）再 `deepMerge`（只覆盖不删除），无法表达"删除字段"，会把上一个预设未声明的运行期字段残留到新预设。
- ST 文件无法表达的运行期开关与提示词字段（`useMainPrompt`、`useJailbreak`、`usePostHistory`、推理指引、记忆表提示词、`sectionHeaders`、`renderingFormat`、`roleplayMode`）随导出写入 `extensions.mobile_tavern_preset`（版本 1）；导入优先恢复该命名空间，未知版本只告警并忽略，不影响通用字段导入。
- 预设子条目必须两侧同源：`customPrompts`（传统列表）与 `composition.blocks`（自由编排）是同一批条目的两种视图，对应键为列表侧 `identifier || id`、区块侧 `compatibility.originalIdentifier`，两侧取值表达式必须一致否则同步静默失效。任一视图都要同时写另一侧（`promptSwitchSync`）；列表侧写入不依赖 `usePromptComposition` 是否开启。规则分三类——①**开关**双向同步；②**删除**双向连带（编排删区块连删列表条目，列表删条目连删同源区块，并统一经领域层 `removePromptBlocks` 清理场景方案的 `blockStates`）；③**内容与新增不自动同步**（外部预设区块的模板可能是数据源宏而非条目正文，按正文回写会破坏语义；列表新增条目在编排模式下不生效属已知边界，需显式设计）。编排侧纯开关写入（含撤销/重做）只在"两次编排之间仅有开关变化"时回写列表，新增/复制/排序/改模板/导入模板等结构变更绝不回写（复制区块会带出重复 identifier，用那时那版状态覆盖列表会误改无关条目）。切换编排模式时把即将失去视图权的一侧镜像进即将生效的一侧。
- 编排编辑器的撤销栈记录的是「编排 + 提示词列表」整份快照（`PromptSwitchSnapshot`），不是只有编排：删除会连带删掉列表条目，只记编排会导致撤销后区块回来了、列表条目回不来，两侧立刻重新不一致。因此删除必须走 `commitSnapshot` 一次性写入两侧；外部列表写入只更新当前值并作废旧历史，避免回退覆盖用户新改动。
- 连带删除必须有可见提示：编排侧与列表侧的删除确认文案都要说明会一并删除另一侧的同源条目（8 个语言同步），禁止静默连带删除用户数据。
- 「底层扮演系统指令」（`useMainPrompt`）与「规则提示词」（`useJailbreak`）在预设列表里按"未声明即启用"展示，传统路径与编排数据源必须同样用 `!== false` 判定与界面一致；`usePostHistory` 未声明即关闭，同样是两侧一致的判据。任何"界面显示开启、请求里却是空的"都属于缺陷。
- 出厂内容迁移（补齐/修复内置提示词区块、回填默认主提示词与记忆表提示词、统一 system 角色）只允许作用于内置预设；自定义与导入预设必须原样保留，禁止由系统代码注入行为引导区块。
- 数据库附着、Agent Marker、TavernHelper/远程脚本和前端 DOM 生命周期不属于通用预设兼容范围，不得因样本流行度绕过边界。

### 5. Runtime Plugin 边界与旧数据降级

- SillyTavern 兼容实现只由 `mobile-tavern.sillytavern-compat` 受信 Runtime Plugin 接入；Database、Prompt、Script、聊天 Hook 和通用 UI 只能依赖 `CompatibilityRuntimeService` 的类型化贡献契约。
- SillyTavern `prompts`、`prompt_order`、Marker 与注入字段只能由 Compatibility Codec 转为中立编排；通用 Prompt 管线负责统一编译、请求整形和最终 Token 审计，不得反向识别 SillyTavern identifier。
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
