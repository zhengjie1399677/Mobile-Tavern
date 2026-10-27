/**
 * 回归覆盖：QQ 群反馈的两个兼容问题的根因
 *
 * 1. 世界书预算写死 6000 字符，下载卡里体量大的常驻条目会吃光预算，
 *    命中关键词的条目被整批丢弃（表现为"只有一条常驻被输出"）。
 *    现在按上下文窗口推导预算，语义对齐 SillyTavern 的 `world_info_budget`。
 * 2. 兼容脚本只拿到 `window.YAML`，下载卡状态栏调用 `jsyaml.load(...)` 时报
 *    `jsyaml is not defined`；现在两个全局名都指向真实 js-yaml。
 */

import { beforeAll, describe, expect, it } from "vitest";
import { resolveSillyTavernWorldInfo } from "../../src/compatibility/sillytavern/worldInfoResolver";
import { resolveTriggeredLorebookEntries } from "../../src/application/services/prompt/LorebookResolver";
import { resolveWorldInfoBudgetChars } from "../../src/domain/lorebookBudget";
import type { LorebookEntry } from "../../src/types";

function entry(id: string, overrides: Partial<LorebookEntry> = {}): LorebookEntry {
  return {
    id,
    keys: [],
    content: id,
    constant: false,
    enabled: true,
    ...overrides,
  };
}

describe("世界书注入预算", () => {
  it("按上下文窗口推导，未给窗口时用兜底窗口", () => {
    // 25% token 预算按 4 字符/token 折算，数值上等于上下文窗口
    expect(resolveWorldInfoBudgetChars(32_768)).toBe(32_768);
    expect(resolveWorldInfoBudgetChars()).toBeGreaterThan(6000);
  });

  it("大体积常驻条目不再挤掉命中关键词的条目", () => {
    // 复现下载卡：常驻条目 5000 字符 + 一条命中关键词的普通条目。
    // 旧实现预算 6000：常驻先通过、关键词条目被 `currentLength + length > 6000` 丢弃。
    const entries = [
      entry("常驻设定", { constant: true, content: "常".repeat(5000) }),
      entry("城门设定", { keys: ["城门"], content: "城".repeat(2000) }),
    ];

    const withLargeBudget = resolveSillyTavernWorldInfo({
      messages: [],
      userInput: "走到城门前",
      entries,
      budgetChars: 60_000,
    }).map((item) => item.id);
    expect(withLargeBudget).toEqual(["常驻设定", "城门设定"]);

    const withOldBudget = resolveSillyTavernWorldInfo({
      messages: [],
      userInput: "走到城门前",
      entries,
      budgetChars: 6000,
    }).map((item) => item.id);
    expect(withOldBudget).toEqual(["常驻设定"]);
  });

  it("通用解析器同样接受预算参数", () => {
    const entries = [
      entry("常驻设定", { constant: true, content: "常".repeat(5000) }),
      entry("城门设定", { keys: ["城门"], content: "城".repeat(2000) }),
    ];

    expect(
      resolveTriggeredLorebookEntries([], "走到城门前", entries, 3, {}, 60_000).map((item) => item.id),
    ).toEqual(["常驻设定", "城门设定"]);
    expect(
      resolveTriggeredLorebookEntries([], "走到城门前", entries, 3, {}, 6000).map((item) => item.id),
    ).toEqual(["常驻设定"]);
  });

  it("兼容历史数据里的字符串 keys，不因缺少归一而抛异常", () => {
    const asStringKeys = "城门,守卫" as unknown as string[];

    expect(
      resolveSillyTavernWorldInfo({
        messages: [],
        userInput: "城门",
        entries: [entry("字符串关键词", { keys: asStringKeys })],
      }).map((item) => item.id),
    ).toEqual(["字符串关键词"]);

    expect(
      resolveTriggeredLorebookEntries([], "守卫", [entry("字符串关键词", { keys: asStringKeys })]).map(
        (item) => item.id,
      ),
    ).toEqual(["字符串关键词"]);
  });
});

describe("兼容脚本的 jsyaml 全局", () => {
  beforeAll(async () => {
    const { initTavernHelperMocks } = await import("../../src/utils/tavernHelper");
    initTavernHelperMocks();
  });

  it("同时暴露 YAML 与 jsyaml，且能解析嵌套 YAML", async () => {
    const globalWindow = window as unknown as {
      YAML?: { load: (source: string) => unknown };
      jsyaml?: { load: (source: string) => unknown; safeLoad: (source: string) => unknown };
    };

    expect(globalWindow.jsyaml).toBeTruthy();
    expect(globalWindow.YAML).toBeTruthy();

    const parsed = globalWindow.jsyaml?.load("状态:\n  体力: 12\n  物品:\n    - 钥匙\n") as {
      状态?: { 体力?: number; 物品?: string[] };
    };
    expect(parsed.状态?.体力).toBe(12);
    expect(parsed.状态?.物品).toEqual(["钥匙"]);
    // 状态栏脚本里常见 v3 的 safeLoad 别名
    expect(globalWindow.jsyaml?.safeLoad("hp: 3")).toEqual({ hp: 3 });
  });
});
