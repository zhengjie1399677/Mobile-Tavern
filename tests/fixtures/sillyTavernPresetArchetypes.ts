import type { SillyTavernCompatibilityLevel } from "../../src/infrastructure/compat/sillytavern";

export interface SillyTavernPresetArchetype {
  id: string;
  description: string;
  preset: Record<string, unknown>;
  expected: {
    level: SillyTavernCompatibilityLevel;
    promptCount: number;
    enabledPromptCount: number;
    importedEnabledPromptCount?: number;
    regexCount: number;
    diagnostics: string[];
  };
}

const createRegexScripts = (count: number): Array<Record<string, unknown>> =>
  Array.from({ length: count }, (_, index) => ({
    id: `regex-${index + 1}`,
    scriptName: `规则 ${index + 1}`,
    findRegex: `/fixture-${index + 1}/g`,
    replaceString: "",
  }));

/**
 * 从已检查的社区预设中提炼的数据形状快照。
 * 只保留影响兼容判定的结构，不收录作者提示词、样式或脚本正文。
 */
export const SILLY_TAVERN_PRESET_ARCHETYPES: readonly SillyTavernPresetArchetype[] = [
  {
    id: "universal-light-legacy",
    description: "较早版本的通用轻量编排",
    preset: {
      name: "通用轻量旧版形状",
      prompts: [
        { identifier: "main", name: "主提示词", content: "MAIN" },
        { identifier: "worldInfoBefore", marker: true },
        { identifier: "chatHistory", marker: true },
        { identifier: "postHistoryInstructions", content: "POST" },
      ],
      prompt_order: [{
        character_id: 100001,
        order: [
          { identifier: "main", enabled: true },
          { identifier: "worldInfoBefore", enabled: true },
          { identifier: "chatHistory", enabled: true },
          { identifier: "postHistoryInstructions", enabled: false },
        ],
      }],
      extensions: { regex_scripts: createRegexScripts(12) },
    },
    expected: {
      level: "full",
      promptCount: 4,
      enabledPromptCount: 3,
      regexCount: 12,
      diagnostics: [],
    },
  },
  {
    id: "universal-light-current",
    description: "更新后的通用轻量编排，包含更多正则和 In-Chat 注入",
    preset: {
      name: "通用轻量新版形状",
      prompts: [
        { identifier: "main", name: "主提示词", content: "MAIN" },
        { identifier: "worldInfoBefore", marker: true },
        { identifier: "chatHistory", marker: true },
        {
          identifier: "format-tail",
          name: "格式尾注",
          role: "system",
          content: "FORMAT",
          injection_position: 1,
          injection_depth: 1,
          injection_order: 20,
        },
      ],
      prompt_order: [{
        character_id: "100001",
        order: [
          { identifier: "main", enabled: true },
          { identifier: "worldInfoBefore", enabled: true },
          { identifier: "chatHistory", enabled: true },
          { identifier: "format-tail", enabled: true },
        ],
      }],
      extensions: { regex_scripts: createRegexScripts(36) },
    },
    expected: {
      level: "full",
      promptCount: 4,
      enabledPromptCount: 4,
      regexCount: 36,
      diagnostics: [],
    },
  },
  {
    id: "database-dependent",
    description: "依赖数据库附着语义和 Agent Marker 的编排",
    preset: {
      name: "数据库依赖形状",
      prompts: [
        { identifier: "main", content: "MAIN" },
        { identifier: "agentSystemPrompt", marker: true },
        {
          identifier: "database-context",
          role: "user",
          content: "DATABASE CONTEXT",
          attach_index: 1,
          attach_role: "user",
          attach_side: "before",
        },
        { identifier: "chatHistory", marker: true },
      ],
      prompt_order: [{
        character_id: 100001,
        order: [
          { identifier: "main", enabled: true },
          { identifier: "agentSystemPrompt", enabled: true },
          { identifier: "database-context", enabled: true },
          { identifier: "chatHistory", enabled: true },
        ],
      }],
    },
    expected: {
      level: "recognize_only",
      promptCount: 4,
      enabledPromptCount: 4,
      importedEnabledPromptCount: 3,
      regexCount: 0,
      diagnostics: ["UNSUPPORTED_ATTACHMENT_PROMPTS", "UNSUPPORTED_AGENT_MARKERS"],
    },
  },
  {
    id: "frontend-heavy",
    description: "Prompt 本体可导入，但视觉与交互依赖预设脚本的重前端编排",
    preset: {
      name: "重前端形状",
      prompts: [
        { identifier: "main", content: "MAIN" },
        { identifier: "chatHistory", marker: true },
        { identifier: "frontend-output", role: "assistant", content: "OUTPUT CONTRACT" },
      ],
      prompt_order: [{
        character_id: 100001,
        order: [
          { identifier: "main", enabled: true },
          { identifier: "chatHistory", enabled: true },
          { identifier: "frontend-output", enabled: true },
        ],
      }],
      extensions: {
        regex_scripts: createRegexScripts(8),
        tavern_helper: {
          scripts: [{
            id: "frontend-runtime",
            enabled: true,
            content: "import 'https://fixture.invalid/frontend-runtime.js'",
          }],
        },
      },
    },
    expected: {
      level: "core",
      promptCount: 3,
      enabledPromptCount: 3,
      regexCount: 8,
      diagnostics: [
        "PRESET_TAVERN_HELPER_SCRIPTS_NOT_EXECUTED",
        "REMOTE_SCRIPT_EXECUTION_BLOCKED",
      ],
    },
  },
];
