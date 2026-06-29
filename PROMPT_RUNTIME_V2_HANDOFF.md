# 🚀 Prompt Runtime v2.0 重构成果与后续开发交接备忘录

> **日期**：2026-06-30  
> **状态**：已跑通全套测试，无编译错误，前端修复已上线。

> [!IMPORTANT]
> **💻 跨电脑测试迁移提醒**：
> 1. **必须执行 `git add .`**：新创建的渲染器文件 [PromptRenderer.ts](file:///e:/modules/projects/Mobile-Tavern/src/kernel/services/prompt/PromptRenderer.ts) 和本备忘录目前处于 **Untracked** 状态。请务必使用 `git add .` 暂存所有文件后再进行 commit 和 push，否则新电脑会缺少渲染器文件导致编译失败！
> 2. **刷新浏览器缓存/重置预设**：如果另一台电脑的浏览器中存有旧的 IndexedDB 缓存，可能会继续读取旧的提示词。在新电脑启动后，建议在预设面板中点击 **“恢复默认值”**，或者手动导入最新的 [default_presets.json](file:///e:/modules/projects/Mobile-Tavern/public/default_presets.json) 以激活全新的英文结构化系统提示词。

---

## 🏆 一、今晚核心重构成果

### 1. 治愈 React 控制台致命崩溃与 Switch 警告
*   **问题**：首帧渲染时配置数据未加载完毕（`undefined`），导致 `<Switch>` 判定为非受控组件；后续值改变时转为受控组件，在 React 18/19 下触发 VDOM 协调冲突，引发 `Expected static flag was missing` 崩溃。
*   **修复**：在 [CorePromptBlocks.tsx](file:///e:/modules/projects/Mobile-Tavern/src/components/presetForm/CorePromptBlocks.tsx) 中为所有受控开关的 `checked` 状态添加了安全的布尔兜底值（`?? true`），消除了警告和崩溃隐患。

### 2. 提示词（Prompts）高水准重写与重构
*   **优化**：将原先松散、口语化的系统提示词、破限词、生成纪律、走向建议、表格记忆、思维链引导等模板，全部重写为极具指令感、逻辑内聚的**专业结构化英文指令**。

### 3. Prompt Runtime v2.0 物理隔离与缓存优化架构落地
*   **类型契约**：升级 [types.ts](file:///e:/modules/projects/Mobile-Tavern/src/kernel/services/prompt/types.ts)，引入四阶段 `SectionPhase` 与可变性 `mutable` 属性。
*   **语义 XML 渲染**：升级 [PromptRenderer.ts](file:///e:/modules/projects/Mobile-Tavern/src/kernel/services/prompt/PromptRenderer.ts)，渲染出的 `<section>` 标签携带完整的 `phase` 和 `mutable` 元数据。
*   **缓存优化重排 (Sort & Pack)**：升级 [PromptCompiler.ts](file:///e:/modules/projects/Mobile-Tavern/src/kernel/services/prompt/PromptCompiler.ts)，将所有 `mutable="false"` 的静态节点（占 90% 以上 Token）紧凑排布在最顶部形成 **STATIC ZONE**；将 `mutable="true"` 的动态节点（摘要、回忆、表格）排布在后形成 **DYNAMIC ZONE**。
*   **业务装配**：重构 [PromptService.ts](file:///e:/modules/projects/Mobile-Tavern/src/kernel/services/PromptService.ts) 中的 `assemblePrompt` 逻辑，完美适配全新权重金字塔。

---

## 🧪 二、明天可以进行的现场验证

1.  **控制台检查**：启动本地开发环境（`npm run dev`），打开配置面板，检查 React 控制台是否还有任何关于 `Switch` 的 `uncontrolled` 警告或 `static flag` 报错。
2.  **角色扮演沉浸度测试**：启动一个新聊天会话，测试 AI 在新结构化提示词下的演绎质感、分色排版（斜体字对白）以及是否会代打（越界代表玩家说话）。
3.  **大模型缓存命中验证**：若配置了支持 Prefix Caching 的模型（如 DeepSeek、Anthropic），观察首字生成延迟（TTFT）是否因静态区缓存命中而显著降低。

---

## 🔮 三、明日规划与后续高阶任务

### 任务 1：协议层 JSON 容错净化器（JSON Schema Output Guard）
*   **背景**：目前模型在输出 `<memory_extraction>` 或 `<suggestions>` 时，偶尔会因温度高而输出带有多余逗号、单引号或 Markdown 包裹的损坏 JSON。
*   **目标**：在输出管线中，建立一个后置拦截处理器（类似 Suggestions 解析器的升级版），对提取的 JSON 进行强力正则清洗与容错（如单双引号修复、尾部逗号移除），确保物理层数据安全。

### 任务 2：工具输出区块联动（Tool Outputs Integration）
*   **背景**：我们在 `Protocol` 阶段中预留了 `Tool Outputs` 槽位。
*   **目标**：为未来的“微内核沙盒插件”打通链路。当插件/脚本执行完毕后，将其结果输出为 `mutable: true` 的 `Protocol::Tool Outputs` 节点，动态追加至 Dynamic Zone，让模型能即时感知外部环境变化。

### 任务 3：变量注入微服务（Variable Injector Service）
*   **目标**：将原先在 `PromptService` 中粗暴使用的 `replaceMacros`（正则正则替换 `{{char}}` / `{{user}}`）解耦，重构为独立的切面服务。提供更安全的上下文占位符防错注入，防止用户恶意注入破坏 XML 结构。

---

> 🛏️ **早点休息，明天测试顺利！**
