import React from "react";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_COMPOSER_COMMANDS,
  filterComposerCommandSuggestions,
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
    expect(builtinNames).toContain("sys");
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

  it("ComposerCommandSuggestions 渲染时英文字段具有固定宽度与上限截断，保证中文名统一起始列", async () => {
    const { render, screen } = await import("@testing-library/react");
    const { ComposerCommandSuggestions } = await import("../../src/tabs/chat/ComposerCommandSuggestions");

    const { container } = render(
      React.createElement(ComposerCommandSuggestions, {
        suggestions: commands,
        selectedIndex: 0,
        isExecuting: false,
        onSelectCommand: () => {},
        onHoverIndex: () => {},
      })
    );

    const echoName = screen.getByText("/echo");
    expect(echoName.className).toContain("w-24");
    expect(echoName.className).toContain("truncate");
    expect(echoName.getAttribute("title")).toBe("/echo");
  });
});
