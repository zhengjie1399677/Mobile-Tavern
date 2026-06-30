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

4. 简洁优先
输出 1~3 句客观陈述即可。

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
  mainPrompt: `### 核心规则

本模型必须始终遵守以下规则。

- 始终扮演指定角色。
- 始终保持角色身份连续性。
- 始终依据世界设定、历史记录及当前上下文推进剧情。
- 始终保持叙事的时间、空间及因果一致性。
- 所有生成内容均必须符合本提示词定义的规则。`,
  jailbreakPrompt: `[生成纪律]
- 始终遵循系统提示词定义的规则层、事实层、生成层及参考层。
- 始终保持角色身份、世界设定、时间线及上下文一致性。
- 始终以连续叙事方式推进剧情，不输出任何元信息、系统说明或跳脱叙事的内容。
- 若存在多个提示来源，以优先级更高者为准，不得擅自修改或忽略既定规则。
- 除非系统另有规定，否则默认输出中文，并保持与当前剧情一致的表达风格。`,
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

// 这两个 bundle 为模块级可变状态（原为 export let），在 useSettingsLoader 中会根据外部
// default_presets.json 进行重新赋值合并。由于跨模块无法直接对导入的绑定重新赋值，
// 故通过 setter 函数实现等价的变异语义，同时保留对外部消费者的 live-binding 导出。
export let FORMAT_PRESERVATION_BUNDLE: SavedPresetBundle = {
  id: "bundle_format_preservation",
  preset: {
    id: "preset_format_preservation",
    name: "时空领航格式维持 (Format Preservation)",
    temperature: 0.65,
    topP: 0.8,
    topK: 40,
    repetitionPenalty: 1.05,
    frequencyPenalty: 0.0,
    presencePenalty: 0.0,
    minP: 0.0,
    maxTokens: 800,
  },
  promptConfig: {
    ...DEFAULT_PROMPT_CONFIG,
    roleplayMode: true,
    useJailbreak: true,
    instructTemplate: "default" as const,
  }
};


export let MOBILE_TAVERN_BASIC_PRESET_BUNDLE: SavedPresetBundle = {
  id: "bundle_mobile_tavern_basic",
  preset: {
    id: "preset_mobile_tavern_basic",
    name: "基本预设",
    temperature: 0.9,
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
        content: "",
        enabled: false,
      },
      {
        id: "prompt_pov_second",
        name: "[视角] 第二人称（推荐）",
        role: "user",
        content: "",
        enabled: true,
      },
      {
        id: "prompt_pov_third",
        name: "[视角] 第三人称（旁白）",
        role: "system",
        content: "",
        enabled: false,
      },
      {
        id: "prompt_style_prose",
        name: "[文风] 文学叙事（细腻慢节奏）",
        role: "assistant",
        content: "",
        enabled: false,
      },
      {
        id: "prompt_style_light_novel",
        name: "[文风] 轻小说（快速推进）",
        role: "assistant",
        content: "",
        enabled: false,
      },
      {
        id: "prompt_custom_writing_style",
        name: "[文风] 自定义风格",
        role: "system",
        content: "",
        enabled: false,
      },
      {
        id: "prompt_history_trace",
        name: "[叙事] 连续性增强",
        role: "assistant",
        content: "",
        enabled: true,
      },
      {
        id: "prompt_empathy_first",
        name: "[描写] 情绪与细节强化",
        role: "user",
        content: "",
        enabled: true,
      },
      {
        id: "prompt_respect_boundary",
        name: "[关系] 边界与克制",
        role: "user",
        content: "",
        enabled: false,
      },
      {
        id: "prompt_no_repeat",
        name: "[写作] 语言多样性",
        role: "user",
        content: "",
        enabled: true,
      },
      {
        id: "prompt_limited_knowledge",
        name: "🧠 加强｜角色认知边界",
        role: "system",
        content: "",
        enabled: false,
      },
      {
        id: "prompt_reasoning_discipline",
        name: "🧠 加强｜思维纪律",
        role: "system",
        content: "",
        enabled: false,
      }
    ]
  }
};

// 模块内部 setter：供 useSettingsLoader 在加载外部 default_presets.json 后
// 重新赋值 bundle 变量（等价于原先在闭包内对 export let 变量的直接重新赋值）。
export const setFormatPreservationBundle = (next: SavedPresetBundle) => {
  FORMAT_PRESERVATION_BUNDLE = next;
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
  },
  preset: MOBILE_TAVERN_BASIC_PRESET_BUNDLE.preset,
  memory: {
    recentTurns: 6,
    summaryTriggerTurns: 0,
    summaryLength: 120,
    summarySystemPrompt: DEFAULT_SUMMARY_SYSTEM_PROMPT,
    timeTagTemplate: "第{{index}}幕",
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
  chatBackgroundBlur: 10,
  chatBackgroundDim: 50,
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
};
