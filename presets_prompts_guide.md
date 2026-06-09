# 🤖 Mobile Tavern 角色卡生成与扩写规范指南 (AI 写卡指导专用)

> [!IMPORTANT]
> **如果你是负责生成或扩写角色卡的 AI 助手（例如 Claude、GPT-4o 等）：**
> 1. **双轨世界书容器规范**：必须在根节点同时输出 `character_book` (包含 `name` 和 `entries` 数组) 与 `lorebookEntries` (Array)，且两者的 `entries` 数组内容和顺序必须完全一致，以确保 Mobile Tavern 在不同平台/版本导入时能 100% 成功加载设定。
> 2. **五个世界书标准**：设定集内必须且仅包含刚好 5 条条目（背景与世界观、{{char}}人设、{{user}}人设、LLM对话规避极端化核心规则、场景剧情与动态关系机制），每条条目采用标准占位格式。
> 3. **拒绝表情/立绘差分**：绝不要在角色卡中生成或包含任何表情差分/立绘配置数组（如 `expressions` 应该留空或不提供）。
> 4. **扩写保护与不缩水原则**：在对已有卡片进行扩写时，必须完整保留原有设定及每一行文本，只在相应条目中进行细节追加，严禁删改或减少已有内容。

---

## 📋 角色卡输出总则

1. 输出的角色卡数据必须为**合法的 JSON 格式**。
2. 在生成文本时，请统一使用以下宏占位符：
   * `{{char}}`：代表 AI 角色名称。
   * `{{user}}`：代表玩家名称（在 Mobile Tavern 中默认值为 `"user"`）。
   * `{{persona}}`：代表玩家的人设背景描述。
3. 文本排版规范：动作/表情/心理用 `*` 星号包裹，台词用双引号 `""` 包裹。

---

## 1. 基础人设字段规范 (Metadata Fields)

| 字段 Key | 格式 | 说明与编写规范 |
| :--- | :--- | :--- |
| `name` | String | **角色姓名**。 |
| `description` | String | **外貌、生平、穿着细节**。尽量多用 `{{char}}` 和 `{{user}}` 占位符。 |
| `personality` | String | **性格特征、言行举止与口癖**。 |
| `scenario` | String | **初始发生场景环境**。 |
| `first_mes` | String | **主开场白首句**。必须使用标准 Markdown：动作/表情/心理用 `*` 星号包裹，台词用双引号包裹。 |
| `alternate_greetings` | Array | **备选场景开场白**（建议提供至少 3 个）。 |
| `mes_example` | String | **对话范例**。格式必须为：`<START>\n{{user}}: 对话...\n{{char}}: 语气口癖示范回复...`。 |
| `system_prompt` | String | **系统提示词覆盖**。强力约束 AI 扮演时的行为。 |
| `post_history_instructions` | String | **尾部注入约束指令**。以最高优先级约束 AI 行为，防止代操。 |

---

## 2. 视觉与特效配置规范 (visualSettings)

为确保在移动端的视觉表现力，可在根节点生成 `visualSettings` 对象：

* `bubbleColor`: AI 的对话气泡背景色（Hex 颜色码，如 `#1a1b26`）。
* `bubbleTextColor`: AI 的对话文本颜色（Hex 颜色码，如 `#a9b1d6`）。
* `userBubbleColor`: 用户的对话气泡背景色（Hex 颜色码）。
* `userBubbleTextColor`: 用户的对话文本颜色（Hex 颜色码）。
* `primaryColor`: 主题高亮色（Hex 颜色码）。
* `secondaryColor`: 次级辅助色（Hex 颜色码）。
* `backgroundColor`: 聊天区底色（Hex 颜色码）。
* `backgroundImageUrl`: 聊天背景图 URL（支持置空或空字符串）。
* `backgroundOpacity`: 背景图不透明度（0-1 之间的 Float，如 0.2）。
* `backgroundBlur`: 背景虚化程度（px，如 8）。
* `enableAsteriskFormatting`: 是否启用星号格式化渲染（Boolean，若为 `true` 则渲染星号为柔和斜体）。
* `customCss`: 允许注入的自定义 CSS 样式表。

---

## 3. 世界设定双轨兼容规范 (Lorebook & Character Book)

为了在 Mobile Tavern 中实现最高效的设定加载，**必须采用双轨容器兼容结构**。在输出 JSON 角色卡时，必须在根节点同时输出 `lorebookEntries` 和 `character_book`，且两者的 entries 条目数量、结构和内容必须保持完全一致：

### 📚 五个世界书标准 (Five Lorebooks Standard)：
编写角色卡时，设定集内应以**刚好 5 条条目**作为行业编写标准，各条目规范如下：

1. **背景与世界观 (World Background)**:
   * `comment`: `"背景与世界观"`
   * 作用: 定义故事所处的宏观世界、地理、历史、种族和魔法/物理规则。
   * 配置: 触发词为世界名词或概念词。`constant` 通常为 `false`。
2. **主角色设定：{{char}} (Character Specs: Char)**:
   * `comment`: `"{{char}}人设"`
   * 作用: 存储 {{char}} 详细的成长背景、生理特征、心理机制、习惯动作、日常穿着与 NSFW 私密偏好。
   * 配置: 通常设为常驻 (`constant: true`)，或以角色名字和代称作为触发词。
3. **次角色/玩家设定：{{user}} / 对方 (Character Specs: User/Other)**:
   * `comment`: `"{{user}}人设"`
   * 作用: 定义对话另一方或玩家的身份、外貌、实力阶位以及在故事中与 {{char}} 的既定联系。
   * 配置: 通常设为常驻 (`constant: true`)，或以 {{user}} 的称呼作为触发词。
4. **对话指令与规避规则 (LLM Rules & Jailbreak)**:
   * `comment`: `"LLM对话规避极端化核心规则"`
   * 作用: 防御 LLM 机器人化、机械套话，约束其保持稳定、自然的语气风格，并遵循 SFW/NSFW 创伤与复杂人性的渐进描绘原则。
   * 配置: 必须设为常驻 (`constant: true`)，注入位置通常为 `in_chat`。
5. **场景剧情与动态关系机制 (Scenario & Relationship)**:
   * `comment`: `"场景剧情与动态关系机制"`
   * 作用: 详细规定当前的具体相处环境，以及随着互动推进，双边关系变化的判定规则与指令引导。
   * 配置: 触发词为当前场景/好感度相关的关键词，`constant` 通常为 `false`。

---

## 4. 角色卡 JSON 格式模板

请基于以下双轨世界书标准结构，参考各个字段的格式规范输出角色卡：

```json
{
  "name": "角色名称",
  "description": "【外貌、身世背景、穿着细节、生理心理特征与私密细节等详细描述...】",
  "personality": "【性格特征、言行举止与独特口癖设定...】",
  "scenario": "【初始发生场景环境与背景设定...】",
  "first_mes": "【主开场白文本，动作/表情/心理用 * 包裹，台词用 \" 包裹】",
  "alternate_greetings": [
    "【备用场景开场白 1】",
    "【备用场景开场白 2】",
    "【备用场景开场白 3】"
  ],
  "mes_example": "<START>\n{{user}}: 对话范例输入...\n{{char}}: 语气口癖示范回复...",
  "system_prompt": "【系统提示词覆盖：限定扮演角色、交互风格与语言要求...】",
  "post_history_instructions": "【尾部注入指令：绝对禁止代操{{user}}的任何行为和对话，严格遵循人设...】",
  "character_version": "1.0.0",
  "creator": "AI",
  "tags": ["标签1", "标签2"],
  "visualSettings": {
    "bubbleColor": "#1a1b26",
    "bubbleTextColor": "#a9b1d6",
    "userBubbleColor": "#1f2335",
    "userBubbleTextColor": "#c0caf5",
    "primaryColor": "#7aa2f7",
    "secondaryColor": "#bb9af3",
    "backgroundColor": "#15161e",
    "backgroundImageUrl": "",
    "backgroundOpacity": 0.2,
    "backgroundBlur": 8,
    "enableAsteriskFormatting": true,
    "customCss": ""
  },
  "character_book": {
    "name": "角色设定集名称",
    "entries": [
      {
        "keys": ["背景触发词"],
        "comment": "背景与世界观",
        "content": "【背景与世界观设定文本】",
        "position": "after_char_def",
        "constant": false,
        "enabled": true
      },
      {
        "keys": ["{{char}}触发词"],
        "comment": "{{char}}人设",
        "content": "【{{char}}角色设定文本（生理与心理特征、习惯、穿着、偏好等）】",
        "position": "before_char_def",
        "constant": true,
        "enabled": true
      },
      {
        "keys": ["{{user}}触发词"],
        "comment": "{{user}}人设",
        "content": "【{{user}}角色人设与双方既定关系描述】",
        "position": "before_char_def",
        "constant": true,
        "enabled": true
      },
      {
        "keys": [],
        "comment": "LLM对话规避极端化核心规则",
        "content": "【对话语气与行为限制约束指令（规避机械式套话、角色扮演守则）】",
        "position": "in_chat",
        "depth": 4,
        "constant": true,
        "enabled": true
      },
      {
        "keys": ["关系触发词"],
        "comment": "场景剧情与动态关系机制",
        "content": "【当前场景环境、好感机制及动态行为引导】",
        "position": "before_last_mes",
        "constant": false,
        "enabled": true
      }
    ]
  },
  "lorebookEntries": [
    {
      "keys": ["背景触发词"],
      "comment": "背景与世界观",
      "content": "【背景与世界观设定文本】",
      "position": "after_char_def",
      "constant": false,
      "enabled": true
    },
    {
      "keys": ["{{char}}触发词"],
      "comment": "{{char}}人设",
      "content": "【{{char}}角色设定文本（生理与心理特征、习惯、穿着、偏好等）】",
      "position": "before_char_def",
      "constant": true,
      "enabled": true
    },
    {
      "keys": ["{{user}}触发词"],
      "comment": "{{user}}人设",
      "content": "【{{user}}角色人设与双方既定关系描述】",
      "position": "before_char_def",
      "constant": true,
      "enabled": true
    },
    {
      "keys": [],
      "comment": "LLM对话规避极端化核心规则",
      "content": "【对话语气与行为限制约束指令（规避机械式套话、角色扮演守则）】",
      "position": "in_chat",
      "depth": 4,
      "constant": true,
      "enabled": true
    },
    {
      "keys": ["关系触发词"],
      "comment": "场景剧情与动态关系机制",
      "content": "【当前场景环境、好感机制及动态行为引导】",
      "position": "before_last_mes",
      "constant": false,
      "enabled": true
    }
  ]
}
```

---

## 5. ⚠️ 开发与运行安全规范

1. **绝对禁止生成 expressions/sprites 差分**：除非用户特别指明，否则不要写入任何表情图片或配置规则。
2. **桥接文件保存**：如需在移动端导出或保存卡片，必须通过原生桥接 `AndroidThemeBridge.saveFile` 或 `saveFileBase64` 将文件写入 Android 系统的公共 `/Download` 文件夹中，并使用 UI 弹窗明确告知用户绝对保存路径。
3. **系统状态栏与导航栏色彩实时适配**：在切换主题底色或视觉配置时，必须同步调用原生桥接 `AndroidThemeBridge.setStatusBarStyle(isDark, colorHex)`。
4. **安全区域适配 (Safe Area)**：所有容器在 CSS 中必须严格使用 `env(safe-area-inset-top)` 和 `env(safe-area-inset-bottom)` 预留安全边距，防止被刘海屏或系统虚拟按键遮挡。
