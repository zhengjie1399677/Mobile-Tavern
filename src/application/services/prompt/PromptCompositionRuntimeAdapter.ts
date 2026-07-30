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
  recalledMemories: unknown[];
  cleanHistoryContent?: (message: Message) => string;
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
    "prompt.main": settings.promptConfig?.mainPrompt || "",
    "prompt.jailbreak": settings.promptConfig?.useJailbreak ? settings.promptConfig.jailbreakPrompt || "" : "",
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

  return {
    values,
    history: mapHistory(chat.messages ?? [], settings, character, params.cleanHistoryContent),
  };
}

function mapHistory(
  messages: Message[],
  settings: UserSettings,
  character: CharacterCard,
  cleanHistoryContent?: (message: Message) => string
): PromptMessage[] {
  return messages.map((message) => ({
    role: message.sender === "assistant"
      ? "assistant"
      : message.sender === "system"
        ? "system"
        : "user",
    content: cleanHistoryContent ? cleanHistoryContent(message) : message.content,
    name: settings.api.sendNames
      ? message.sender === "system"
        ? undefined
        : message.sender === "assistant"
          ? sanitizeName(character.name || "char")
          : sanitizeName(settings.userName || "user")
      : undefined,
  }));
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
