import { describe, expect, it } from "vitest";
import {
  filterComposerCommandSuggestions,
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
});
