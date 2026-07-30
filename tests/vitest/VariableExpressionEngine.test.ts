import { describe, expect, it } from "vitest";
import { evaluateVariableCondition } from "../../src/domain/conditions";
import { resolveTriggeredLorebookEntries } from "../../src/application/services/prompt/LorebookResolver";

describe("VariableExpressionEngine", () => {
  const context = {
    variables: { loyalty: 85, flags: { rescued: true }, route: "moon" },
    session: { messageCount: 12, title: "支线" },
  };

  it("支持变量、会话字段、比较、布尔运算和括号", () => {
    expect(evaluateVariableCondition(
      '({var::loyalty} >= 80 && {var::flags.rescued}) || {session::title} == "主线"',
      context,
    )).toBe(true);
    expect(evaluateVariableCondition(
      '{var::route} == "sun" || {session::messageCount} < 10',
      context,
    )).toBe(false);
  });

  it("缺失表达式保持兼容，缺失变量和非法输入安全返回 false", () => {
    expect(evaluateVariableCondition(undefined, context)).toBe(true);
    expect(evaluateVariableCondition("{var::missing}", context)).toBe(false);
    expect(evaluateVariableCondition("globalThis.alert(1)", context)).toBe(false);
    expect(evaluateVariableCondition("{var::loyalty} >= 80 trailing", context)).toBe(false);
  });

  it("不对数字字符串做隐式类型转换", () => {
    expect(evaluateVariableCondition('{var::loyalty} == "85"', context)).toBe(false);
  });

  it("在关键词命中后按变量条件过滤世界书条目", () => {
    const entries = [
      {
        id: "high-loyalty", keys: ["月门"], content: "允许进入", enabled: true,
        constant: false, condition: "{var::loyalty} >= 80",
      },
      {
        id: "low-loyalty", keys: ["月门"], content: "拒绝进入", enabled: true,
        constant: false, condition: "{var::loyalty} < 80",
      },
    ];
    const active = resolveTriggeredLorebookEntries([], "抵达月门", entries, 3, context);
    expect(active.map((entry) => entry.id)).toEqual(["high-loyalty"]);
  });
});
