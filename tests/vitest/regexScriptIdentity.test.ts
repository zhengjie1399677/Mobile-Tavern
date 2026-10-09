import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  regexScriptKey,
  removeRegexScriptByKey,
  setRegexScriptDisabledByKey,
  upsertRegexScriptByKey,
} from "../../src/domain/regex/regexScriptIdentity";
import type { RegexScript } from "../../src/types";

function script(overrides: Partial<RegexScript>): RegexScript {
  return {
    id: "",
    scriptName: "脚本",
    findRegex: "/a/g",
    replaceString: "b",
    ...overrides,
  } as RegexScript;
}

describe("正则脚本身份 (regexScriptIdentity)", () => {
  it("优先使用 id，缺 id 时回落到 scriptName", () => {
    expect(regexScriptKey(script({ id: "abc", scriptName: "显示名" }))).toBe("abc");
    expect(regexScriptKey(script({ id: "   ", scriptName: "显示名" }))).toBe("显示名");
  });

  it("按身份替换命中项，重命名缺 id 的历史脚本不会覆盖其它缺 id 脚本", () => {
    const list = [
      script({ scriptName: "甲", findRegex: "/a/g" }),
      script({ scriptName: "乙", findRegex: "/b/g" }),
    ];
    // 编辑器打开时会注入稳定身份（id = scriptName），保存时按它定位。
    const edited = script({ id: "乙", scriptName: "乙（改名）", findRegex: "/b/g" });

    const next = upsertRegexScriptByKey(list, edited);

    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ scriptName: "甲", findRegex: "/a/g" });
    expect(next[1]).toMatchObject({ id: "乙", scriptName: "乙（改名）" });
  });

  it("身份未命中时追加，不产生重复覆盖", () => {
    const list = [script({ id: "a", scriptName: "甲" })];

    const next = upsertRegexScriptByKey(list, script({ id: "b", scriptName: "乙" }));

    expect(next.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("开关只命中目标脚本：缺 id 的历史脚本不会连坐，也不会静默失效", () => {
    const list = [script({ scriptName: "甲" }), script({ scriptName: "乙" })];

    const next = setRegexScriptDisabledByKey(list, "乙", true);

    expect(next.map((item) => [item.scriptName, item.disabled])).toEqual([
      ["甲", undefined],
      ["乙", true],
    ]);
    // 目标已经是该状态时视为无变化，返回原数组供调用方跳过写入。
    expect(setRegexScriptDisabledByKey(next, "乙", true)).toBe(next);
  });

  it("删除只命中目标脚本；未命中时返回原数组", () => {
    const list = [script({ scriptName: "甲" }), script({ scriptName: "乙" })];

    const next = removeRegexScriptByKey(list, "乙");

    expect(next.map((item) => item.scriptName)).toEqual(["甲"]);
    expect(removeRegexScriptByKey(list, "不存在")).toBe(list);
  });
});

/**
 * 守卫：三轨的开关/删除必须走同一个身份函数。
 *
 * UI 侧（RegexManagementSection）传给 handler 的是 `regexScriptKey(r)`（缺 id 回落到
 * scriptName）。hook 里若仍手工比对 `r.id`，缺 id 的历史脚本就会静默失效——这正是
 * 本次修复的回归点，因此这里把"调用口径"钉死（与本仓其它静态守卫同类）。
 */
describe("正则轨身份调用口径", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "../../src/components/presetForm/usePresetFormState.ts"),
    "utf8",
  );

  it("开关与删除共用领域身份函数，不再手工比对 id/scriptName", () => {
    expect(source).toContain("setRegexScriptDisabledByKey");
    expect(source).toContain("removeRegexScriptByKey");
    expect(source).not.toMatch(/\br\.id === id\b/);
    expect(source).not.toMatch(/\br\.id !== id\b/);
  });
});
