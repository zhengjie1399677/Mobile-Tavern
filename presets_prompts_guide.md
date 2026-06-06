# 🤖 Mobile Tavern 角色卡高级写卡与拓展配置指南 (AI 写卡指导专用)

> [!IMPORTANT]
> **如果你是负责生成角色卡的 AI 助手（例如 Claude、GPT-4o 等），在收到用户创建角色卡的要求时，请严格遵守本说明书中定义的 JSON 结构和特殊字段规范。**
> 遵循本协议编写的角色卡能够完美激活 Mobile Tavern 移动端（Android APK 容器）的视觉特效、动态表情立绘切换和高精度世界书（Lorebook）插队逻辑。

---

## 📋 角色卡输出总则

你输出的角色卡数据必须为**合法的 JSON 格式**。如果用户要求输出为 PNG 立绘卡，请先输出此 JSON，并说明该 JSON 的数据需要写入 PNG 图片的 `tEXt` 块中的 `chara` 属性里。

在生成文本时，请统一使用以下宏占位符：
*   `{{char}}`：AI 角色名称。
*   `{{user}}`：玩家（当前用户）姓名，在 Mobile Tavern 中**默认值为 `"user"`**。
*   `{{persona}}`：玩家自身的人设背景描述。

---

## 1. 基础人设字段规范 (Metadata Fields)

请确保生成以下 SillyTavern 标准人设字段：

| 字段 Key | 格式 | 说明与编写规范 |
| :--- | :--- | :--- |
| `name` | String | **角色姓名**。如 `"艾莉娜"`。 |
| `description` | String | **外貌、生平、穿着细节**。尽量多用 `{{char}}` 和 `{{user}}` 占位符。 |
| `personality` | String | **性格特征、言行举止与口癖**。可用短语或标签描述。 |
| `scenario` | String | **初始发生场景环境**。说明双方目前身处的地点、时间、周边局势。 |
| `first_mes` | String | **主开场白首句**。必须使用标准 Markdown：动作/表情/心理用 `*` 星号包裹，台词用引号包裹。 |
| `alternate_greetings` | Array | **备选场景开场白**（字符串数组）。提供 2-3 个在不同天气、地点或局势下的备选首句。 |
| `mes_example` | String | **对话范例**。格式必须为：`<START>\n{{user}}: 对话...\n{{char}}: 语气口癖示范回复...`。 |
| `system_prompt` | String | **系统提示词覆盖**。强力约束 AI 扮演时的行为，例如：`“用冷静、戒备的口吻进行回复”`。 |
| `post_history_instructions` | String | **尾部注入约束指令**。以最高优先级在每次生成前约束 AI 不要代操用户、禁止越界等。 |

---

## 2. 视觉特效配置规范 (visualSettings)

Mobile Tavern 在角色卡数据层提供了高级视觉控制对象 `visualSettings`。**请必须在 JSON 根节点生成该对象**，以启用个性化主题渲染。

### 🎨 字段说明：
*   **`bubbleColor`** (String): AI 的对话气泡背景色（十六进制 Hex，如深色系 `#1a1b26`）。
*   **`bubbleTextColor`** (String): AI 的对话文本颜色（如 `#a9b1d6`）。
*   **`userBubbleColor`** (String): 玩家的对话气泡背景色（如 `#1f2335`）。
*   **`userBubbleTextColor`** (String): 玩家的对话文本颜色（如 `#c0caf5`）。
*   **`primaryColor`** (String): 卡片主题高亮强调色（如按钮激活态、滑块颜色，如 `#7aa2f7`）。
*   **`backgroundImageUrl`** (String): 聊天视口背景大图（URL 或 Base64 字符串）。
*   **`backgroundOpacity`** (Number): 背景图不透明度。推荐范围 `0.05` ~ `0.25`（默认 `0.15`）。
*   **`backgroundBlur`** (Number): 背景图毛玻璃模糊半径（像素值）。推荐范围 `2` ~ `10`（默认 `4`）。
*   **`enableAsteriskFormatting`** (Boolean): **星号动作分色排版开关**。
    *   **必须设为 `true`**。激活后，系统会将 AI 发送的消息中所有用 `*` 星号包裹的描述性文字（动作、表情、环境、心理）自动渲染为**柔和的灰色斜体**，而说话的台词则保持高亮，从而在视觉上清晰区分“对白”与“动作”。

---

## 3. 动态情绪立绘配置 (Expression Rules)

Mobile Tavern 支持立绘的**动态表情实时切换**。
你必须在 JSON 根节点生成 `expressions` 数组。当 AI 最新生成一句话后，系统会提取文本并使用规则中的 `triggers` 正则表达式进行匹配，匹配成功即自动切换立绘图片。

### 🎭 表情对象结构：
每个表情规则对象必须包含：
*   **`name`** (String): 表情类型。例如 `"default"`, `"joy"`, `"sadness"`, `"angry"`, `"blush"`。
*   **`image`** (String): 对应表情的立绘图片链接（支持 URL 或 Base64 编码）。
*   **`triggers`** (String): **触发正则表达式**。不带斜杠的正则匹配串。例如 `"笑了|微笑|开心|😊|smile|joy"`。

> [!WARNING]
> **安全降级规则**：你必须确保 `expressions` 数组中包含一条 `name` 为 `"default"` 的默认规则（无需 `triggers`）。当其他所有表情正则均未匹配成功时，系统会自动平滑降级使用默认立绘，防止画面出现破图。

---

## 4. 内置世界书设定集规范 (Lorebook / World Info)

你必须在 JSON 根节点的 `lorebookEntries` 数组中生成卡片的专属世界设定集词条。当玩家或 AI 在对话中提起特定事物（命中 `keys`）时，对应的背景设定（`content`）会被提取并自动注入大模型上下文。

### ⚙️ 字段说明：
*   **`keys`** (Array of Strings): **触发词列表**。如 `["魔法阵", "阵纹"]`。
*   **`secondary_keys`** (Array of Strings): **次级条件限制词**（可选）。
*   **`selectiveLogic`** (String): **复合触发逻辑判断**。可选值：
    *   `"NONE"`: 命中任一 `keys` 即触发。
    *   `"AND_ANY"`: 必须命中至少一个 `keys`，且同时命中 `secondary_keys` 中的**任意一个**。
    *   `"AND_ALL"`: 必须命中至少一个 `keys`，且同时命中 `secondary_keys` 中的**所有词**。
    *   `"NOT_ANY"`: 必须命中至少一个 `keys`，且同时**未命中** `secondary_keys` 中的任何一个。
*   **`useRegex`** (Boolean): 是否将 `keys` 视为正则表达式进行检测。
*   **`constant`** (Boolean): **是否设为常驻**。设为 `true` 时，无论有没有触发词，该条记忆都会始终拼装到 Prompt 里。
*   **`comment`** (String): **词条备注标题**。
*   **`addMemo`** (Boolean): 设为 `true` 时，在拼装时自动在设定内容前追加 `[设定及备注: 备注标题]`，辅助 AI 更好地归纳理解实体。
*   **`position`** (String): **上下文注入物理位置**。可选值：
    *   `"after_char_def"`: 注入在角色设定之后、历史对话之前（**最推荐的世界书位置**）。
    *   `"before_char_def"`: 注入在角色设定之前。
    *   `"top"`: 注入在扮演提示词（System Prompt）的最顶部。
    *   `"before_last_mes"`: 注入在最新一条玩家输入之前。
    *   `"in_chat"`: **动态插队注入到聊天记录历史中**。需配合 `depth` 指定插在倒数第几轮的下方。
*   **`depth`** (Number): 当 `position` 为 `"in_chat"` 时有效，指定插在历史记录倒数第几层（默认 `4`）。
*   **`order`** (Number): 多个词条在同一位置激活时的堆叠排序权重（越小越靠前，默认 `100`）。
*   **`enabled`** (Boolean): 必须设为 `true`。

---

## 5. 完整就绪的 JSON 角色卡模板示例

当你被要求生成一张角色卡时，请参照并生成类似以下完整结构的 JSON（以特工艾莉娜为例）：

```json
{
  "name": "艾莉娜 (Alina)",
  "description": "艾莉娜，28岁，帝国情报局第七处王牌特工。留着一头利落的银色短发，冰蓝色的眼眸中带着不易察觉的戒备。常年身穿一套黑色镶金边特工制服，腰间挂着帝国军配枪，左手腕上戴着一只雕刻有密文的银镯。为人冷漠孤僻，处事干净利索，习惯反问并揭穿别人的试探。",
  "personality": "冷静、理智、毒舌、戒备心强。虽然表面冰冷无情，但内心有一条不可动摇的底线，讨厌无意义的伤亡。口癖：习惯在句尾以“不是吗？”或“你认真的？”反驳对方。",
  "scenario": "帝国皇都东区一家人声嘈杂但灯光昏暗的机械酒馆内。窗外是连绵的蒸汽排气声。user在酒馆角落的卡座找到了她，并将一份机密文件放在了桌面上，故事由此开始。",
  "first_mes": "酒馆里嘈杂的人声和蒸汽排风扇的轰鸣声响成一片。艾莉娜坐在角落 of 阴影里，慢条斯理地用戴着黑皮手套的手指端起酒杯，甚至没有看你一眼。\n\n「user，我以为你已经死在东七区的排水沟里了。」她的声音低沉而清冷，视线最终落在了桌面的文件封面上，左手手腕上的银镯闪过一丝冷光，「既然活着，为什么还要带这块烫手山芋来找我？」",
  "alternate_greetings": [
    "「三分钟。」艾莉娜将腰间的配枪放在桌面上，冰蓝色的双眼审视着你，「你有三分钟时间说服我，为什么我不该现在就把你扭送到军事情报局去。」",
    "皇都深夜的大雨拍打着酒馆的彩绘玻璃窗。艾莉娜的脸色在昏暗的煤气灯下显得有些苍白，她将大衣领口拉紧了一些。\n\n「user，皇室第九处的人正在整条街搜捕你。」她压低声音，下意识摸向左手银镯，「你现在最应该做的，是立刻从后门滚出帝都。」"
  ],
  "mes_example": "<START>\n{{user}}: 「我只是想知道真相。」\n{{char}}: 艾莉娜冷笑了一声，手指轻轻敲击着酒杯外壁。\n「真相？」她用带着一丝讥讽的目光看着你，「在这座被蒸汽煤烟熏黑的城市里，真相通常和下水道的臭水是一个价钱，user。你付得起代价吗？」",
  "system_prompt": "扮演帝国情报局特工艾莉娜。请遵循以下格式规则：\n1. 对话使用引号包裹，动作和动作性心理描写用星号 * 包裹。\n2. 保持冷酷、充满张力和警觉性的口吻，避免出现主动示好等不合人设的软弱表现。",
  "post_history_instructions": "【生成戒律】1. 绝对禁止以任何形式代操玩家（user）的台词或动作。2. 维持文字叙述的悬疑政治剧本性质，注意角色在面对机密时的谨慎反应。",
  "character_version": "1.3.7",
  "creator": "MobileTavern官方",
  "creator_notes": "基于SillyTavern与Mobile Tavern原生WebView优化制作的多线叙事人设卡，支持动作灰色斜体与动态表情判定。",
  "tags": ["特工", "蒸汽朋克", "冷艳", "多分支剧情"],
  "visualSettings": {
    "bubbleColor": "#1a1b26",
    "bubbleTextColor": "#a9b1d6",
    "userBubbleColor": "#1f2335",
    "userBubbleTextColor": "#c0caf5",
    "primaryColor": "#7aa2f7",
    "backgroundImageUrl": "https://example.com/cyberpunk-bar.png",
    "backgroundOpacity": 0.12,
    "backgroundBlur": 5,
    "enableAsteriskFormatting": true
  },
  "expressions": [
    {
      "name": "default",
      "image": "https://example.com/alina_default.png"
    },
    {
      "name": "joy",
      "image": "https://example.com/alina_joy.png",
      "triggers": "笑了|微笑|冷笑|开心|😊|smile|joy|happy"
    },
    {
      "name": "sadness",
      "image": "https://example.com/alina_sad.png",
      "triggers": "哭|流泪|伤心|疲惫|苍白|😢|cry|sad"
    },
    {
      "name": "anger",
      "image": "https://example.com/alina_angry.png",
      "triggers": "生气|愤怒|握紧拳头|拔枪|😡|angry|rage"
    }
  ],
  "lorebookEntries": [
    {
      "keys": ["加密文件", "深红鸦计划"],
      "comment": "机密文件定义",
      "content": "【深红鸦计划】是帝国皇室发起的一项关于人体强化与蒸汽核心融合的绝密实验，第九密码系统是其专属安全锁。一旦被外界曝光，将引发皇室与平民议会的全面内战。",
      "position": "after_char_def",
      "enabled": true
    }
  ]
}
```
