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
});

it("畸形外部脚本安全跳过，后续合法脚本继续执行", () => {
  const character = { extensions: { regex_scripts: [
    { findRegex: 123, replaceString: "broken" },
    { findRegex: "/a/g", replaceString: { invalid: true } },
    { findRegex: "/a/g", replaceString: "bad", trimStrings: [12] },
    { findRegex: "/a/g", replaceString: "good" },
  ] } };
  expect(applySillyTavernRegexScripts("a", character)).toBe("good");
});
