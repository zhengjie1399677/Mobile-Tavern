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
- 数据库附着、Agent Marker、TavernHelper/远程脚本和前端 DOM 生命周期不属于通用预设兼容范围，不得因样本流行度绕过边界。

### 5. Runtime Plugin 边界与旧数据降级

- SillyTavern 兼容实现只由 `mobile-tavern.sillytavern-compat` 受信 Runtime Plugin 接入；Database、Prompt、Script、聊天 Hook 和通用 UI 只能依赖 `CompatibilityRuntimeService` 的类型化贡献契约。
- `mobile-tavern.base` 必须在不装载兼容插件时继续提供基础 Agent、纯文本聊天、多模态附件和通用工具；兼容插件卸载时必须清理贡献、Bridge、iframe 运行态和生成标记。
- 会话插件状态以 `runtimePluginState["mobile-tavern.sillytavern-compat"]` 为新权威位置。迁移期写入同时镜像至旧 `variables`，读取优先命名空间，缺失时读取旧字段；不得批量改写旧会话或静默删除未知插件状态。
- TavernHelper 全局对象只属于 Renderer/Bridge 实现细节，通用生产代码不得直接读写；状态同步、脚本库就绪检查和 iframe 构建必须经 Renderer 契约。
- 阶段 5 的 Profile UI 可以关闭整个 SillyTavern Compatibility Runtime；关闭后六类贡献均不得注册，普通 Agent 聊天和多模态底座仍应工作。
- 旧 `session.variables` 停止双写前，必须先把 TavernHelper bridge/mocks 和变量抽屉的全部写入口迁入插件命名空间并完成旧角色卡回归；未完成前保留双写属于 `CHANGE-SAFE`，不得为追求清理数量提前删除。
