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
    label: "新建会话",
    description: "保留当前会话，并为当前角色新建一轮会话",
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

/** 合并内置与插件命令；内置命令保留宿主语义，名称按大小写不敏感去重。 */
export function mergeComposerCommands(
  builtins: readonly ToolPluginComposerCommand[],
  pluginCommands: readonly ToolPluginComposerCommand[],
): ToolPluginComposerCommand[] {
  const commands = [...builtins];
  const names = new Set(builtins.map((command) => command.name.toLowerCase()));
  for (const command of pluginCommands) {
    const name = command.name.toLowerCase();
    if (names.has(name)) continue;
    names.add(name);
    commands.push(command);
  }
  return commands;
}

export interface ExecuteBuiltinComposerCommandContext {
  commandName: string;
  argument: string;
  hasActiveSession: boolean;
  continueText: string;
  handleSendMessage: (text: string) => Promise<void>;
  handleRerollLast: () => Promise<void>;
  handleStartNewSession: () => Promise<void>;
  createNewBranch: () => Promise<void>;
  handleAutoSummaryCheck: () => Promise<void>;
  showCustomConfirm: (message: string, title?: string) => Promise<boolean>;
  showCustomAlert: (message: string, title?: string) => Promise<void>;
  setLocalInput: (val: string) => void;
  setUserInputMessage: (val: string) => void;
  setReplySuggestions: () => void;
  focusTextarea: () => void;
  availableCommands: readonly ToolPluginComposerCommand[];
}

export async function executeBuiltinComposerCommand(
  ctx: ExecuteBuiltinComposerCommandContext,
): Promise<void> {
  const {
    commandName,
    argument,
    hasActiveSession,
    continueText,
    handleSendMessage,
    handleRerollLast,
    handleStartNewSession,
    createNewBranch,
    handleAutoSummaryCheck,
    showCustomConfirm,
    showCustomAlert,
    setLocalInput,
    setUserInputMessage,
    setReplySuggestions,
    focusTextarea,
    availableCommands,
  } = ctx;

  switch (commandName) {
    case "continue": {
      setLocalInput("");
      setUserInputMessage("");
      setReplySuggestions();
      await handleSendMessage(continueText);
      return;
    }
    case "reroll": {
      setLocalInput("");
      setUserInputMessage("");
      setReplySuggestions();
      await handleRerollLast();
      return;
    }
    case "clear": {
      const confirmed = await showCustomConfirm(
        "当前会话会保留。确认要为此角色新建一轮会话吗？",
        "新建会话",
      );
      if (confirmed) {
        setLocalInput("");
        setUserInputMessage("");
        setReplySuggestions();
        await handleStartNewSession();
      }
      return;
    }
    case "branch": {
      setLocalInput("");
      setUserInputMessage("");
      setReplySuggestions();
      await createNewBranch();
      return;
    }
    case "send":
    case "say": {
      if (!argument) {
        const nextInput = `/${commandName} `;
        setLocalInput(nextInput);
        setUserInputMessage(nextInput);
        requestAnimationFrame(focusTextarea);
        return;
      }
      setLocalInput("");
      setUserInputMessage("");
      setReplySuggestions();
      await handleSendMessage(argument);
      return;
    }
    case "memo": {
      setLocalInput("");
      setUserInputMessage("");
      setReplySuggestions();
      if (hasActiveSession) {
        await handleAutoSummaryCheck();
        await showCustomAlert("已立即触发当前会话的历史摘要与长期记忆提炼。", "记忆提取");
      }
      return;
    }
    case "help": {
      setLocalInput("");
      setUserInputMessage("");
      setReplySuggestions();
      const helpLines = availableCommands.map(
        (cmd) => `/${cmd.name}${cmd.acceptsArgument ? " <参数>" : ""} - ${cmd.label}：${cmd.description}`,
      );
      await showCustomAlert(helpLines.join("\n\n"), "斜杠命令列表与说明");
      return;
    }
  }
}
