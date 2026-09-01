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
          sourceMetadata: { extensions: { selectiveLogic: 4 } },
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
});
