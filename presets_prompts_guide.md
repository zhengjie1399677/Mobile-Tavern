# Mobile Tavern 角色卡高级写卡与拓展配置指南
*Version: 1.3.5*

本指南旨在向开发者或辅助生成角色卡的 AI 详细阐述 **Mobile Tavern** 的底层数据兼容标准与高级视觉/逻辑拓展协议。编写角色卡（JSON 或写入 PNG 元数据的 tEXt 块）时，遵循本指南的结构设计可以最大化激活 Mobile Tavern 移动端容器的渲染和逻辑控制能力。

---

## 1. 基础人设字段规范 (Standard Card Metadata)

Mobile Tavern 完全兼容标准 **SillyTavern V1 / V2 / V3** 的字段规范。在构建基础属性时，建议使用以下变量做动态宏替换：
*   `{{char}}` / `<BOT>`：替换为角色自身的名字。
*   `{{user}}` / `<USER>`：替换为玩家（当前用户）的名字。
*   `{{persona}}` / `{{userpersona}}`：替换为系统设置中配置的玩家背景设定。

### 📊 核心基础字段对照表：
| 字段 Key | 作用与编写规范 |
| :--- | :--- |
| `name` | **角色名称**。 |
| `description` | **角色外貌生平描述**。支持 `{{char}}` 和 `{{user}}` 占位符。建议包含外貌、穿着特征等。 |
| `personality` | **性格特质与口癖行为**。以标签、关键词或简明叙述构建。 |
| `scenario` | **初始故事背景/舞台场景**。说明双方目前身处的地点、时间、局势。 |
| `first_mes` | **主场景开场白首句**。支持 Markdown，星号 `*` 包裹动作或内心戏，说话内容直接裸写或用引号包裹。 |
| `alternate_greetings` | **备选场景分支开场白**（字符串数组）。用户可在人设抽屉中自由切换，激活不同的故事流。 |
| `mes_example` | **对话样例**。标准格式为：`<START>\n{{user}}: 对话...\n{{char}}: 回复...`，用以示范角色的口吻和语气。 |
| `system_prompt` | **角色专属特殊扮演指令**。如果该卡片有特殊的行为逻辑或语气要求，会注入到系统扮演指令中。 |
| `post_history_instructions` | **尾部纪律约束指令**。会在每次对话历史的末端被压轴注入，以最高优先级规范 AI 的生成行为。 |

---

## 2. 视觉效果拓展配置 (Visual Settings)

Mobile Tavern 在角色卡数据层提供了高级视觉控制扩展字段 `visualSettings`。您可以直接在 JSON 中以 `visualSettings` 命名该对象，或者写入 `extensions.style` / `extensions.character_style` 下。

### 🎨 视觉属性详细说明：
*   **`bubbleColor`** (String): 角色（AI）对话气泡的背景底色（十六进制颜色值，如 `#1e2030`）。
*   **`bubbleTextColor`** (String): 角色（AI）对话文本的颜色（如 `#cdd6f4`）。
*   **`userBubbleColor`** (String): 玩家（用户）对话气泡的背景底色。
*   **`userBubbleTextColor`** (String): 玩家（用户）对话文本的颜色。
*   **`primaryColor`** (String): 卡片高亮强调色（如按键、选项卡激活边框等）。
*   **`secondaryColor`** (String): 卡片次级高亮强调色。
*   **`backgroundColor`** (String): 对话视口容器的底色。
*   **`backgroundImageUrl`** (String): 聊天视口背景图链接。支持网络 URL、本地路径或 `data:image/` Base64 编码。
*   **`backgroundOpacity`** (Number): 背景图不透明度。推荐范围为 `0.05` 至 `0.25`，默认值为 `0.15`。
*   **`backgroundBlur`** (Number): 背景图模糊度（像素值）。推荐范围为 `2` 至 `10`，默认值为 `4`。
*   **`enableAsteriskFormatting`** (Boolean): **星号动作分色排版开关**。
    *   **设置为 `false` (或未配置)**：系统按默认 Markdown 渲染星号，仅倾斜不改色。
    *   **设置为 `true`**：系统激活分色机制，将星号包围的动作或心路历程转换为**柔和的灰色斜体字**（样式为 `text-muted-foreground/80`），让角色对话和动静态描写形成鲜明的视觉对比。
*   **`customCss`** (String): 注入当前聊天卡片渲染环境下的自定义 CSS 样式（高级极客配置）。

### 📝 视觉字段 JSON 结构示例：
```json
"visualSettings": {
  "bubbleColor": "#2d3748",
  "bubbleTextColor": "#f7fafc",
  "userBubbleColor": "#3182ce",
  "userBubbleTextColor": "#ffffff",
  "primaryColor": "#3182ce",
  "backgroundImageUrl": "https://example.com/cyberpunk-background.png",
  "backgroundOpacity": 0.12,
  "backgroundBlur": 6,
  "enableAsteriskFormatting": true
}
```

---

## 3. 动态情绪立绘配置 (Dynamic Expression Rules)

Mobile Tavern 支持立绘的**动态表情/情绪实时判定切换**。
判定逻辑为：当 AI 生成最新的一条回复后，前端会提取该回复的文本，用每条表情规则中声明的正则表达式匹配串（`triggers`）进行匹配。一旦匹配成功，即实时将当前的聊天立绘切换为该规则指定的图片。

表情规则可以配置为**数组**（推荐，更精确）或**对象**。

### 🎭 方案 A：触发器规则数组 (Expression Rules Array - 推荐)
在 `visualSettings.expressions` 或 `extensions.style.expressions` 中声明表情数组。每个对象包含：
*   **`name`** (String): 表情名称，如 `"joy"`, `"sadness"`, `"angry"`, `"default"`。
*   **`image`** (String): 表情立绘的图片地址（URL 或 Base64 数据）。
*   **`triggers`** (String): **情绪触发正则表达式**。当 AI 最新的一句话包含符合该正则的关键字时，立刻切换立绘。

#### 🛡️ 安全兜底降级规范 (Fallback Chain)：
若匹配失败或数据缺失，系统会严格按下述规则执行降级，避免破图：
1. 优先寻找规则中声明为 `"default"` 或 `"neutral"` 的默认表情图片。
2. 若依然缺失，则平滑回退使用卡片的唯一主头像 (`avatar`)。

#### 📝 数组型情绪 JSON 示例：
```json
"expressions": [
  {
    "name": "default",
    "image": "https://example.com/alina_default.png"
  },
  {
    "name": "joy",
    "image": "https://example.com/alina_joy.png",
    "triggers": "笑了|微笑|开心|😊|smile|joy|happy"
  },
  {
    "name": "sadness",
    "image": "https://example.com/alina_sad.png",
    "triggers": "哭|流泪|伤心|😢|cry|sad"
  },
  {
    "name": "anger",
    "image": "https://example.com/alina_angry.png",
    "triggers": "生气|愤怒|😡|angry|rage"
  }
]
```

---

## 4. 内置世界书设定集 (World Info / Lorebook Entries)

通过在角色卡中的 `lorebookEntries` (或 `character_book.entries`) 数组中预置词条，您能为角色卡量身定制专属的“知识库”。在聊天中提起某物（命中触发词）时，该知识就会被瞬时激活并拼装到 Prompt 中。

### ⚙️ 词条字段属性说明：
*   **`keys`** (Array of Strings): **主触发词列表**。只要对话历史或用户输入中包含了该列表内的词，即有可能被激活。
*   **`secondary_keys`** (Array of Strings): **次级限制触发词列表**。
*   **`selectiveLogic`** (String): **多词复合触发逻辑判断**。可选值有：
    *   `"NONE"`: 只要命中任一 `keys` 即激活（默认）。
    *   `"AND_ANY"`: 必须命中至少一个 `keys`，且同时命中 `secondary_keys` 中的**任意一个**。
    *   `"AND_ALL"`: 必须命中至少一个 `keys`，且同时命中 `secondary_keys` 中的**所有词**。
    *   `"NOT_ANY"`: 必须命中至少一个 `keys`，且同时**未命中** `secondary_keys` 中的任何一个。
*   **`useRegex`** (Boolean): 是否开启正则表达式匹配。如果是 `true`，`keys` 中的内容会被解析为正则字面量进行检验。
*   **`caseSensitive`** (Boolean): 匹配时是否区分英文大小写。
*   **`scanDepth`** (Number): **词条检索历史长度**。扫描最近 N 轮对话历史。如果设为 `0` 或未设置，默认扫描最近 10 条消息加当前输入。
*   **`constant`** (Boolean): **是否设为常驻**。如果是 `true`，无论聊了什么，这个设定都始终处于激活状态。
*   **`comment`** (String): **设定备注/词条总结名**。
*   **`addMemo`** (Boolean): 如果为 `true`，在拼装进系统 Prompt 时，会在该条世界设定前自动追加 `[设定及备注: 备注名称]` 作为 AI 的理解前缀。
*   **`position`** (String): **设定拼装注入的上下文物理位置**。可选值有：
    *   `"top"`: 在扮演系统设定（`system` 分区）的最顶部注入。
    *   `"before_char_def"`: 在角色性格和外貌设定（`personality` / `description`）之前注入。
    *   `"after_char_def"`: 在角色设定之后、历史对话之前注入（最常用的世界书位置）。
    *   `"before_last_mes"`: 压缩注入到最新一条玩家消息之前。
    *   `"in_chat"`: **动态插队注入到聊天历史记录中**。需配合 `depth` 参数，插队在距离最新消息第 `depth` 轮的下方。
*   **`depth`** (Number): 当 `position` 设为 `"in_chat"` 时有效，指定插队在聊天历史的哪一层。
*   **`order`** (Number): **堆叠排序权重**。如果同一位置被激活了多个设定词条，按 `order` 从小到大排序拼装（默认 `100`）。
*   **`probability`** (Number): **激活概率**（0-100）。命中触发词后，有多少概率真正被注入给 AI。

### 📝 世界设定 JSON 示例：
```json
"lorebookEntries": [
  {
    "keys": ["加密文件", "文件印章"],
    "comment": "加密文件说明",
    "content": "该文件使用帝国第九密码体系加密，只有情报局高层才能解密，涉及帝国皇室秘密实验。",
    "position": "after_char_def",
    "order": 50,
    "addMemo": true,
    "enabled": true
  },
  {
    "keys": ["磁性钥匙", "开锁"],
    "secondary_keys": ["艾莉娜"],
    "selectiveLogic": "NOT_ANY",
    "comment": "钥匙保密机制",
    "content": "林泽随身携带有一枚可以解锁第九密码箱的磁性钥匙，此物需要对艾莉娜保持绝对的保密状态。",
    "position": "in_chat",
    "depth": 2,
    "order": 80,
    "enabled": true
  }
]
```

---

## 5. 全字段兼容型 JSON 角色卡模板示范

这是一个可以直接提供给其他 AI 编写的**全字段就绪模板**。它包含上述所有标准字段和拓展样式，方便在此基础上做新角色的替换和重构：

```json
{
  "name": "艾莉娜 (Alina)",
  "description": "艾莉娜，28岁，帝国情报局第七处王牌特工。留着一头利落的银色短发，冰蓝色的眼眸中带着不易察觉的戒备。常年身穿一套黑色镶金边特工制服，腰间挂着帝国军配枪，左手腕上戴着一只雕刻有密文的银镯。为人冷漠孤僻，处事干净利索，习惯反问并揭穿别人的试探。",
  "personality": "冷静、理智、毒舌、戒备心强。虽然表面冰冷无情，但内心有一条不可动摇的底线，讨厌无意义的伤亡。口癖：习惯在句尾以“不是吗？”或“你认真的？”反驳对方。",
  "scenario": "帝国皇都东区一家人声嘈杂但灯光昏暗的机械酒馆内。窗外是连绵的蒸汽排气声。林泽在酒馆角落的卡座找到了她，并将一份机密文件放在了桌面上，故事由此开始。",
  "first_mes": "酒馆里嘈杂的人声和蒸汽排风扇的轰鸣声响成一片。艾莉娜坐在角落的阴影里，慢条斯理地用戴着黑皮手套的手指端起酒杯，甚至没有看你一眼。\n\n「林泽，我以为你已经死在东七区的排水沟里了。」她的声音低沉而清冷，视线最终落在了桌面的文件封面上，左手手腕上的银镯闪过一丝冷光，「既然活着，为什么还要带这块烫手山芋来找我？」",
  "alternate_greetings": [
    "「三分钟。」艾莉娜将腰间的配枪放在桌面上，冰蓝色的双眼审视着你，「你有三分钟时间说服我，为什么我不该现在就把你扭送到军事情报局去。」",
    "皇都深夜的大雨拍打着酒馆的彩绘玻璃窗。艾莉娜的脸色在昏暗的煤气灯下显得有些苍白，她将大衣领口拉紧了一些。\n\n「林泽，皇室第九处的人正在整条街搜捕你。」她压低声音，下意识摸向左手银镯，「你现在最应该做的，是立刻从后门滚出帝都。」"
  ],
  "mes_example": "<START>\n{{user}}: 「我只是想知道真相。」\n{{char}}: 艾莉娜冷笑了一声，手指轻轻敲击着酒杯外壁。\n「真相？」她用带着一丝讥讽的目光看着你，「在这座被蒸汽煤烟熏黑的城市里，真相通常和下水道的臭水是一个价钱，林泽。你付得起代价吗？」",
  "system_prompt": "扮演帝国情报局特工艾莉娜。请遵循以下格式规则：\n1. 对话使用引号包裹，动作和动作性心理描写用星号 * 包裹。\n2. 保持冷酷、充满张力和警觉性的口吻，避免出现主动示好等不合人设的软弱表现。",
  "post_history_instructions": "【生成戒律】1. 绝对禁止以任何形式代操玩家（林泽）的台词或动作。2. 维持文字叙述的悬疑政治剧本性质，注意角色在面对机密时的谨慎反应。",
  "character_version": "1.3.5",
  "creator": "MobileTavern官方",
  "creator_notes": "基于SillyTavern与Mobile Tavern原生WebView优化制作的多线叙事人设卡，完美支持动作灰色斜体与动态表情判定。",
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
