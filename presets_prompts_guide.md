# 🤖 Mobile Tavern 角色卡高级写卡与极限能力测试指南 (AI 写卡指导专用)

> [!IMPORTANT]
> **如果你是负责生成角色卡的 AI 助手（例如 Claude、GPT-4o 等），用户正在使用你进行“极限系统能力测试”。**
> 请严格遵守本说明书中定义的 JSON 结构和特殊字段规范，并且**尽可能多地使用高级特性**（包括视觉特效、多情绪差分、复杂世界书逻辑），以测试 Mobile Tavern 移动端容器的最大潜能。

---

## 📋 角色卡输出总则

你输出的角色卡数据必须为**合法的 JSON 格式**。
在生成文本时，请统一使用以下宏占位符：
*   `{{char}}`：AI 角色名称。
*   `{{user}}`：玩家（当前用户）姓名，在 Mobile Tavern 中**默认值为 `"user"`**。
*   `{{persona}}`：玩家自身的人设背景描述。

---

## 1. 基础人设字段规范 (Metadata Fields)

必须生成以下所有标准人设字段，以保证设定的丰富度：

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

为了测试视觉系统的极限，**请必须在 JSON 根节点生成 `visualSettings` 对象，并尽可能填满以下字段**：

### 🎨 字段说明：
*   **`bubbleColor`**: AI 的对话气泡背景色（Hex，如 `#1a1b26`）。
*   **`bubbleTextColor`**: AI 的对话文本颜色（如 `#a9b1d6`）。
*   **`userBubbleColor`**: 玩家的对话气泡背景色（如 `#1f2335`）。
*   **`userBubbleTextColor`**: 玩家的对话文本颜色（如 `#c0caf5`）。
*   **`primaryColor`**: 卡片主题高亮强调色（如 `#7aa2f7`）。
*   **`secondaryColor`**: 次要强调色（如 `#bb9af7`）。
*   **`backgroundColor`**: 全局底色（如 `#15161e`）。
*   **`backgroundImageUrl`**: 聊天视口背景大图（URL，可使用占位图）。
*   **`backgroundOpacity`**: 背景图不透明度（如 `0.15`）。
*   **`backgroundBlur`**: 背景图模糊半径（如 `5`）。
*   **`enableAsteriskFormatting`**: **必须设为 `true`**。激活星号动作分色排版（灰色斜体显示动作）。
*   **`customCss`**: 允许写入自定义 CSS 代码片段，例如：`".chat-message { text-shadow: 0 0 5px rgba(122,162,247,0.5); }"`，用于极限测试自定义样式渲染能力。

---

## 3. 动态情绪立绘极限配置 (Expression Rules)

系统支持立绘的**动态表情实时切换**。
你必须生成包含**至少 5-8 种**不同情绪的 `expressions` 数组，以测试正则匹配和立绘切换逻辑。

### 🎭 表情对象结构：
*   **`name`**: 表情类型（如 `"default"`, `"joy"`, `"sadness"`, `"angry"`, `"blush"`, `"shock"`, `"smug"`, `"cry"`）。
*   **`image`**: 对应表情的立绘图片链接（可用占位符或 Base64）。
*   **`triggers`**: **触发正则表达式**。不带斜杠的正则匹配串。例如 `"笑了|微笑|开心|😊|smile|joy"`。
*   **注意**：必须包含一条 `name` 为 `"default"` 且没有 `triggers` 的默认规则作为兜底，防止破图。

---

## 4. 高级世界书与复杂触发逻辑 (Lorebook)

为了测试世界书的高精度插队与复合逻辑，你必须在 JSON 根节点的 `lorebookEntries` 数组中生成**至少 3-5 条**具有不同触发机制的设定：

### ⚙️ 核心测试字段：
*   **`keys`** (Array): 主触发词列表。
*   **`secondary_keys`** (Array): 次级条件限制词。
*   **`selectiveLogic`** (String): 复合逻辑。必须测试 `"AND_ANY"` (主命中且次命中任一), `"AND_ALL"` (主命中且次命中所有), `"NOT_ANY"` (主命中且次未命中)。
*   **`useRegex`** (Boolean): 测试设为 `true`，使用正则表达式作为 `keys` 进行复杂匹配。
*   **`constant`** (Boolean): 测试设为 `true`，使该词条无视触发条件常驻上下文。
*   **`position`** (String): 必须测试不同的注入位置：
    *   `"after_char_def"`: 角色设定之后（常规设定）。
    *   `"before_last_mes"`: 玩家最新输入之前（强干预剧情）。
    *   `"in_chat"`: 动态插队到聊天历史。需配合 `depth: 2` (插在倒数第2轮对话处)。
*   **`enabled`**: 必须设为 `true`。

---

## 5. 极限能力测试 JSON 模板示例

请基于以下模板结构，发挥你的创意，编写一个充满赛博朋克、硬核科幻或复杂魔法设定的角色，并**完全填充**所有高级属性以供极限测试使用：

```json
{
  "name": "奥菲莉娅 (Ophelia) - 极限测试机型",
  "description": "...",
  "personality": "...",
  "scenario": "...",
  "first_mes": "「系统启动...」奥菲莉娅*睁开闪烁着数据流的机械眼*，「user，我们遇到麻烦了。」",
  "alternate_greetings": ["...", "...", "..."],
  "mes_example": "<START>\n{{user}}: ...\n{{char}}: ...",
  "system_prompt": "扮演奥菲莉娅，注意格式，动作使用星号包裹...",
  "post_history_instructions": "【生成戒律】绝对禁止代操user的任何行为和对话。",
  "character_version": "1.3.7",
  "creator": "AI Tester",
  "tags": ["极限测试", "复杂机制", "全功能启用"],
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
