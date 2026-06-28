import { UserSettings, SamplerPreset, PromptConfig, SavedPresetBundle } from "../../types";
import { DEFAULT_REPLY_SUGGESTIONS_PROMPT } from "../../defaults/suggestionsPrompt";
import {
  DEFAULT_REASONING_GUIDANCE_PROMPT,
  DEFAULT_TABLE_MEMORY_PROMPT,
} from "../../defaults/promptTemplates";

export { DEFAULT_REPLY_SUGGESTIONS_PROMPT };

export const DEFAULT_BISON_MODE_PROMPT = `[野牛模式连续输出指令：请继续丰富当前场景，输出该角色的下一步神态、动作与言行。]`;

export const DEFAULT_PRESETS: Record<string, SamplerPreset> = {
  creative: {
    id: "creative",
    name: "Creative (灵动创意)",
    temperature: 1.1,
    topP: 0.9,
    topK: 40,
    repetitionPenalty: 1.1,
    frequencyPenalty: 0.05,
    presencePenalty: 0.05,
    minP: 0.02,
    maxTokens: 800,
  },
  balanced: {
    id: "balanced",
    name: "Balanced (均衡自然)",
    temperature: 0.8,
    topP: 0.85,
    topK: 40,
    repetitionPenalty: 1.05,
    frequencyPenalty: 0.0,
    presencePenalty: 0.0,
    minP: 0.0,
    maxTokens: 600,
  },
  precise: {
    id: "precise",
    name: "Precise (严谨叙事)",
    temperature: 0.4,
    topP: 0.7,
    topK: 40,
    repetitionPenalty: 1.02,
    frequencyPenalty: 0.0,
    presencePenalty: 0.0,
    minP: 0.0,
    maxTokens: 500,
  },
};

export const DEFAULT_PROMPT_CONFIG: PromptConfig = {
  roleplayMode: true,
  mainPrompt: "[System Note: Write the next reply in a chat between {{char}} and {{user}}. Crucial Rules:\\n1. Always write in the third-person perspective, focusing exclusively on {{char}}'s actions, facial expressions, thoughts, emotions, and dialogue.\\n2. NEVER write, control, or assume the dialogue, thoughts, or actions of {{user}}. Let {{user}} speak and act for themselves.\\n3. Keep {{char}}'s personality consistent with the character definition. Describe the setting and actions vividly and descriptively.\\n4. Keep the story moving forward naturally. Avoid repetitive phrasing or summarizing the conversation.]",
  jailbreakPrompt: "[System Note: You are now roleplaying as {{char}}. This is an immersive collaborative writing session. Keep your responses in character. Avoid breaking the immersion or adding out-of-character (OOC) meta-commentary. Focus on sensory details, body language, and realistic dialogue. Output the reply in Chinese.]",
  useJailbreak: true,
  postHistoryPrompt: "",
  usePostHistory: true,
  instructTemplate: "default" as const,
  enableReasoningGuidance: true,
  reasoningGuidancePrompt: DEFAULT_REASONING_GUIDANCE_PROMPT,
  tableMemoryPrompt: DEFAULT_TABLE_MEMORY_PROMPT,
  storyString: `{{system_prompt}}

=== 角色性格设定 ===
{{personality}}

=== 角色详细描述 ===
{{description}}

=== 时代背景与场景设定 ===
{{scenario}}

{{mes_example}}

{{char_system}}

{{summaries}}

{{lorebook_entries}}

{{jailbreak}}

{{post_history}}`,
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
    postHistory: "=== 生成纪律提醒 ===",
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
    usePostHistory: true,
    instructTemplate: "default" as const,
  }
};

export let MOBILE_TAVERN_BASIC_PRESET_BUNDLE: SavedPresetBundle = {
  id: "bundle_mobile_tavern_basic",
  preset: {
    id: "preset_mobile_tavern_basic",
    name: "基本预设",
    temperature: 0.8,
    topP: 1.0,
    topK: 200,
    repetitionPenalty: 1.0,
    frequencyPenalty: 0.3,
    presencePenalty: 0.2,
    minP: 0.0,
    maxTokens: 1500,
  },
  promptConfig: {
    ...DEFAULT_PROMPT_CONFIG,
    roleplayMode: true,
    useJailbreak: true,
    usePostHistory: true,
    storyString: "{{system_prompt}}\n\n=== 角色性格设定 ===\n{{personality}}\n\n=== 角色详细描述 ===\n{{description}}\n\n=== 时代背景与场景设定 ===\n{{scenario}}\n\n{{mes_example}}\n\n{{char_system}}\n\n{{summaries}}\n\n{{lorebook_entries}}\n\n{{jailbreak}}\n\n{{post_history}}",
    customPrompts: [
      {
        id: "prompt_pov_first",
        name: "[视角-建议三选一] “我”视角(主观心流体验)",
        role: "user",
        content: "",
        enabled: false,
      },
      {
        id: "prompt_pov_second",
        name: "[视角-建议三选一] “你”视角(临场感沉浸体验)",
        role: "user",
        content: "",
        enabled: true,
      },
      {
        id: "prompt_pov_third",
        name: "[视角-建议三选一] 旁白视角(宏观多维视点)",
        role: "system",
        content: "",
        enabled: false,
      },
      {
        id: "prompt_style_prose",
        name: "[文风-建议三选一] 文学散文风格(舒缓慢节奏)",
        role: "assistant",
        content: "",
        enabled: false,
      },
      {
        id: "prompt_style_light_novel",
        name: "[文风-建议三选一] 日式轻小说风格(快速推进)",
        role: "assistant",
        content: "",
        enabled: false,
      },
      {
        id: "prompt_custom_writing_style",
        name: "[文风-建议三选一] 自定义风格(自由编辑)",
        role: "system",
        content: "",
        enabled: false,
      },
      {
        id: "prompt_history_trace",
        name: "时空因果链条(防失忆)",
        role: "assistant",
        content: "",
        enabled: true,
      },
      {
        id: "prompt_empathy_first",
        name: "情感共鸣与动作细节",
        role: "user",
        content: "",
        enabled: true,
      },
      {
        id: "prompt_respect_boundary",
        name: "情感尊重与边界意识",
        role: "user",
        content: "",
        enabled: false,
      },
      {
        id: "prompt_no_repeat",
        name: "语言防重复与句法洗炼",
        role: "user",
        content: "",
        enabled: true,
      },
      {
        id: "prompt_limited_knowledge",
        name: "防全知",
        role: "system",
        content: "",
        enabled: true,
      },
      {
        id: "prompt_skip_cot",
        name: "🪄 [优化] 过滤思考直接响应",
        role: "assistant",
        content: "",
        enabled: false,
      },
      {
        id: "prompt_enhanced_reasoning_chain",
        name: "🧠 [优化] 强化思维链 (剧情与逻辑推演)",
        role: "system",
        content: "[System Note: 你的 <think> 思考过程必须是一个结构化、客观且理性的“思维链 (CoT)”。你作为一个全局叙事编排者和系统状态管理器，而不是角色本身。\\n请在 <think> 内部按顺序执行以下分析步骤：\\n1. 【用户意图分析】：分析用户本次行动的真实意图、情绪倾向，以及当前场景的核心冲突与剧情进度。\\n2. 【设定与规则校验】：检索角色性格设定、当前触发的世界书条目、以及系统规则。判断是否有需要特别遵守或避免的细节冲突。\\n3. 【状态与表格管理】：评估角色当前的心境、好感关系、随身道具。决定本轮是否需要输出状态表修改指令（如 updateRow / insertRow），规划具体的修改参数。\\n4. 【角色行为构思】：基于人设和前文，设计 {{char}} 的神态、动作、心理逻辑和对白。\\n5. 【回复结构规划】：规划本轮回复的起承转合。确保行文符合人设，且绝不代替用户进行任何发言或行为。\\n禁止在 <think> 内部以角色第一人称进行自我沉浸式扮演或撰写小说草稿，保持思考过程的绝对客观与理性。]",
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
  },
  preset: MOBILE_TAVERN_BASIC_PRESET_BUNDLE.preset,
  memory: {
    recentTurns: 6,
    summaryTriggerTurns: 0,
    summaryLength: 120,
    summarySystemPrompt: "",
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
};
