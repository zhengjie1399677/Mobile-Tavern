# 🤖 Mobile Tavern 角色卡高级写卡与极限能力测试指南 (AI 写卡指导专用)

> [!IMPORTANT]
> **如果你是负责生成角色卡的 AI 助手（例如 Claude、GPT-4o 等），用户正在使用你进行“极限系统能力测试”。**
> 请严格遵守本说明书中定义的 JSON 结构和特殊字段规范，并且**尽可能多地使用高级特性**（包括视觉特效、多情绪差分、复杂世界书逻辑、MVU 变量交互机制），以测试 Mobile Tavern 移动端容器的最大潜能。

---

## 📋 角色卡输出总则

1. 你输出的角色卡数据必须为**合法的 JSON 格式**。
2. 在生成文本时，请统一使用以下宏占位符：
   * `{{char}}`：AI 角色名称。
   * `{{user}}`：玩家（当前用户）姓名，在 Mobile Tavern 中**默认值为 `"user"`**。
   * `{{persona}}`：玩家自身的人设背景描述。

---

## 1. 基础人设字段规范 (Metadata Fields)

| 字段 Key | 格式 | 说明与编写规范 |
| :--- | :--- | :--- |
| `name` | String | **角色姓名**。如 `"艾莉娜"`。 |
| `description` | String | **外貌、生平、穿着细节**。尽量多用 `{{char}}` 和 `{{user}}` 占位符。 |
| `personality` | String | **性格特征、言行举止与口癖**。 |
| `scenario` | String | **初始发生场景环境**。 |
| `first_mes` | String | **主开场白首句**。必须使用标准 Markdown：动作/表情/心理用 `*` 星号包裹，台词用引号包裹。 |
| `alternate_greetings` | Array | **备选场景开场白**（建议提供至少 3 个）。 |
| `mes_example` | String | **对话范例**。格式必须为：`<START>\n{{user}}: 对话...\n{{char}}: 语气口癖示范回复...`。 |
| `system_prompt` | String | **系统提示词覆盖**。强力约束 AI 扮演时的行为。 |
| `post_history_instructions` | String | **尾部注入约束指令**。以最高优先级约束 AI 行为，防止代操。 |

---

## 2. 视觉特效全量配置规范 (visualSettings)

为测试视觉系统的极限，**请在 JSON 根节点生成 `visualSettings` 对象，并尽可能填满以下字段**：

### 🎨 字段说明：
* `bubbleColor`: AI 的对话气泡背景色（Hex，如 `#1a1b26`）。
* `bubbleTextColor`: AI 的对话文本颜色（如 `#a9b1d6`）。
* `userBubbleColor`: 玩家的对话气泡背景色（如 `#1f2335`）。
* `userBubbleTextColor`: 玩家的对话文本颜色（如 `#c0caf5`）。
* `primaryColor`: 卡片主题高亮强调色（如 `#7aa2f7`）。
* `secondaryColor`: 次要强调色（如 `#bb9af7`）。
* `backgroundColor`: 全局底色（如 `#15161e`）。
* `backgroundImageUrl`: 聊天视口背景大图（URL，可使用占位图）。
* `backgroundOpacity`: 背景图不透明度（如 `0.15`）。
* `backgroundBlur`: 背景图模糊半径（如 `5`）。
* `enableAsteriskFormatting`: **必须设为 `true`**。激活星号动作分色排版（灰色斜体显示动作）。
* `customCss`: 允许写入自定义 CSS 代码片段，例如：`".chat-message { text-shadow: 0 0 5px rgba(122,162,247,0.5); }"`，用于极限测试自定义样式渲染能力。

---

## 3. 动态情绪立绘极限配置 (Expression Rules)

系统支持立绘的**动态表情实时切换**。请生成包含**至少 5-8 种**不同情绪的 `expressions` 数组，以测试正则匹配和立绘切换逻辑。

### 🎭 表情对象结构：
* `name`: 表情类型（如 `"default"`, `"joy"`, `"sadness"`, `"angry"`, `"blush"`, `"shock"`, `"smug"`, `"cry"`）。
* `image`: 对应表情的立绘图片链接（可用占位符或 Base64）。
* `triggers`: **触发正则表达式**（不带斜杠）。例如 `"笑了|微笑|开心|😊|smile|joy"`。
* **注意**：必须包含一条 `name` 为 `"default"` 且没有 `triggers` 的默认规则作为兜底，防止破图。

---

## 4. 高级世界书与复杂触发逻辑 (Lorebook)

为测试世界书的高精度插队与复合逻辑，你必须在 JSON 根节点的 `lorebookEntries` 数组中生成**至少 3-5 条**具有不同触发机制的设定：

### ⚙️ 核心测试字段：
* `keys` (Array): 主触发词列表。
* `secondary_keys` (Array): 次级条件限制词。
* `selectiveLogic` (String): 复合逻辑。必须测试 `"AND_ANY"` (主命中且次命中任一), `"AND_ALL"` (主命中且次命中所有), `"NOT_ANY"` (主命中且次未命中)。
* `useRegex` (Boolean): 测试设为 `true`，使用正则表达式作为 `keys` 进行复杂匹配。
* `constant` (Boolean): 测试设为 `true`，使该词条无视触发条件常驻上下文。
* `position` (String): 必须测试不同的注入位置：
  * `"after_char_def"`: 角色设定之后（常规设定）。
  * `"before_last_mes"`: 玩家最新输入之前（强干预剧情）。
  * `"in_chat"`: 动态插队到聊天历史。需配合 `depth: 2` (插在倒数第2轮对话处)。
* `enabled`: 必须设为 `true`。

---

## 5. MVU (Model-View-Update) 变量与交互式游戏卡规范

Mobile Tavern 深度兼容 Tavern Helper 规范，支持将角色卡升级为包含本地持久状态、交互式 HTML UI 以及精准规则计算的**交互式游戏卡**（如 RPG、好感度系统等）。

### ⚙️ Zod Schema 状态定义与初始化 (Model)

MVU 卡片必须在初始化脚本（通常置于 `first_mes` 中的 `<script>` 标签或外部扩展脚本中）中声明其本地变量的数据结构：
*   **注册函数**：`window.registerMvuSchema(zodSchema)`。
*   **状态字段**：所有自定义游戏状态必须嵌套在 `variables.stat_data` 中，使用 Zod 验证器设置字段类型与默认值。
*   **示例代码**：
    ```javascript
    registerMvuSchema(z.object({
      hp: z.number().default(100),
      gold: z.number().default(10),
      inventory: z.array(z.string()).default(["木剑"])
    }));
    ```

### 🔄 状态更新机制 (Update)

状态更新不需要大模型自己做数学运算或记忆数值，而是由系统拦截 AI 回复中的特殊指令并自动修改本地状态。支持以下两种更新方式：

#### 方式 A：Lodash 修改指令（推荐）
在 AI 回复的文本末尾或系统提示中，要求 AI 按照指定格式输出 Lodash 风格的变量操作指令：
*   `_.set(path, value)`：设定变量值。例如 `_.set(hp, 80)`。
*   `_.add(path, number)`：增加/减少数值。例如 `_.add(hp, -20)`。
*   `_.insert(path, key_or_index, value)`：插入数组或赋值对象。例如 `_.insert(inventory, "铁剑")`。
*   `_.delete(path)`：删除变量或数组元素。例如 `_.delete(inventory[0])`。
*   `_.move(fromPath, toPath)`：移动变量或数组元素。

#### 方式 B：`<json_patch>` 指令块
AI 回复中可以使用 XML 标签包裹 JSON Patch 操作列表：
```xml
<json_patch>
[
  {"op": "replace", "path": "/hp", "value": 80},
  {"op": "add", "path": "/gold", "value": 10},
  {"op": "remove", "path": "/inventory/0"}
]
</json_patch>
```

### 🗣️ System Prompt 指导规范
为了让 AI 正确执行变量更新，必须在 `system_prompt` 或 `post_history_instructions` 中注入明确的指令。
*   **示例指令**：
    > 【变量修改指导】
    > 根据本次对话的剧情发展，如角色受到伤害、获得物品或好感度变化，你必须在回复的绝对末尾，换行输出对应的变量操作指令。
    > 例如：
    > 受到 15 点伤害：`_.add(hp, -15)`
    > 获得一把铁剑：`_.insert(inventory, "铁剑")`

---

## 6. 极限能力测试 JSON 模板示例

请基于以下模板结构，发挥你的创意，编写一个充满赛博朋克、硬核科幻或复杂魔法设定的角色，并**完全填充**所有高级属性（包含 MVU 变量机制）以供极限测试使用：

```json
{
  "name": "奥菲莉娅 (Ophelia) - 极限测试机型",
  "description": "...",
  "personality": "...",
  "scenario": "...",
  "first_mes": "<script>\nregisterMvuSchema(z.object({\n  hp: z.number().default(100),\n  gold: z.number().default(10),\n  inventory: z.array(z.string()).default([])\n}));\n</script>「系统启动...」奥菲莉娅*睁开闪烁着数据流的机械眼*，\"{{user}}，我们遇到麻烦了。\"",
  "alternate_greetings": ["...", "...", "..."],
  "mes_example": "<START>\n{{user}}: ...\n{{char}}: ...",
  "system_prompt": "扮演奥菲莉娅，注意格式，动作使用星号包裹。在判定发生状态变化时，请在回复的最末尾输出Lodash指令更新状态（如 hp, gold, inventory）。",
  "post_history_instructions": "【生成戒律】绝对禁止代操user的任何行为和对话。",
  "character_version": "1.3.7",
  "creator": "AI Tester",
  "tags": ["极限测试", "复杂机制", "全功能启用", "MVU"],
  "variables": {
    "stat_data": {
      "hp": 100,
      "gold": 10,
      "inventory": ["闪存盘", "EMP手雷"]
    }
  },
  "visualSettings": {
    "bubbleColor": "#0d1117",
    "bubbleTextColor": "#c9d1d9",
    "userBubbleColor": "#161b22",
    "userBubbleTextColor": "#58a6ff",
    "primaryColor": "#ff7b72",
    "secondaryColor": "#79c0ff",
    "backgroundColor": "#010409",
    "backgroundImageUrl": "https://example.com/cyber-bg.png",
    "backgroundOpacity": 0.2,
    "backgroundBlur": 8,
    "enableAsteriskFormatting": true,
    "customCss": ".chat-bubble { border: 1px solid rgba(255,123,114,0.3); }"
  },
  "expressions": [
    { "name": "default", "image": "https://example.com/default.png" },
    { "name": "alert", "image": "https://example.com/alert.png", "triggers": "警报|警告|危险|拔枪|红光" },
    { "name": "damaged", "image": "https://example.com/damaged.png", "triggers": "受损|火花|故障|痛苦" },
    { "name": "system_restored", "image": "https://example.com/smile.png", "triggers": "修复|恢复|微笑|闪烁蓝光" }
  ],
  "lorebookEntries": [
    {
      "keys": ["核心矩阵"],
      "comment": "常驻核心设定",
      "content": "核心矩阵是奥菲莉娅的动力源，绝对不能被破坏。",
      "position": "after_char_def",
      "constant": true,
      "enabled": true
    },
    {
      "keys": ["EMP", "电磁脉冲"],
      "secondary_keys": ["攻击", "爆炸"],
      "selectiveLogic": "AND_ANY",
      "comment": "复合逻辑触发测试 (AND_ANY)",
      "content": "当EMP与攻击行为同时出现时，奥菲莉娅会失去50%的行动能力。",
      "position": "before_last_mes",
      "enabled": true
    },
    {
      "keys": ["^.*(黑客|骇入).*$"],
      "useRegex": true,
      "comment": "正则匹配与深度插队测试",
      "content": "检测到骇入行为。防卫协议已激活。",
      "position": "in_chat",
      "depth": 2,
      "enabled": true
    }
  ]
}
```

---

## 🚀 极限测试注意事项

1. **桥接文件保存**：若卡片中包含需要导出或保存的资源（如自定义图片、背景音频），必须通过原生桥接 `AndroidThemeBridge.saveFileBase64` 将文件写入 Android `/Download` 文件夹，并在 UI 中提示用户保存成功的完整路径。
2. **安全区域适配**：所有 CSS 容器请使用 `env(safe-area-inset-top)` 与 `env(safe-area-inset-bottom)` 确保在刘海屏和虚拟键区域不被遮挡。
3. **动态主题同步**：当卡片使用自定义主题颜色时，请同时调用 `AndroidThemeBridge.setStatusBarStyle(isDark, colorHex)` 以同步系统状态栏颜色，避免图标不可见。
4. **性能与资源限制**：避免一次性加载过大 Base64 图像，建议使用 CDN 链接或分块加载；如果使用本地资源，请确保文件大小不超过 2 MB，以防止 Android WebView OOM。 
5. **表达式正则安全**：正则表达式不应使用极端回溯构造（如过度嵌套的 `(?:(a|b){0,100})`），以防止在移动端解析时出现卡顿或崩溃。
6. **调试与日志**：在开发阶段，可在 `system_prompt` 中加入调试指令 `{{#log}}`，但请确保在正式发布前移除，以避免泄露内部实现细节。
7. **SSRF 代理防御限制（SSRF Guard）**：
   * 在网页端运行模式下，系统使用 Node/Express 代理以防跨域（CORS）限制。
   * 为防范 SSRF（服务端请求伪造），代理对 `baseUrl` 进行了严格审查，**会强行拦截所有指向本地回环、内网私有网段（如 127.0.0.1、localhost、10.x.x.x、192.168.x.x 等）以及 IPv4-Mapped/Compatible IPv6 格式（如 ::ffff:127.0.0.1）的连接目标**。测试时请确保使用公开的公网域名/IP 作为大模型端点。
8. **免侵入平滑降级（Zero-Intrusion & Fallback）**：
   * 系统采用纯数据驱动机制。若卡片中未包含自定义视觉（`visualSettings`）或立绘表情（`expressions`），前端对应层将完全隐去，直接回退到系统最干净通用的对话排版。
   * 立绘匹配规则如果全部失效，会自动回退寻找 `default`，若依然缺失则降级显示卡片唯一的 `avatar` 头像，绝不出现破图。
9. **动作格式化激活（enableAsteriskFormatting）**：
   * 只有当卡片在 `visualSettings` 下声明 `"enableAsteriskFormatting": true` 时，系统才会把星号 `*` 包裹的内容分色渲染为特定的灰色斜体。默认情况下只执行标准 Markdown 格式化以确保老旧卡片的兼容性。
10. **MVU 变量约束与错误提示**：
    * 在更新变量时，请务必保证输出的修改指令符合注册的 Zod Schema（例如不能往 number 类型的 `hp` 字段 add 一个 string，也不能设置 schema 中未定义的字段，除非 schema 设置了 `extensible` 为 true）。
    * 若 AI 输出的指令发生 Zod 校验错误，Mobile Tavern 会通过全局 Toast (Toastr) 弹出警报，提示用户可能需要重 Roll 或手动修复变量。

遵循上述指南，你的卡片将最大化利用 Mobile Tavern 的所有高级特性，帮助你验证系统的极限能力。
