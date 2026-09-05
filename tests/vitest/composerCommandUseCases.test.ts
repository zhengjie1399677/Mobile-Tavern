import { describe, expect, it, vi } from "vitest";
import {
  BUILTIN_COMPOSER_COMMANDS,
  executeBuiltinComposerCommand,
  filterComposerCommandSuggestions,
  mergeComposerCommands,
  normalizeSlashInput,
  resolveComposerCommandInvocation,
} from "../../src/application/useCases/composerCommandUseCases";
import type { ToolPluginComposerCommand } from "../../src/domain/toolPlugins";

const commands: ToolPluginComposerCommand[] = [
  {
    name: "echo",
    label: "回显",
    description: "回显参数",
    pluginId: "example.worker",
    toolName: "ext.example.worker.echo",
    acceptsArgument: true,
  },
  {
    name: "time",
    label: "当前时间",
    description: "读取设备时间",
    pluginId: "official.device-time",
    toolName: "ext.official.device-time.system.time",
    acceptsArgument: false,
  },
];

describe("Composer Command Use Cases", () => {
  it("解析完整命令并保留参数正文", () => {
    expect(resolveComposerCommandInvocation("/echo  上海时间 ", commands)).toEqual({
      command: commands[0],
      argument: "上海时间",
    });
  });

  it("未知命令、多行文本和不完整命令继续作为普通聊天文本", () => {
    expect(resolveComposerCommandInvocation("/unknown", commands)).toBeNull();
    expect(resolveComposerCommandInvocation("/time\n补充说明", commands)).toBeNull();
    expect(resolveComposerCommandInvocation("/", commands)).toBeNull();
  });

  it("按命令名前缀提供候选，开始输入参数后关闭候选", () => {
    expect(filterComposerCommandSuggestions("/t", commands)).toEqual([commands[1]]);
    expect(filterComposerCommandSuggestions("/echo 参数", commands)).toEqual([]);
    expect(filterComposerCommandSuggestions("普通文本", commands)).toEqual([]);
  });

  it("只输入斜杠 / 时应该完整列出所有候选命令", () => {
    expect(filterComposerCommandSuggestions("/", commands)).toEqual(commands);
  });

  it("兼容全角斜杠（中文输入法／）的唤起与命令解析", () => {
    expect(normalizeSlashInput("／")).toBe("/");
    expect(normalizeSlashInput("／time")).toBe("/time");
    expect(filterComposerCommandSuggestions("／t", commands)).toEqual([commands[1]]);
    expect(resolveComposerCommandInvocation("／echo 测试内容", commands)).toEqual({
      command: commands[0],
      argument: "测试内容",
    });
  });

  it("内置宿主命令清单 BUILTIN_COMPOSER_COMMANDS 完备且包含常用对话控制", () => {
    const builtinNames = BUILTIN_COMPOSER_COMMANDS.map((c) => c.name);
    expect(builtinNames).toContain("continue");
    expect(builtinNames).toContain("reroll");
    expect(builtinNames).toContain("clear");
    expect(builtinNames).toContain("branch");
    expect(builtinNames).not.toContain("sys");
    expect(builtinNames).toContain("memo");
    expect(builtinNames).toContain("help");
    expect(builtinNames).toContain("send");
    expect(builtinNames).toContain("say");

    // 默认内置命令全部属于 host.builtin 命名空间
    for (const cmd of BUILTIN_COMPOSER_COMMANDS) {
      expect(cmd.pluginId).toBe("host.builtin");
      expect(cmd.toolName).toMatch(/^host\.builtin\./);
    }
  });

  it("内置命令优先于大小写不同的同名插件命令", () => {
    const merged = mergeComposerCommands(BUILTIN_COMPOSER_COMMANDS, [
      { ...commands[0], name: "CLEAR" },
      commands[0],
    ]);

    expect(merged.filter((command) => command.name.toLowerCase() === "clear")).toEqual([
      expect.objectContaining({ pluginId: "host.builtin" }),
    ]);
    expect(merged).toContain(commands[0]);
  });

  it("/clear 明确保留当前会话并在确认后新建会话", async () => {
    const showCustomConfirm = vi.fn(async () => true);
    const handleStartNewSession = vi.fn(async () => undefined);
    await executeBuiltinComposerCommand({
      commandName: "clear",
      argument: "",
      hasActiveSession: true,
      continueText: "继续",
      handleSendMessage: vi.fn(),
      handleRerollLast: vi.fn(),
      handleStartNewSession,
      createNewBranch: vi.fn(),
      handleAutoSummaryCheck: vi.fn(),
      showCustomConfirm,
      showCustomAlert: vi.fn(),
      setLocalInput: vi.fn(),
      setUserInputMessage: vi.fn(),
      setReplySuggestions: vi.fn(),
      focusTextarea: vi.fn(),
      availableCommands: BUILTIN_COMPOSER_COMMANDS,
    });

    expect(showCustomConfirm).toHaveBeenCalledWith(
      expect.stringContaining("当前会话会保留"),
      "新建会话",
    );
    expect(handleStartNewSession).toHaveBeenCalledOnce();
  });
});
