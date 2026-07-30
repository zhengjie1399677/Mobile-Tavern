import { describe, expect, it } from "vitest";
import {
  COMMUNITY_MIN_INSTALL_AGE_MS,
  COMMUNITY_MIN_USAGE_SECONDS,
  deriveFirstOpenedAt,
  meetsCommunityEntryThreshold,
} from "../../src/domain/community/entryGate";

const NOW = Date.parse("2026-07-29T12:00:00");

describe("社区入口开发构建门槛", () => {
  it("默认对没有统计数据的安装隐藏", () => {
    expect(meetsCommunityEntryThreshold(null, NOW)).toBe(false);
  });

  it("开发构建将两个时间门槛配置为零", () => {
    expect(COMMUNITY_MIN_INSTALL_AGE_MS).toBe(0);
    expect(COMMUNITY_MIN_USAGE_SECONDS).toBe(0);
    expect(
      meetsCommunityEntryThreshold(
        {
          firstOpenedAt: NOW,
          totalUsageSeconds: 0,
        },
        NOW,
      ),
    ).toBe(true);
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
