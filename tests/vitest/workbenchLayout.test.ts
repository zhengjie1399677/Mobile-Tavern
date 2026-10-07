import { describe, expect, it } from "vitest";
import {
  moveWorkbenchCard,
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

  it("上下移动越界时保持原顺序", () => {
    const order = ["a", "b", "c"];
    expect(moveWorkbenchCard(order, "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveWorkbenchCard(order, "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveWorkbenchCard(order, "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveWorkbenchCard(order, "c", 1)).toEqual(["a", "b", "c"]);
    expect(moveWorkbenchCard(order, "missing", 1)).toEqual(["a", "b", "c"]);
  });
});
