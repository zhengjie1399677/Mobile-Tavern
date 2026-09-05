import type { WorldInfoTimedState } from "../../src/application/compatibility/contracts";
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
          sourceMetadata: { extensions: { selectiveLogic: 1 } },
        }),
      ],
    });

    expect(result.map((item) => item.id)).toEqual(["高优先级", "低优先级"]);
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
        entry("允许传播的递归条目", { keys: ["解锁词"] }),
        entry("延迟条目", {
          keys: ["种子"],
          content: "延迟内容",
          sourceMetadata: { extensions: { delay_until_recursion: 2 } },
        }),
      ],
    });

    expect(result.map((item) => item.id)).toEqual(["种子条目", "允许传播的递归条目", "延迟条目"]);
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

    let timedState: WorldInfoTimedState | undefined;

    // 第 0 轮：包含关键词触发，设置 sticky: end = 2
    const turn0 = resolveSillyTavernWorldInfo({
      messages: [],
      userInput: "喝醉了酒",
      entries: [drunkenEntry],
      onUpdateTimedState: (state) => { timedState = state; },
    });
    expect(turn0.map((e) => e.id)).toEqual(["醉酒状态"]);
    expect(timedState!.sticky["醉酒状态"]).toMatchObject({ start: 0, end: 2 });

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
    expect(timedState!.cooldown["醉酒状态"]).toMatchObject({ start: 2, end: 3 });

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

  it("Delay 按会话绝对消息位置解锁，同一轮重复扫描不累加", () => {
    const delayed = entry("延迟", { keys: ["触发"], delay: 20 });
    const request = { entries: [delayed], userInput: "触发", messages: [{ id: "last", sender: "user" as const, content: "触发", timestamp: 0, turnIndex: 18 }] };
    expect(resolveSillyTavernWorldInfo(request)).toEqual([]);
    expect(resolveSillyTavernWorldInfo(request)).toEqual([]);
    expect(resolveSillyTavernWorldInfo({ ...request, messages: [{ ...request.messages[0], turnIndex: 19 }] })).toEqual([delayed]);
  });

  it.each([[0, false], [1, true], [2, true], [3, false]])("外部选择逻辑 %i 遵循 ST 枚举", (logic, active) => {
    const result = resolveSillyTavernWorldInfo({ messages: [], userInput: "主关键词", entries: [entry("条件", {
      keys: ["主关键词"], secondary_keys: ["缺失"], sourceMetadata: { selectiveLogic: logic },
    })] });
    expect(result.length > 0).toBe(active);
  });

  it("预算排除的条目不递归、不启动时效，延迟递归不会在首轮触发", () => {
    let state: WorldInfoTimedState | undefined;
    const result = resolveSillyTavernWorldInfo({ messages: [], userInput: "触发", recursive: false,
      onUpdateTimedState: next => { state = next; }, entries: [
        entry("超量", { keys: ["触发"], content: "x".repeat(7000), sticky: 4 }),
        entry("延迟递归", { keys: ["触发"], delayUntilRecursion: 1 }),
      ] });
    expect(result).toEqual([]);
    expect(state?.sticky).toEqual({});
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
