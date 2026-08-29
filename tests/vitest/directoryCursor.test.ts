import { describe, expect, it } from "vitest";
import {
  compareDirectoryValues,
  getBackupMetadataSortValue,
  getSessionSortValue,
  toBackupMetadataCursor,
  toSessionDirectoryCursor,
} from "../../src/domain/session-management";

describe("会话目录排序与稳定游标工具", () => {
  it("会话排序值使用 updatedAt 兜底 createdAt，轮次缺省为 0", () => {
    expect(getSessionSortValue(
      { createdAt: 1, updatedAt: 2, title: "t", turnCount: 3 },
      "updated_desc",
    )).toBe(2);
    expect(getSessionSortValue(
      { createdAt: 1, updatedAt: undefined, title: "t", turnCount: 3 },
      "updated_desc",
    )).toBe(1);
    expect(getSessionSortValue(
      { createdAt: 1, updatedAt: 2, title: "t", turnCount: undefined },
      "turns_desc",
    )).toBe(0);
    expect(getSessionSortValue(
      { createdAt: 1, updatedAt: 2, title: "甲", turnCount: 3 },
      "title_asc",
    )).toBe("甲");
  });

  it("收藏元数据按 messageCount 提供轮次排序值", () => {
    expect(getBackupMetadataSortValue(
      { createdAt: 1, updatedAt: 2, title: "t", messageCount: 8 },
      "turns_desc",
    )).toBe(8);
    expect(getBackupMetadataSortValue(
      { createdAt: 1, updatedAt: 2, title: "t", messageCount: 8 },
      "title_asc",
    )).toBe("t");
  });

  it("比较语义：数值按大小、字符串按码元顺序、跨类型按字符串化", () => {
    expect(compareDirectoryValues(2, 10)).toBeLessThan(0);
    expect(compareDirectoryValues("b", "a")).toBeGreaterThan(0);
    expect(compareDirectoryValues("2", 10)).toBeGreaterThan(0);
    expect(compareDirectoryValues(5, "5")).toBe(0);
  });

  it("会话游标携带分类与排序，收藏游标可补 favorite 分类", () => {
    expect(toSessionDirectoryCursor(
      { id: "s1", createdAt: 1, updatedAt: 2, title: "t", turnCount: 3 },
      "created_desc",
      "archived",
    )).toEqual({ category: "archived", sort: "created_desc", value: 1, createdAt: 1, id: "s1" });
    expect(toBackupMetadataCursor(
      { id: "b1", createdAt: 1, updatedAt: 2, title: "t", messageCount: 8 },
      "updated_desc",
    )).toEqual({ sort: "updated_desc", value: 2, createdAt: 1, id: "b1" });
  });
});
