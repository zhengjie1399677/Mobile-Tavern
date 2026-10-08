import { describe, expect, it } from "vitest";
import { resolveSillyTavernWorldInfo } from "../../src/compatibility/sillytavern/worldInfoResolver";
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

describe("SillyTavern Compatibility World Info resolver", () => {
  it("按 ST order 排序，并支持 NOT_ALL secondary logic", () => {
    const result = resolveSillyTavernWorldInfo({
      messages: [],
      userInput: "城门",
      entries: [
        entry("低优先级", { keys: ["城门"], order: 10 }),
        entry("高优先级", {
          keys: ["城门"],
          order: 20,
          secondary_keys: ["不存在", "城门"],
          // ST world_info_logic.NOT_ALL = 1
          sourceMetadata: { extensions: { selectiveLogic: 1 } },
        }),
      ],
    });

    expect(result.map((item) => item.id)).toEqual(["高优先级", "低优先级"]);
  });

  it("按 SillyTavern 数字枚举解释次要关键词策略", () => {
    const resolve = (logic: number, secondaryKeys: string[], input: string) =>
      resolveSillyTavernWorldInfo({
        messages: [],
        userInput: input,
        entries: [
          entry("条目", {
            keys: ["城门"],
            secondary_keys: secondaryKeys,
            sourceMetadata: { extensions: { selectiveLogic: logic } },
          }),
        ],
      }).map((item) => item.id);

    // 0 = AND ANY：至少命中一个次关键词
    expect(resolve(0, ["守卫"], "城门 守卫")).toEqual(["条目"]);
    expect(resolve(0, ["守卫"], "城门")).toEqual([]);
    // 3 = AND ALL：次关键词必须全部命中
    expect(resolve(3, ["守卫", "夜色"], "城门 守卫")).toEqual([]);
    expect(resolve(3, ["守卫", "夜色"], "城门 守卫 夜色")).toEqual(["条目"]);
    // 2 = NOT ANY：任一次关键词都不许出现
    expect(resolve(2, ["守卫"], "城门")).toEqual(["条目"]);
    expect(resolve(2, ["守卫"], "城门 守卫")).toEqual([]);
    // 1 = NOT ALL：只要不是全部命中就放行
    expect(resolve(1, ["守卫", "夜色"], "城门 守卫")).toEqual(["条目"]);
    expect(resolve(1, ["守卫", "夜色"], "城门 守卫 夜色")).toEqual([]);
  });

  it("selective 为 false 时次关键词完全不参与判定", () => {
    const result = resolveSillyTavernWorldInfo({
      messages: [],
      userInput: "城门",
      entries: [
        entry("条目", {
          keys: ["城门"],
          secondary_keys: ["守卫"],
          sourceMetadata: { selective: false, keysecondary: ["守卫"], selectiveLogic: 3 },
        }),
      ],
    });

    expect(result.map((item) => item.id)).toEqual(["条目"]);
  });

  it("旧数据只剩 ST 原生 keysecondary 时仍然生效", () => {
    const result = resolveSillyTavernWorldInfo({
      messages: [],
      userInput: "城门",
      entries: [
        entry("旧条目", {
          keys: ["城门"],
          sourceMetadata: { keysecondary: ["守卫"], selectiveLogic: 0 },
        }),
      ],
    });

    expect(result.map((item) => item.id)).toEqual([]);
  });

  it("未声明 scanDepth 时默认只扫最近 2 条消息", () => {
    const history = [
      { id: "m1", sender: "user" as const, content: "远方的灯塔", timestamp: 0 },
      { id: "m2", sender: "assistant" as const, content: "好的", timestamp: 1 },
      { id: "m3", sender: "user" as const, content: "继续", timestamp: 2 },
    ];
    const run = (overrides: Partial<LorebookEntry>) =>
      resolveSillyTavernWorldInfo({
        messages: history,
        userInput: "在吗",
        entries: [entry("灯塔设定", { keys: ["灯塔"], ...overrides })],
      }).map((item) => item.id);

    expect(run({})).toEqual([]);
    expect(run({ scanDepth: 3 })).toEqual(["灯塔设定"]);
  });

  it("支持延迟递归和 exclude_recursion", () => {
    const result = resolveSillyTavernWorldInfo({
      messages: [],
      userInput: "种子",
      maxRecursionDepth: 3,
      entries: [
        entry("种子条目", {
          keys: ["种子"],
          content: "解锁词",
          sourceMetadata: { extensions: { exclude_recursion: true } },
        }),
        entry("不应递归触发", { keys: ["解锁词"] }),
        entry("延迟条目", {
          keys: ["种子"],
          content: "延迟内容",
          sourceMetadata: { extensions: { delay_until_recursion: 2 } },
        }),
      ],
    });

    expect(result.map((item) => item.id)).toEqual(["种子条目", "延迟条目"]);
    expect(result.some((item) => item.id === "不应递归触发")).toBe(false);
  });

  it("允许 ignore_budget 条目越过兼容插件的默认预算", () => {
    const result = resolveSillyTavernWorldInfo({
      messages: [],
      userInput: "触发",
      entries: [
        entry("超预算条目", {
          keys: ["触发"],
          content: "x".repeat(7000),
          sourceMetadata: { extensions: { ignore_budget: true } },
        }),
      ],
    });

    expect(result.map((item) => item.id)).toEqual(["超预算条目"]);
  });

  it("支持 Sticky 持续激活并自动衔接 Cooldown 冷却", () => {
    const drunkenEntry = entry("醉酒状态", {
      keys: ["喝醉"],
      content: "你感到天旋地转。",
      sticky: 2,
      cooldown: 1,
    });

    let timedState: any = undefined;

    // 第 0 轮：包含关键词触发，设置 sticky: end = 2
    const turn0 = resolveSillyTavernWorldInfo({
      messages: [],
      userInput: "喝醉了酒",
      entries: [drunkenEntry],
      onUpdateTimedState: (state) => { timedState = state; },
    });
    expect(turn0.map((e) => e.id)).toEqual(["醉酒状态"]);
    expect(timedState.sticky["醉酒状态"]).toMatchObject({ start: 0, end: 2 });

    // 第 1 轮：无关键词，但消息数 = 1 < end(2)，强制保持激活
    const turn1 = resolveSillyTavernWorldInfo({
      messages: [{ id: "m1", sender: "user", content: "hi", timestamp: 0 }],
      userInput: "今天天气真好",
      entries: [drunkenEntry],
      timedState,
      onUpdateTimedState: (state) => { timedState = state; },
    });
    expect(turn1.map((e) => e.id)).toEqual(["醉酒状态"]);

    // 第 2 轮：消息数 = 2 >= end(2)，Sticky 过期，自动衔接进入 Cooldown(2+1=3)
    const turn2WithKeyword = resolveSillyTavernWorldInfo({
      messages: [
        { id: "m1", sender: "user", content: "hi", timestamp: 0 },
        { id: "m2", sender: "assistant", content: "hello", timestamp: 1 },
      ],
      userInput: "我又喝醉了",
      entries: [drunkenEntry],
      timedState,
      onUpdateTimedState: (state) => { timedState = state; },
    });
    // 在冷却期内，即使出现关键词也被抑制
    expect(turn2WithKeyword.map((e) => e.id)).toEqual([]);
    expect(timedState.cooldown["醉酒状态"]).toMatchObject({ start: 2, end: 3 });

    // 第 3 轮：消息数 = 3 >= cooldown.end(3)，冷却结束，再次触发成功
    const turn3 = resolveSillyTavernWorldInfo({
      messages: [
        { id: "m1", sender: "user", content: "hi", timestamp: 0 },
        { id: "m2", sender: "assistant", content: "hello", timestamp: 1 },
        { id: "m3", sender: "user", content: "ok", timestamp: 2 },
      ],
      userInput: "再次喝醉",
      entries: [drunkenEntry],
      timedState,
      onUpdateTimedState: (state) => { timedState = state; },
    });
    expect(turn3.map((e) => e.id)).toEqual(["醉酒状态"]);
  });

  it("Delay 按 SillyTavern 语义：聊天楼层数不足时抑制该条目", () => {
    const delayedEntry = entry("蓄力技", {
      keys: ["蓄力"],
      content: "大招准备就绪！",
      delay: 3,
    });

    // 聊天只有 1 层（< 3）：命中关键词也保持抑制
    const run1 = resolveSillyTavernWorldInfo({
      messages: [{ id: "m1", sender: "user", content: "hi", timestamp: 0 }],
      userInput: "开始蓄力",
      entries: [delayedEntry],
    });
    expect(run1.map((e) => e.id)).toEqual([]);

    // 聊天达到 3 层：延迟结束，命中即激活
    const run2 = resolveSillyTavernWorldInfo({
      messages: [
        { id: "m1", sender: "user", content: "hi", timestamp: 0 },
        { id: "m2", sender: "assistant", content: "hello", timestamp: 1 },
        { id: "m3", sender: "user", content: "again", timestamp: 2 },
      ],
      userInput: "继续蓄力",
      entries: [delayedEntry],
    });
    expect(run2.map((e) => e.id)).toEqual(["蓄力技"]);
  });

  it("支持多层级联递归检索及其抑制控制", () => {
    const entryA = entry("帝国骑士团", {
      keys: ["骑士团"],
      content: "骑士团由副团长艾琳诺指挥。",
    });
    const entryB = entry("艾琳诺设定", {
      keys: ["艾琳诺"],
      content: "艾琳诺是一名光系大骑士。",
    });

    // 递归模式开启：提到骑士团自动递归激发艾琳诺
    const resRecursive = resolveSillyTavernWorldInfo({
      messages: [],
      userInput: "我来到骑士团驻地",
      entries: [entryA, entryB],
      recursive: true,
      maxRecursionDepth: 3,
    });
    expect(resRecursive.map((e) => e.id)).toEqual(["帝国骑士团", "艾琳诺设定"]);

    // 显式关闭递归模式：只激发第一层
    const resNonRecursive = resolveSillyTavernWorldInfo({
      messages: [],
      userInput: "我来到骑士团驻地",
      entries: [entryA, entryB],
      recursive: false,
    });
    expect(resNonRecursive.map((e) => e.id)).toEqual(["帝国骑士团"]);

    // entryA 标记 preventRecursion 时，禁止由其内容向下引出递归
    const entryAPrevent = entry("帝国骑士团", {
      keys: ["骑士团"],
      content: "骑士团由副团长艾琳诺指挥。",
      preventRecursion: true,
    });
    const resPrevent = resolveSillyTavernWorldInfo({
      messages: [],
      userInput: "我来到骑士团驻地",
      entries: [entryAPrevent, entryB],
      recursive: true,
    });
    expect(resPrevent.map((e) => e.id)).toEqual(["帝国骑士团"]);
  });
});
