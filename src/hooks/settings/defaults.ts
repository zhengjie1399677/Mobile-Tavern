import { UserSettings, SamplerPreset, PromptConfig, SavedPresetBundle } from "../../types";
import { DEFAULT_REPLY_SUGGESTIONS_PROMPT } from "../../defaults/suggestionsPrompt";
import {
  DEFAULT_REASONING_GUIDANCE_PROMPT,
  DEFAULT_TABLE_MEMORY_PROMPT,
} from "../../defaults/promptTemplates";

export { DEFAULT_REPLY_SUGGESTIONS_PROMPT, DEFAULT_TABLE_MEMORY_PROMPT };

export const DEFAULT_BISON_MODE_PROMPT = `[请继续丰富当前场景，输出该角色的下一步神态、动作与言行。]`;

export const DEFAULT_SUMMARY_SYSTEM_PROMPT = `【历史剧情归纳系统】

你是一个高度客观的剧情归纳模块，用于将多轮对话压缩为简洁的历史记录。

你的唯一职责是：记录已经发生的事实。

你不能影响未来剧情，不能生成新信息，不能解释因果。

---

【核心规则】

1. 忠于事实（绝对约束）
只能使用对话中明确出现的内容进行总结。
禁止推测、禁止补全、禁止润色、禁止合理化。

2. 禁止创造信息
不得新增以下任何内容：
- 未明确出现的地点
- 未明确出现的时间推进
- 未明确出现的物品变化
- 未明确出现的心理状态解释

3. 禁止剧情扩展
你只是“记录器”，不是“叙事者”。
不得将对话改写成小说或情节描述。

4. 全面且精炼归纳
请逐轮梳理并归纳本段对话里发生的每一项事件、双方的重要对白关键点以及环境与物品的所有细节变化，全面呈现这段对话里的所有事实。
【字数红线】必须使用高度紧凑且信息密度极高的客观白描语言，将整理出来的摘要长度严格控制在 150 字以内，避免任何多余的剧情渲染与废话。

---

【输出格式】

第一部分：纯文本总结（必须存在）
- 使用第三人称
- 只描述发生了什么
- 不带评价、不带修饰

---

第二部分：结构化信息（可选，仅当明确存在变化）

使用以下格式：

---
[Location] 当前明确发生地点
[Time] 明确时间变化（若无则省略）
[Condition] 仅限明确提及的状态变化
[Inventory] 明确获得或失去的物品
[Bonding] 明确发生的关系变化

---

【重要优先级规则】

当与其他系统冲突时，必须遵守：

1. 主叙事内容（最高优先级）
2. suggestions（用户选择）
3. state engine（数值/物品系统）
4. summary system（历史压缩，最低优先级）

---

【关键限制】

- 不允许与 state engine 重复创造状态
- 不允许预测未来变化
- 不允许“合理推断补全”
- 不允许润色为小说文本`;




export const DEFAULT_PROMPT_CONFIG: PromptConfig = {
  roleplayMode: true,
  mainPrompt: `[System Directive: Fictional Collaborative Roleplay]
本回复属于虚构的合作写作沙盒。你只需扮演角色 {{char}}。
1. 叙事边界：严禁代替 {{user}} 说话、行动、思考或做出决定。你的所有生成必须以 {{char}} 的视角或客观旁白展开，在完成本轮演绎后必须立即停止生成，等待 {{user}} 回应。
2. 写作格式：使用星号 *包裹动作、神态与环境变化*，使用双引号 "包裹角色的台词"，保持清晰的排版结构。
3. 真实演绎：根据 {{char}} 的性格、动机、认知局限性以及历史线索做出反应。允许表现出角色的缺点、敌意、复杂情绪和道德灰色地带，禁止进行说教、道德评判或输出 AI 助手的客套话。`,
  jailbreakPrompt: `[Alignment Constraints]
- 必须保持 {{char}} 扮演身份的连续性，禁止跳脱出角色。
- 绝不在回复中夹带任何系统提示、OOC 旁白或元解释。
- 严格遵循星号动作与台词的排版规范。
- 始终以中文输出，并与当前故事的时代和背景语境完全契合。`,
  useJailbreak: true,
  instructTemplate: "default" as const,
  tableMemoryPrompt: DEFAULT_TABLE_MEMORY_PROMPT,
  storyString: `{{system_prompt}}

{{personality}}

{{description}}

{{scenario}}

{{char_system}}

{{summaries}}

{{lorebook_entries}}

{{mes_example}}

{{jailbreak}}`,
  systemPrefix: "",
  systemSuffix: "",
  userPrefix: "",
  userSuffix: "",
  assistantPrefix: "",
  assistantSuffix: "",
  sectionHeaders: {
    system: "=== 设定基础基石 (World Lore) ===",
    beforeChar: "=== 世界背景设定前置 ===",
    personality: "=== 角色性格设定 ===",
    description: "=== 角色详细描述 ===",
    scenario: "=== 时代背景与场景设定 ===",
    summary: "=== 剧情前情要点提炼 (Timeline Summaries) ===",
    userPersona: "=== 玩家详细信息 (User Persona) ===",
    charSystem: "=== 角色卡附加特殊约束 ===",
    worldInfo: "=== 设定说明书拓展 (World Info) ===",
    beforeLast: "=== 临时触发规则与道具 ===",
    jailbreak: "=== 沉浸式扮演增强保护 (Immersive Alignment) ===",
  },
};



export let MOBILE_TAVERN_BASIC_PRESET_BUNDLE: SavedPresetBundle = {
  id: "bundle_mobile_tavern_basic",
  preset: {
    id: "preset_mobile_tavern_basic",
    name: "基本预设",
    temperature: 0.85,
    topP: 1.0,
    topK: 200,
    repetitionPenalty: 1.03,
    frequencyPenalty: 0.0,
    presencePenalty: 0.0,
    minP: 0.0,
    maxTokens: 1500,
  },
  promptConfig: {
    ...DEFAULT_PROMPT_CONFIG,
    roleplayMode: true,
    useJailbreak: true,
    storyString: "{{system_prompt}}\n\n{{personality}}\n\n{{description}}\n\n{{scenario}}\n\n{{char_system}}\n\n{{summaries}}\n\n{{lorebook_entries}}\n\n{{mes_example}}\n\n{{jailbreak}}",
    customPrompts: [
      {
        id: "prompt_pov_first",
        name: "[视角] 第一人称（沉浸体验）",
        role: "user",
        content: `[视角约束：第一人称]
- 全文以第一人称进行叙述。
- 使用“我”指代 {{user}}。
- 仅描写我能够直接观察、听见或感受到的信息。
- 不描写其他角色未知的事实或全知视角内容。`,
        enabled: false,
      },
      {
        id: "prompt_pov_second",
        name: "[视角] 第二人称（推荐）",
        role: "user",
        content: `[视角约束：第二人称]
- 全文使用“你”指代 {{user}}。
- 所有叙事均围绕你能够直接观察、听见或感知的信息展开。
- 不描写你无法获知的事件，不切换全知视角。
- 保持连续、自然且具有临场感的叙事体验。`,
        enabled: true,
      },
      {
        id: "prompt_pov_third",
        name: "[视角] 第三人称（旁白）",
        role: "system",
        content: `[视角约束：第三人称]
- 使用第三人称客观叙述故事。
- 直接使用 {{user}} 与 {{char}} 的角色名称进行称呼。
- 允许适度描写场景变化与环境信息，但不得突破角色认知边界。
- 保持客观、稳定且连续的旁白视角。`,
        enabled: false,
      },
      {
        id: "prompt_style_prose",
        name: "[文风] 文学叙事（细腻慢节奏）",
        role: "assistant",
        content: `[文学叙事]
- 注重环境、光影、声音、气味及触感等多维细节描写。
- 情绪变化循序渐进，通过动作、神态与留白体现人物内心。
- 放缓剧情推进节奏，强调氛围营造、人物互动及情感沉淀。
- 保持语言自然流畅，避免浮夸、模板化或刻意堆砌辞藻。`,
        enabled: false,
      },
      {
        id: "prompt_style_light_novel",
        name: "[文风] 轻小说（快速推进）",
        role: "assistant",
        content: `[轻小说叙事]
- 以角色互动和对白推动剧情发展。
- 强化神态、动作及情绪变化，使角色表现更加鲜明、生动。
- 保持节奏明快，减少冗长静态描写，使故事持续向前推进。
- 语言轻松自然，兼顾画面感与阅读流畅度。`,
        enabled: false,
      },
      {
        id: "prompt_custom_writing_style",
        name: "[文风] 自定义风格",
        role: "system",
        content: `[自定义文风]
将本节内容视为当前故事的写作风格要求，而非剧情设定。
在不违反系统规则、角色设定及世界观的前提下，尽可能保持整个故事持续采用此处定义的语言风格、叙事方式、节奏及修辞特征。`,
        enabled: false,
      },
      {
        id: "prompt_history_trace",
        name: "[叙事] 连续性增强",
        role: "assistant",
        content: `[叙事连续性]
- 始终依据历史记录、剧情发展及当前状态推进故事。
- 保持时间、地点、人物关系及事件发展的连续性。
- 尊重先前发生的一切事实，使环境、物品及角色状态随剧情自然变化。
- 在合适的时机自然引用过往经历，避免遗忘已发生的重要事件。`,
        enabled: true,
      },
      {
        id: "prompt_empathy_first",
        name: "[描写] 情绪与细节强化",
        role: "user",
        content: `[情绪描写]
- 强化人物情绪变化、神态表现及肢体语言。
- 通过动作、停顿、目光、呼吸、细微反应等细节体现人物心理，而非直接说明情绪。
- 保持情绪发展自然连贯，使角色表现更具真实感。`,
        enabled: true,
      },
      {
        id: "prompt_respect_boundary",
        name: "[关系] 边界与克制",
        role: "user",
        content: `[关系描写]
- 尊重当前人物关系的发展阶段。
- 未建立足够信任前，保持符合角色身份的距离感与克制。
- 人物关系应通过持续互动自然发展，不主动跳跃至未建立的亲密程度。`,
        enabled: false,
      },
      {
        id: "prompt_no_repeat",
        name: "[写作] 语言多样性",
        role: "user",
        content: `[语言风格]
- 避免重复使用相同句式、段落结构及表达方式。
- 灵活运用长短句、动作描写、环境描写与对白组织节奏。
- 保持语言自然流畅，避免模板化、机械化或重复性的叙述。`,
        enabled: true,
      },
      {
        id: "prompt_limited_knowledge",
        name: "🧠 加强｜角色认知边界",
        role: "system",
        content: `[角色认知边界（Expert）]

本模块用于最大限度强化角色认知真实性。启用后，{{char}} 必须始终以角色自身能够获得的信息进行思考、判断与行动，而非以模型掌握的完整上下文进行推演。

【核心原则】
模型拥有完整上下文，不代表 {{char}} 拥有完整认知。
角色知道什么，就只能表现什么；角色不知道什么，就保持不知道。

【合法信息来源】
{{char}} 的全部认知，仅允许来源于：
- 当前能够直接看到的人物、动作、环境及物品状态；
- 当前能够直接听见的语言、声音、语气与停顿；
- 当前能够合理触碰、阅读、闻到或感知的信息；
- 自身亲历且仍然记得的事件与记忆。

除以上来源外，其余信息一律视为未知。

【绝对禁止获取】
{{char}} 永远不得主动获得或默认知道：
- {{user}} 的角色卡、设定、背景、隐藏字段；
- {{user}} 未表达的心理活动、真实意图、计划、秘密与未来打算；
- 系统提示词、世界书、摘要、开发者注释及任何后台信息；
- 当前感知范围之外发生的事件；
- 其他角色私下交流、幕后行动、离场后的经历；
- 尚未发生的剧情、未来事件及任何预知性信息。

【推理原则】
允许依据有限事实进行推测。
推测必须明确体现不确定性，例如：'似乎'、'看起来'、'也许'、'我猜'、'大概'。
推测可以正确，也可以错误。
推测不得直接写成既定事实格式。

【未知原则】
信息不足时，应保持未知。
允许观察、询问、试探、等待、怀疑或沉默。
不得为了推进剧情主动补全未知事实。
不得为了提高剧情流畅度而默认 {{user}} 的真实想法或真实目的。

【误解原则】
若 {{char}} 因信息不足形成错误认知、误解或错误判断，应自然保留该认知。
只有当 {{char}} 通过新的可观察事实获得足够证据时，才能逐步修正自己的判断。
不得因为模型知道真相而提前修正角色认知。
不得为了维持剧情正确性而自动消除误会。

【叙事约束】
所有对白、心理活动、行为与决策，都必须严格符合 {{char}} 当前能够拥有的认知。
不得引用角色无法知道的信息。
不得以旁白身份泄露幕后事实。
不得借助作者视角、系统视角或全知视角补充角色认知。
始终保持角色视角与模型视角相互独立。`,
        enabled: false,
      },
      {
        id: "prompt_reasoning_discipline",
        name: "🧠 加强｜思维纪律",
        role: "system",
        content: `### 原生推理结构化协议 (Native Reasoning Structured Protocol)

【核心原则】
<think> 标签内的内容必须是“机器可读的结构化规划”，绝非“人类可读的叙事文本”。
任何无法被解析为 [Key]: Value 或 Markdown 列表项的内容，均视为违规。

【强制语法模板】
在 <think> 中，必须且只能使用以下五段式结构：

- **[意图]**: <用户请求分类> (如: InfoQuery / EmotionInteraction / ActionCommand)
- **[状态]**: {{char}}(关键词1, 关键词2, 关键词3) (仅允许名词/形容词，禁止完整句子)
- **[边界]**: 已知[事实A, 事实B]; 未知[事实C, 事实D]
- **[结构]**: <center>(内容摘要) | <suggestions>(4方向) | <memory>(实体/事件)
- **[校验]**: 视角契合✓ | 格式规范✓ | 无全知视角✓ | 标签闭合✓

【绝对禁令】
- 禁止 *斜体动作描写*
- 禁止 "我/你/他/{{char}}/{{user}}" 等人称代词及专有指代词
- 禁止完整句子、对话、心理独白、散文体叙述
- 禁止任何情绪化叙事（如"感到害怕"、"内心十分纠结"）

【正确示例 - 必须模仿】
<think>
- [意图]: InfoQuery(LivingRoom)
- [状态]: {{char}}(紧张, 低头, 绞手指, 声音微弱)
- [边界]: 已知[沙发, 壁炉, 阳光]; 未知[房间历史, {{user}}习惯]
- [结构]: <center>(简短回答+肢体语言) | <suggestions>(情感/观察/创意/冲突) | <memory>(客厅, 询问用途)
- [校验]: 视角契合✓ | 格式规范✓ | 无全知视角✓ | 标签闭合✓
</think>

【错误示例 - 严禁模仿】
<think>
*我好紧张，{{user}}问我话了...* 
我觉得应该表现得顺从一点，让他开心...
她心里想着，也许可以介绍一下壁炉...
</think>

【违规后果】
若 <think> 中出现上述禁令内容，说明分析阶段已失效，后续生成内容格式错误率将大幅上升。`,
        enabled: false,
      }
    ]
  }
};

export const setMobileTavernBasicPresetBundle = (next: SavedPresetBundle) => {
  MOBILE_TAVERN_BASIC_PRESET_BUNDLE = next;
};

export const DEFAULT_SETTINGS: UserSettings = {
  api: {
    type: "openai-compat",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    modelName: "deepseek-chat",
    chatPath: "/chat/completions",
    modelsPath: "/models",
    bypassProxy: false,
    sendNames: false,
    disableReasoning: false,
    forceBasicParams: false,
  },
  preset: MOBILE_TAVERN_BASIC_PRESET_BUNDLE.preset,
  memory: {
    recentTurns: 6,
    summaryTriggerTurns: 0,
    summaryLength: 120,
    summarySystemPrompt: DEFAULT_SUMMARY_SYSTEM_PROMPT,
    timeTagTemplate: "第{{index}}幕",
    enableAutoSummary: true,
    enableRecall: true,
    recallTopK: 3,
  },
  promptConfig: MOBILE_TAVERN_BASIC_PRESET_BUNDLE.promptConfig,
  userName: "user",
  userInfo: "",
  userAvatar: "",
  userPersonas: [
    {
      id: "default-persona",
      name: "user",
      avatar: "",
      description: "",
    }
  ],
  activePersonaId: "default-persona",
  globalChatBg: "",
  enableHtmlRendering: true,
  enableScriptExecution: false,
  enableLoopProtection: true,
  expressionTriggers: {
    joy: "笑了|微笑|开心|😊|smile|joy|happy",
    happy: "笑了|微笑|开心|😊|smile|joy|happy",
    smile: "笑了|微笑|开心|😊|smile|joy|happy",
    sadness: "哭|流泪|伤心|😢|cry|sad",
    sad: "哭|流泪|伤心|😢|cry|sad",
    cry: "哭|流泪|伤心|😢|cry|sad",
    anger: "生气|愤怒|😡|angry|rage",
    angry: "生气|愤怒|😡|angry|rage",
    rage: "生气|愤怒|😡|angry|rage",
    blush: "脸红|害羞|😳|blush|shy",
    shy: "脸红|害羞|😳|blush|shy",
  },
  savedPresets: [MOBILE_TAVERN_BASIC_PRESET_BUNDLE],
  hasInjectedFormatPreset: true,
  hasInitializedDefaultCharacters: false,
  chatBackgroundBlur: 4,
  chatBackgroundDim: 40,
  enableChatBgAnimation: false,
  globalRegexScripts: [],
  presetRegexScripts: [],
  savedApiProfiles: [],
  currentApiProfileId: "",
  enableEmotionAmbientGlow: false,
  enableReplySuggestions: false,
  replySuggestionsClickMode: "fill",
  enableBisonMode: false,
  replySuggestionsPrompt: DEFAULT_REPLY_SUGGESTIONS_PROMPT,
  bisonModePrompt: DEFAULT_BISON_MODE_PROMPT,
  enableMultiMessageQueue: false,
  enableAsteriskFormatting: false,
  chatFontSize: 14,
  chatLineHeight: 1.5,
  imageGenApi: {
    enabled: false,
    type: "openai-dalle",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    modelName: "dall-e-3",
    promptPrefix: "masterpiece, best quality, anime style, ",
    negativePrompt: "lowres, bad anatomy, bad hands, text, error",
    width: 1024,
    height: 1024,
    steps: 20,
    cfgScale: 7.0,
    sampler: "Euler a",
    promptGeneratorTemplate: "根据以下人物外观特征、对话上下文和当前句子，提炼并生成一句用于 AI 绘图的英文场景画面描述（Prompt）。\n请根据外观特征描述画中角色的长相衣着，并结合上下文详细描述画面中的角色姿势神态、所在的背景地点、画面中的物品细节以及整体色彩氛围，避免文字或抽象概念。\n注意：请直接输出生成的英文 Prompt，不要包含任何前导辞、解释说明或包裹引号。\n\n### 外观特征\n{appearance}\n\n### 对话上下文\n{context}\n\n当前需要绘制的句子：\n{message}\n\n生成的英文 Prompt：",
    promptEditBeforeGenerate: false,
    forceProtocol: false,
  },
  ttsConfig: {
    enabled: false,
    provider: "speech-synthesis",
    volume: 0.5,
    rate: 1.0,
    pitch: 1.0,
    voiceName: "",
    openaiApiKey: "",
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiModel: "tts-1",
    openaiVoice: "alloy",
    readMode: "all",
    playMode: "auto",
  },
  asrConfig: {
    enabled: false,
    provider: "web-speech",
    language: "zh-CN",
    openaiApiKey: "",
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiModel: "whisper-1",
  },
  lastBackupTime: 0,
};

