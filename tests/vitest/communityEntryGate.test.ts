import { describe, expect, it } from "vitest";
import {
  COMMUNITY_MIN_INSTALL_AGE_MS,
  COMMUNITY_MIN_USAGE_SECONDS,
  deriveFirstOpenedAt,
  meetsCommunityEntryThreshold,
} from "../../src/domain/community/entryGate";

const NOW = Date.parse("2026-07-29T12:00:00");

describe("社区入口灰度门槛", () => {
  it("默认对没有统计数据的安装隐藏", () => {
    expect(meetsCommunityEntryThreshold(null, NOW)).toBe(false);
  });

  it("安装时间达到三天时显示", () => {
    expect(
      meetsCommunityEntryThreshold(
        {
          firstOpenedAt: NOW - COMMUNITY_MIN_INSTALL_AGE_MS,
          totalUsageSeconds: 0,
        },
        NOW,
      ),
    ).toBe(true);
  });

  it("累计运行达到三小时时显示", () => {
    expect(
      meetsCommunityEntryThreshold(
        {
          firstOpenedAt: NOW,
          totalUsageSeconds: COMMUNITY_MIN_USAGE_SECONDS,
        },
        NOW,
      ),
    ).toBe(true);
  });

  it("两个门槛均未达到时隐藏", () => {
    expect(
      meetsCommunityEntryThreshold(
        {
          firstOpenedAt: NOW - COMMUNITY_MIN_INSTALL_AGE_MS + 1,
          totalUsageSeconds: COMMUNITY_MIN_USAGE_SECONDS - 1,
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("旧统计从最早的每日历史推导首次使用时间", () => {
    expect(
      deriveFirstOpenedAt(
        {
          history: [
            { date: "2026-07-28", seconds: 60 },
            { date: "2026-07-25", seconds: 60 },
          ],
        },
        NOW,
      ),
    ).toBe(Date.parse("2026-07-25T00:00:00"));
  });
});
