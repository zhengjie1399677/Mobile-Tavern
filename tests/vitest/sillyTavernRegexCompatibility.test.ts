import { describe, expect, it } from "vitest";
import { applySillyTavernRegexScripts } from "../../src/compatibility/sillytavern/mvuParser";

describe("SillyTavern Compatibility Regex 来源与阶段", () => {
  it("按 global → preset → character 顺序应用脚本", () => {
    const result = applySillyTavernRegexScripts(
      "x",
      {
        name: "角色",
        extensions: {
          regex_scripts: [{ findRegex: "preset", replaceString: "character", placement: [2] }],
        },
      },
      true,
      "角色",
      "用户",
      "prompt",
      undefined,
      {
        globalRegexScripts: [{ findRegex: "x", replaceString: "global", placement: [2] }],
        presetRegexScripts: [{ findRegex: "global", replaceString: "preset", placement: [2] }],
      },
    );

    expect(result).toBe("character");
  });

  it("保留 placement 过滤，不把输出脚本应用到用户输入", () => {
    const result = applySillyTavernRegexScripts(
      "x",
      { name: "角色", extensions: {} },
      false,
      "角色",
      "用户",
      "prompt",
      undefined,
      { globalRegexScripts: [{ findRegex: "x", replaceString: "output", placement: [2] }] },
    );

    expect(result).toBe("x");
  });

  it("去重重复来源并对高风险回溯表达式 fail-closed", () => {
    const result = applySillyTavernRegexScripts(
      "x",
      {
        name: "角色",
        extensions: {
          regex_scripts: [{
            id: "same",
            findRegex: "x",
            replaceString: "character",
            placement: [2],
          }],
        },
      },
      true,
      "角色",
      "用户",
      "prompt",
      undefined,
      {
        globalRegexScripts: [{ id: "same", findRegex: "x", replaceString: "global", placement: [2] }],
        presetRegexScripts: [{ findRegex: "(x+)+", replaceString: "unsafe", placement: [2] }],
      },
    );

    expect(result).toBe("global");
  });

  it("跨行匹配 [\\s\\S]*? 不被误判为灾难正则，卡片状态栏正则可正常替换", () => {
    const result = applySillyTavernRegexScripts(
      "<SceneInfo>\n地点：测试小区\n</SceneInfo>\n正文",
      {
        name: "角色",
        extensions: {
          regex_scripts: [{
            id: "card-illustration",
            scriptName: "插图",
            findRegex: "/<SceneInfo>([\\s\\S]*?)<\\/SceneInfo>/gm",
            replaceString: "```\n<!DOCTYPE html><html><body>card</body></html>\n```",
            disabled: false,
            placement: [1, 2],
            markdownOnly: true,
            promptOnly: false,
          }],
        },
      },
      true,
      "角色",
      "用户",
      "render",
    );

    expect(result).toContain("card");
    expect(result).not.toContain("<SceneInfo>");
    expect(result).toContain("正文");
  });

  it("真正的嵌套量词仍然 fail-closed", () => {
    const result = applySillyTavernRegexScripts(
      "xxxx",
      {
        name: "角色",
        extensions: {
          regex_scripts: [{
            id: "unsafe",
            scriptName: "unsafe",
            findRegex: "(x+)+",
            replaceString: "hit",
            disabled: false,
            placement: [1, 2],
            markdownOnly: true,
            promptOnly: false,
          }],
        },
      },
      true,
      "角色",
      "用户",
      "render",
    );

    expect(result).toBe("xxxx");
  });
});
