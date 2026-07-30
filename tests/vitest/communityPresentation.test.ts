import { describe, expect, it } from "vitest";
import { formatCommunityTimestamp } from "../../src/domain/community/presentation";

describe("角色卡社区展示", () => {
  it("兼容服务端秒时间戳与客户端毫秒时间戳", () => {
    const seconds = 1_754_006_400;
    const milliseconds = seconds * 1000;

    expect(formatCommunityTimestamp(seconds, "zh-CN")).toBe(
      formatCommunityTimestamp(milliseconds, "zh-CN"),
    );
  });

  it("按照当前界面语言格式化日期", () => {
    const timestamp = Date.UTC(2025, 7, 1);

    expect(formatCommunityTimestamp(timestamp, "en")).toContain("2025");
    expect(formatCommunityTimestamp(timestamp, "zh-CN")).toContain("2025");
  });
});
