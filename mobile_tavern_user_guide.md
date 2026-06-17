# 📱 Mobile Tavern (移动酒馆) 用户端完整操作指南与客服知识库

Mobile Tavern 是一款专为移动端（Android APK / iOS IPA）深度优化的角色扮演与 SillyTavern 生态兼容混合型客户端。本指南旨在梳理系统的完整功能、操作路径与规则逻辑，帮助客服快速定位并解答用户问题。

---

## 🧭 一、 核心设计战略与原生规范

1. **大拇指优先设计**：核心操作区域（发送按钮、快捷输入、主切换底栏）全部排布在屏幕底部，方便用户在手机上单手操作。
2. **状态栏自动着色**：当前端切换不同颜色主题（如 Snow, Sand, Ocean, Charcoal）时，App 会自动同步将系统状态栏颜色涂为主题底色，并根据亮/暗主题切换状态栏图标颜色（暗背景用白字，亮背景用黑字），防止图标“隐身”。
3. **物理隔离下载与导出**：由于手机 WebView 的安全限制，传统网页的 Blob 下载链接无法响应。本软件的所有“导出 JSON 角色卡”、“保存卡片 PNG 图片”等写出功能，均在后台调用了原生桥接接口，将文件写入手机系统的 **`/Download` 公共文件夹** 下。

---

## 🎛️ 二、 主界面导航四大页签

主界面底部导航栏包含四个核心板块：**角色馆**、**历史对话**、**世界书**、**控制端**。

### 1. 🎭 角色馆 (Characters Directory)
角色馆用于创建、导入和管理您的 AI 角色伙伴。

*   **卡片导入**：
    *   支持导入标准的 SillyTavern 角色卡 JSON 配置文件。
    *   支持直接导入带有 **EXIF 元数据** 的 PNG 角色图片（拖入或点击右上角“+”号选择上传，系统会自动解构图片内嵌的 JSON 设定）。
*   **在位编辑（Dossier Editor）**：
    *   **基础设定**：名字、头像、描述（Personality）、场景设定（Scenario）、开场白（First Message）、对话范例（Dialogue Examples）、系统提示词（System Prompt）等。
    *   **高级视觉覆盖（Visual Settings）**：支持独立覆盖当前角色的对话气泡背景色、文字颜色、头像不透明度、高斯模糊等。还可以直接书写自定义 CSS 样式（如背景视频或粒子动效）。
    *   **专属设定词条**：支持直接在此面板中为此角色新建、编辑专属的“世界书词条”。
*   **卡片导出**：
    *   支持导出 JSON 配置文件。
    *   支持在本地 Canvas 合成绘制精美的 Tavern 规范 PNG 角色图片（自动注入角色设定元数据），并保存至手机 `/Download` 目录中。

---

### 2. 💬 历史对话 (Chat History)
查看和管理您的所有聊天对话记录。

*   **会话管理**：支持针对同一个角色开辟多条不同的“平行世界”对话线。
*   **新建/切换**：点击即可切换至该会话并进入对话房间，或者将不需要的废弃对话彻底擦除。

---

### 3. 📖 世界书 (Worldbook / Lorebook)
世界书（设定集）用于在对话中自动根据关键词注入设定的背景知识（如地名、魔法规则、历史事实）。

*   **逻辑模式分类**：
    *   **🌎 全局共享词库 (Global)**：开启后对所有角色生效。
    *   **👤 角色专属回路 (Local)**：只在与该特定角色对话时才会触发。支持通过列表上的滑动开关一键在这两种模式之间互转（Global 与 Local 相互对调）。
*   **词条属性控制**：
    *   **触发关键词**：以半角逗号分隔。当对话上下文中出现这些词时，该词条的叙述内容会被动态混编入大模型 Prompt。
    *   **插入位置 (Position)**：支持插入到“角色定义前”、“角色定义后”、“最新消息上方”或“历史层中”。
    *   **插入深度 (Depth)**：检索对话历史多少轮以内的触发词。
    *   **编排权重次序 (Order)**：多词条触发时的排布顺序，越小越靠前。
    *   **触发率 (Probability)**：0-100%，决定触发后的生效概率。
    *   **常驻 (Constant)**：即使没有检测到触发词，也无条件强制注入设定。
    *   **临时禁用 (Disabled)**：勾选后，该词条暂时不生效（列表中呈现灰色虚线及半透明度）。

---

### 4. ⚙️ 控制端 (System Settings)
系统控制面板，包含四个子栏目：

*   **常规 (General)**：
    *   **API 服务端点配置**：选择 API 提供商，输入 Base URL 和 API Key。支持点击“测试连接”验证通道是否畅通，并实时调取加载服务端支持的模型列表。
    *   **主题切换**：支持多种精心调制的亮/暗设计风格。
*   **角色 (Persona)**：
    *   配置用户（您自己）的基本名称与特征描述。系统在生成提示词时，会用该配置自动替换全局 `{{user}}` 变量。
*   **预设 (Presets)**：
    *   **模型调节参数**：温度（Temperature）、核采样（Top P）、重复惩罚（Repetition Penalty）、长度上限（Max Tokens）。支持将这一套参数保存为不同预设 bundle 导出或一键应用。
    *   **扮演核心指令**：底层扮演指令（Main System Prompt）、破限提示词（Jailbreak，可在 beforeLast 轮注入）、生成纪律提醒（Post-History，强力压轴于历史对话末尾）。
    *   **正则脚本过滤器 (Regex Filter)**：支持添加 `全局`（对所有角色生效）与 `预设专属` 正则表达式过滤器，支持指定“输入过滤”或“输出过滤”，用来自动替换特定的内容（例如过滤大模型的 `<think>` 思考过程）。
    *   **全局情绪匹配正则**：定义当触发哪些情绪词（如“脸红/害羞/blush”）时，对话框顶部立绘切换到对应的情绪图片（blush.png）。
*   **存储 (Memory)**：
    *   **加密备份**：支持设置密码，对本地所有角色卡、对话记录、世界设定集进行强加密（XOR + SHA-256），打包导出为 `.json` 备份文件；也支持读取该备份包进行完整导入覆盖。
    *   **本地存储重置**：查看 IndexedDB 当前的使用占比，并可清空应用缓存。

---

## 💬 三、 对话房间交互规则

1. **表情包立绘动态切换**：
   * 如果角色卡中带有表情图组（Expressions），且在“控制端”配置了情绪正则规则，对话进行时，系统会自动扫描 AI 的最新回复文本。一旦匹配到情绪特征（如带有“伤心”或 “泪”），顶部的角色立绘会自动平滑切换为对应的伤心立绘（sad.png）。若未匹配或缺失对应图，则兜底呈现 neutral 默认头像，不会抛错。
2. **气泡格式化渲染（Markdown 降级）**：
   * 默认渲染标准 Markdown（粗体、斜体、代码块等）。如果用户在角色卡视觉设置中启用了“星号分色排版（`enableAsteriskFormatting`）”，系统会把所有由 `*` 包裹的非对白描述性文字自动转化为低对比度的斜体灰色，突出高对比度的角色对白，带来沉浸式阅读体验。
3. **消息编辑与重发**：
   * 点击单条消息旁边的编辑图标，可以自由修改已发消息。点击“重新生成（Regenerate）”，系统会以当前轮次为断点，让大模型重新生成并替换本轮 AI 消息。

---

## 🐱 四、 挂件客服助理小猫 (雪团)

小猫是常驻于底栏菜单页面右下角的挂件（进入具体对话房间时会自动卸载，防止遮挡输入框）。

### 1. 本地被动吐槽事件 (气泡随机吐槽)
小猫通过监听系统的状态变化，在本地直接以对话气泡形式随机吐槽，该行为**不需要网络连接**：
*   **戳戳它** (`idle_click`)：随机说出一些好奇、傲娇的打招呼台词（会触发舒服舔毛 relax 表情）。
*   **挂机发呆超 3 分钟** (`idle_timeout`)：吐槽用户正在盯着屏幕发呆，或建议去整理 API Key。
*   **深夜模式（23:00 - 05:00）** (`night_mode`)：提醒用户早点睡觉、不要掉毛。
*   **对话 API 连接失败** (`api_error`)：表情切换为 `sleepy`（犯困），提示用户检查代理 TUN 模式或 API 终点额度。
*   **导入新卡成功** (`character_imported`)：兴奋地欢迎新伙伴加入酒馆。

### 2. 对话提问与 1 分钟超时判定
用户可以通过点击小猫弹起对话浮窗进行打字交互：
*   **本地匹配**（未连接云端时）：输入含有“导入”、“世界书”、“报错”等词时，小猫会根据关键词给出实用的本地操作指引。
*   **云端接入**（配置了云端 FC 转发或本地大模型）：消息会代理转发到阿里云 FC 真实云端函数中，由大模型以猫咪雪团的傲娇语气做出智能解答并返回分类（由本地代理转换为对应表情）。
*   **1分钟超时机制**：如果请求在 **60秒** 内因网络阻塞未返回，前端会自动触发超时保护，小猫会切换为难过表情，并回复：*“喵呜呜……等了太久云端都没有反应喵，可能脑回路断掉了，稍后再试试看喵？🐾”*。

---

## 🎨 五、 角色卡高级配置与预设编写规范 (SillyTavern 生态兼容)

为了在 Mobile Tavern 中获得完美的角色扮演和设定加载效果，可以遵循以下高级卡片编写标准：

### 1. 高级视觉自定义字段 (Visual Settings)
系统支持读取角色卡 JSON 根节点下的 `visualSettings` 字段以覆盖全局气泡样式：
*   `bubbleColor`: AI 的对话气泡背景色（Hex 颜色码，如 `#1a1b26`）。
*   `bubbleTextColor`: AI 的对话文本颜色（Hex 颜色码，如 `#a9b1d6`）。
*   `userBubbleColor`: 用户的对话气泡背景色（Hex 颜色码）。
*   `userBubbleTextColor`: 用户的对话文本颜色（Hex 颜色码）。
*   `primaryColor`: 主题高亮色（Hex 颜色码）。
*   `secondaryColor`: 次级辅助色（Hex 颜色码）。
*   `backgroundColor`: 聊天区底色（Hex 颜色码）。
*   `backgroundImageUrl`: 聊天背景图 URL（支持置空或空字符串）。
*   `backgroundOpacity`: 背景图不透明度（0-1 之间的 Float，如 0.2）。
*   `backgroundBlur`: 背景虚化程度（px，如 8）。
*   `enableAsteriskFormatting`: 是否启用星号格式化渲染（Boolean，若为 `true` 则渲染星号为柔和斜体）。
*   `customCss`: 允许注入的自定义 CSS 样式表。

### 2. 世界设定双轨兼容规范 (Lorebook & Character Book)
为了在 Mobile Tavern 中实现最高效的设定加载，建议在编写角色卡时采用**双轨容器兼容结构**。在输出 JSON 角色卡时，应当在根节点同时输出 `lorebookEntries` 和 `character_book`，且两者的 entries 条目数量、结构和内容保持一致。

#### 📚 五个世界书标准 (Five Lorebooks Standard)：
设计设定集时，以**刚好 5 条核心条目**作为行业编写标准：
1. **背景与世界观 (World Background)**: 定义故事所处的宏观世界、地理、历史、种族和规则。触发词为世界名词或概念词。
2. **主角色设定：{{char}} (Character Specs: Char)**: 存储 {{char}} 详细的身世、外貌、性格、习惯和私密偏好。通常设为常驻 (`constant: true`)。
3. **次角色/玩家设定：{{user}} (Character Specs: User)**: 定义对话另一方（玩家）的身份、外貌特征以及双方在故事中的关系纽带。
4. **对话指令与规避规则 (LLM Rules & Jailbreak)**: 防御 LLM 机器人化和机械化，约束其保持语气风格，遵循复杂人性描绘原则。必须设为常驻 (`constant: true`)，注入位置通常为 `in_chat`。
5. **场景剧情与动态关系机制 (Scenario & Relationship)**: 详细规定当前环境以及关系变化的判定规则与指令引导。触发词为当前场景相关的关键词。

### 3. 角色卡 JSON 格式模板
```json
{
  "name": "角色名称",
  "description": "【外貌、背景、穿着、性格偏好详细描述...】",
  "personality": "【性格特征、言行举止与独特口癖设定...】",
  "scenario": "【初始场景环境与背景设定...】",
  "first_mes": "【主开场白，动作/表情用 * 包裹，台词用 \" 包裹】",
  "alternate_greetings": [
    "【备用场景开场白 1】",
    "【备用场景开场白 2】"
  ],
  "mes_example": "<START>\n{{user}}: 输入...\n{{char}}: 语气示范回复...",
  "system_prompt": "【系统提示词：限定扮演风格与语言要求...】",
  "post_history_instructions": "【尾部注入指令：绝对禁止代操{{user}}的行为，严格遵循人设...】",
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
        "content": "【背景与世界观设定】",
        "position": "after_char_def",
        "constant": false,
        "enabled": true
      },
      {
        "keys": ["{{char}}触发词"],
        "comment": "{{char}}人设",
        "content": "【{{char}}角色设定描述】",
        "position": "before_char_def",
        "constant": true,
        "enabled": true
      }
    ]
  },
  "lorebookEntries": [
    {
      "keys": ["背景触发词"],
      "comment": "背景与世界观",
      "content": "【背景与世界观设定】",
      "position": "after_char_def",
      "constant": false,
      "enabled": true
    }
  ]
}
```

