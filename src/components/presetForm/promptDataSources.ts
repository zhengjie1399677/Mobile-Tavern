export const PROMPT_DATA_SOURCE_OPTIONS = [
  ["character.name", "prompt_composer.macro_character_name", "prompt_composer.group_character"],
  ["character.description", "prompt_composer.macro_character_description", "prompt_composer.group_character"],
  ["character.personality", "prompt_composer.macro_character_personality", "prompt_composer.group_character"],
  ["character.scenario", "prompt_composer.macro_character_scenario", "prompt_composer.group_character"],
  ["character.systemPrompt", "prompt_composer.macro_character_system", "prompt_composer.group_character"],
  ["character.examples", "prompt_composer.macro_character_examples", "prompt_composer.group_character"],
  ["persona.name", "prompt_composer.macro_persona_name", "prompt_composer.group_persona"],
  ["persona.description", "prompt_composer.macro_persona_description", "prompt_composer.group_persona"],
  ["worldbook.triggered", "prompt_composer.macro_worldbook_triggered", "prompt_composer.group_worldbook"],
  ["worldbook.before", "prompt_composer.macro_worldbook_before", "prompt_composer.group_worldbook"],
  ["worldbook.after", "prompt_composer.macro_worldbook_after", "prompt_composer.group_worldbook"],
  ["memory.summaries", "prompt_composer.macro_memory_summaries", "prompt_composer.group_memory"],
  ["memory.recalled", "prompt_composer.macro_memory_recalled", "prompt_composer.group_memory"],
  ["memory.tables", "prompt_composer.macro_memory_tables", "prompt_composer.group_memory"],
  ["prompt.main", "prompt_composer.macro_prompt_main", "prompt_composer.group_prompt"],
  ["prompt.jailbreak", "prompt_composer.macro_prompt_jailbreak", "prompt_composer.group_prompt"],
  ["prompt.postHistory", "prompt_composer.macro_prompt_post", "prompt_composer.group_prompt"],
  ["input.current", "prompt_composer.macro_current_input", "prompt_composer.group_input"],
] as const;

/** 运行时适配器当前承诺提供的全部键；旧宏别名只用于兼容，不主动引导用户使用。 */
export const PROMPT_DATA_SOURCE_KEYS = [
  ...PROMPT_DATA_SOURCE_OPTIONS.map(([key]) => key),
  "prompt.tableMemory",
  "feature.replySuggestions",
  "char",
  "user",
  "description",
  "personality",
  "scenario",
  "userPersona",
  "mes_example",
] as const;
