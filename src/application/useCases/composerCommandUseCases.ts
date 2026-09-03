import type { ToolPluginComposerCommand } from "../../domain/toolPlugins";

export interface ComposerCommandInvocation {
  readonly command: ToolPluginComposerCommand;
  readonly argument: string;
}

/** 规范化输入首字符的斜杠（兼容全角／与半角/） */
export function normalizeSlashInput(input: string): string {
  return input.replace(/^[／/]/, "/");
}

/** 内置宿主快捷斜杠命令列表 */
export const BUILTIN_COMPOSER_COMMANDS: readonly ToolPluginComposerCommand[] = [
  {
    name: "continue",
    label: "继续生成",
    description: "让当前角色接着上一轮对话继续剧情演绎",
    pluginId: "host.builtin",
    toolName: "host.builtin.continue",
    acceptsArgument: false,
  },
  {
    name: "reroll",
    label: "重新生成",
    description: "消除最后一条 AI 回复并重新生成本轮剧情",
    pluginId: "host.builtin",
    toolName: "host.builtin.reroll",
    acceptsArgument: false,
  },
  {
    name: "clear",
    label: "清空上下文",
    description: "清空当前会话消息记录（重置当前对话）",
    pluginId: "host.builtin",
    toolName: "host.builtin.clear",
    acceptsArgument: false,
  },
  {
    name: "branch",
    label: "分支剧情",
    description: "基于当前进度分叉创建一条新的故事线分支",
    pluginId: "host.builtin",
    toolName: "host.builtin.branch",
    acceptsArgument: false,
  },
  {
    name: "sys",
    label: "系统旁白 / 指令",
    description: "以系统视角发送剧情旁白或注入临时设定",
    pluginId: "host.builtin",
    toolName: "host.builtin.sys",
    acceptsArgument: true,
  },
  {
    name: "memo",
    label: "提炼记忆摘要",
    description: "立即对当前会话生成长期记忆与剧情摘要",
    pluginId: "host.builtin",
    toolName: "host.builtin.memo",
    acceptsArgument: false,
  },
  {
    name: "send",
    label: "直接发送",
    description: "以用户身份向当前会话直接发送指定文本消息",
    pluginId: "host.builtin",
    toolName: "host.builtin.send",
    acceptsArgument: true,
  },
  {
    name: "say",
    label: "用户发言",
    description: "以用户身份向当前角色发送对话内容",
    pluginId: "host.builtin",
    toolName: "host.builtin.say",
    acceptsArgument: true,
  },
  {
    name: "help",
    label: "命令帮助",
    description: "查看所有可用的内置与插件斜杠命令说明",
    pluginId: "host.builtin",
    toolName: "host.builtin.help",
    acceptsArgument: false,
  },
] as const;

/** 只识别完整的单行斜杠命令；未知命令仍作为普通聊天文本发送。 */
export function resolveComposerCommandInvocation(
  input: string,
  commands: readonly ToolPluginComposerCommand[],
): ComposerCommandInvocation | null {
  const normalized = normalizeSlashInput(input);
  if (!normalized.startsWith("/") || /\r|\n/.test(normalized)) return null;
  const match = /^\/([a-z][a-z0-9-]{0,31})(?:[ \t]+(.*))?$/i.exec(normalized);
  if (!match) return null;
  const command = commands.find((candidate) => candidate.name.toLowerCase() === match[1].toLowerCase());
  return command ? { command, argument: (match[2] ?? "").trim() } : null;
}

export function filterComposerCommandSuggestions(
  input: string,
  commands: readonly ToolPluginComposerCommand[],
): ToolPluginComposerCommand[] {
  const normalized = normalizeSlashInput(input);
  const match = /^\/([a-z0-9-]*)$/i.exec(normalized);
  if (!match) return [];
  const prefix = match[1].toLowerCase();
  return commands.filter((command) => command.name.toLowerCase().startsWith(prefix));
}
