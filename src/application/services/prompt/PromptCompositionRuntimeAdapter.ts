import type {
  CharacterCard,
  ChatSession,
  LorebookEntry,
  Message,
  TableMemorySheet,
  UserSettings,
} from "../../../types";
import type {
  PromptCompositionRuntimeData,
  PromptMessage,
} from "../../../domain/prompt-composition";
import type { ContextContribution } from "../../../domain/contextSources/contracts";
import {
  formatTableMemoryColumnConstraint,
  getTableMemoryColumnDefinitions,
} from "../../../domain/memory/tableMemorySchema";

export interface PromptCompositionRuntimeParams {
  character: CharacterCard;
  chat: ChatSession;
  userInput: string;
  settings: UserSettings;
  triggeredLorebook: LorebookEntry[];
  /** 只读消费：迁移后可能来自上下文贡献的审计数据（readonly）。 */
  recalledMemories: readonly unknown[];
  /**
   * 通用上下文来源的贡献（C1a 起支持）。来源只提供内容与宏名；
   * 已存在的内建数据源键不被覆盖，避免来源误伤 `char`/`memory.recalled` 等既有值。
   */
  contextContributions?: readonly ContextContribution[];
  cleanHistoryContent?: (message: Message, depth: number) => string;
}

/**
 * 将应用业务数据投影成编译器可消费的命名字符串数据源。
 * 数据源适配器不决定任何消息角色、顺序或包装文案。
 */
export function buildPromptCompositionRuntimeData(
  params: PromptCompositionRuntimeParams
): PromptCompositionRuntimeData {
  const { character, chat, userInput, settings, triggeredLorebook, recalledMemories } = params;
  const beforeLore = triggeredLorebook.filter((entry) => entry.position === "before_char_def");
  const afterLore = triggeredLorebook.filter((entry) => entry.position !== "before_char_def");
  const summaries = (chat.summaries ?? [])
    .map((summary) => `[${summary.timeTag} | ${summary.location}] ${summary.content}`)
    .join("\n");
  const recalled = recalledMemories.map(formatRecalledMemory).filter(Boolean).join("\n\n");
  const tableMemory = formatTableMemory(chat.tableMemory ?? [], settings.promptConfig?.tableMemoryPrompt ?? "");

  const values: Record<string, string> = {
    "character.name": character.name || "",
    "character.description": character.description || "",
    "character.personality": character.personality || "",
    "character.scenario": character.scenario || "",
    "character.systemPrompt": character.system_prompt || "",
    "character.examples": character.mes_example || "",
    "persona.name": settings.userName || "",
    "persona.description": settings.userInfo || "",
    "worldbook.triggered": triggeredLorebook.map((entry) => entry.content).join("\n\n"),
    "worldbook.before": beforeLore.map((entry) => entry.content).join("\n\n"),
    "worldbook.after": afterLore.map((entry) => entry.content).join("\n\n"),
    "memory.summaries": summaries,
    "memory.recalled": recalled,
    "memory.tables": tableMemory,
    // 与 PromptService 的 core_rules 一致：子条目开关关闭后该数据源必须为空。
    // 「底层扮演系统指令」与「规则提示词」在预设列表里都按"未声明即启用"展示，
    // 因此这里必须同步用 `!== false`，否则界面显示开启而请求里是空的。
    "prompt.main": settings.promptConfig?.useMainPrompt === false
      ? ""
      : settings.promptConfig?.mainPrompt || "",
    "prompt.jailbreak": settings.promptConfig?.useJailbreak === false
      ? ""
      : settings.promptConfig?.jailbreakPrompt || "",
    "prompt.postHistory": settings.promptConfig?.usePostHistory ? settings.promptConfig.postHistoryPrompt || "" : "",
    "prompt.tableMemory": settings.promptConfig?.tableMemoryPrompt || "",
    "feature.replySuggestions": settings.enableReplySuggestions ? settings.replySuggestionsPrompt || "" : "",
    "input.current": userInput,
    // 兼容常用旧宏；它们仍只是数据源别名，不携带位置语义。
    char: character.name || "",
    user: settings.userName || "",
    description: character.description || "",
    personality: character.personality || "",
    scenario: character.scenario || "",
    userPersona: settings.userInfo || "",
    mes_example: character.mes_example || "",
  };

  for (const contribution of params.contextContributions ?? []) {
    if (!canContributionWriteMacro(contribution.macroName)) continue;
    values[contribution.macroName] = contribution.content;
  }

  return {
    values,
    history: mapHistory(chat.messages ?? [], settings, character, params.cleanHistoryContent),
  };
}

/**
 * 贡献只能写 `context.*` 命名空间，或写入**显式迁移**的既有宏。
 *
 * 白名单必须逐个登记：来源误用 `char`/`worldbook.*`/`prompt.*` 等内建宏一律无效，
 * 避免外部内容覆盖角色、世界书或提示词配置；`memory.recalled` 已由记忆召回迁移占用。
 */
const CONTRIBUTION_MACRO_ALLOWLIST = new Set(["memory.recalled"]);

function canContributionWriteMacro(macroName: string): boolean {
  return macroName.startsWith("context.") || CONTRIBUTION_MACRO_ALLOWLIST.has(macroName);
}

function mapHistory(
  messages: Message[],
  settings: UserSettings,
  character: CharacterCard,
  cleanHistoryContent?: (message: Message, depth: number) => string
): PromptMessage[] {
  return messages.map((message, index) => {
    const depth = messages.length - 1 - index;
    return {
      role: message.sender === "assistant"
        ? "assistant"
        : message.sender === "system"
          ? "system"
          : "user",
      content: cleanHistoryContent ? cleanHistoryContent(message, depth) : message.content,
      name: settings.api.sendNames
        ? message.sender === "system"
          ? undefined
          : message.sender === "assistant"
            ? sanitizeName(character.name || "char")
            : sanitizeName(settings.userName || "user")
        : undefined,
    };
  });
}

function sanitizeName(value: string): string | undefined {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  return cleaned || undefined;
}

function formatRecalledMemory(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.content === "string") return record.content;
  if (typeof record.text === "string") return record.text;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function formatTableMemory(sheets: TableMemorySheet[], template: string): string {
  const enabledSheets = sheets.filter((sheet) => sheet.enable !== false);
  if (enabledSheets.length === 0) return "";
  const markdown = enabledSheets.map((sheet) => {
    const definitions = getTableMemoryColumnDefinitions(sheet);
    const constraints = definitions.map(formatTableMemoryColumnConstraint).join("；");
    const header = `| ${sheet.columns.join(" | ")} |`;
    const divider = `| ${sheet.columns.map(() => "---").join(" | ")} |`;
    const rows = sheet.rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
    return [`### ${sheet.name}`, sheet.description || "", constraints, header, divider, rows]
      .filter(Boolean)
      .join("\n");
  }).join("\n\n");
  return template ? template.replace(/\{\{sheets_markdown\}\}/g, markdown) : markdown;
}
