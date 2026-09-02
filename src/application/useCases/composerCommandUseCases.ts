import type { ToolPluginComposerCommand } from "../../domain/toolPlugins";

export interface ComposerCommandInvocation {
  readonly command: ToolPluginComposerCommand;
  readonly argument: string;
}

/** 只识别完整的单行斜杠命令；未知命令仍作为普通聊天文本发送。 */
export function resolveComposerCommandInvocation(
  input: string,
  commands: readonly ToolPluginComposerCommand[],
): ComposerCommandInvocation | null {
  if (!input.startsWith("/") || /\r|\n/.test(input)) return null;
  const match = /^\/([a-z][a-z0-9-]{0,31})(?:[ \t]+(.*))?$/.exec(input);
  if (!match) return null;
  const command = commands.find((candidate) => candidate.name === match[1].toLowerCase());
  return command ? { command, argument: (match[2] ?? "").trim() } : null;
}

export function filterComposerCommandSuggestions(
  input: string,
  commands: readonly ToolPluginComposerCommand[],
): ToolPluginComposerCommand[] {
  const match = /^\/([a-z0-9-]*)$/i.exec(input);
  if (!match) return [];
  const prefix = match[1].toLowerCase();
  return commands.filter((command) => command.name.startsWith(prefix));
}
