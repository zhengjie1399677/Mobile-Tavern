import { describe, expect, it } from "vitest";
import {
  moveWorkbenchCardTo,
  resolveHiddenWorkbenchCards,
  resolveWorkbenchCardOrder,
} from "../../src/domain/ui/workbenchLayout";

const CATALOG = ["calendar", "mood", "activity", "trend", "storage", "tools"] as const;

describe("工作台卡片布局解析", () => {
  it("无布局时按清单原序返回", () => {
    expect(resolveWorkbenchCardOrder(CATALOG)).toEqual([...CATALOG]);
    expect(resolveWorkbenchCardOrder(CATALOG, null)).toEqual([...CATALOG]);
    expect(resolveHiddenWorkbenchCards(CATALOG)).toEqual([]);
  });

  it("用户顺序优先，新增卡片追加在末尾，未知与重复 id 被忽略", () => {
    expect(resolveWorkbenchCardOrder(CATALOG, {
      order: ["tools", "unknown-card", "tools", "calendar"],
    })).toEqual(["tools", "calendar", "mood", "activity", "trend", "storage"]);
  });

  it("隐藏清单只保留仍然存在的卡片", () => {
    expect(resolveHiddenWorkbenchCards(CATALOG, {
      hidden: ["mood", "removed-card", "mood"],
    })).toEqual(["mood"]);
  });

  it("拖动到目标下标：越界夹取、原位返回、未知 id 无副作用", () => {
    const order = ["a", "b", "c", "d"];
    expect(moveWorkbenchCardTo(order, "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveWorkbenchCardTo(order, "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveWorkbenchCardTo(order, "b", -5)).toEqual(["b", "a", "c", "d"]);
    expect(moveWorkbenchCardTo(order, "b", 99)).toEqual(["a", "c", "d", "b"]);
    expect(moveWorkbenchCardTo(order, "b", 1)).toEqual(["a", "b", "c", "d"]);
    expect(moveWorkbenchCardTo(order, "missing", 2)).toEqual(["a", "b", "c", "d"]);
  });
});
