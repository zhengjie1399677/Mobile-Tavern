import { describe, expect, it } from "vitest";
import { parseThemeInteractionConfig } from "../../src/domain/themes/themeInteractionContract";

describe("主题交互 1.1 契约", () => {
  it("接受媒体、有限状态与白名单动作", () => {
    const result = parseThemeInteractionConfig({
      media: {
        rain: { type: "audio", src: "tavern-resource://r_rain", loop: true, volume: 0.35 },
        aurora: { type: "video", src: "tavern-resource://r_aurora", loop: true, muted: true, fit: "cover" },
      },
      state: {
        mood: { type: "enum", values: ["calm", "dream"], default: "calm" },
      },
      interactions: [{
        id: "activate-ambient",
        when: { event: "theme.activate" },
        do: [
          { action: "media.play", target: "rain" },
          { action: "surface.show", target: "main.background", mediaId: "aurora" },
          { action: "state.set", key: "mood", value: "dream" },
          { action: "theme.state.add", value: "ambient-active" },
        ],
      }],
    });

    expect(result.success).toBe(true);
    expect(result.config?.interactions).toHaveLength(1);
  });

  it("拒绝未声明资源、类型不匹配和越界动作", () => {
    const result = parseThemeInteractionConfig({
      media: {
        song: { type: "audio", src: "https://example.com/song.mp3" },
      },
      state: {
        enabled: { type: "boolean", default: false },
      },
      interactions: [{
        id: "unsafe",
        when: { event: "ui.tap", target: "main-tab" },
        do: [
          { action: "surface.show", target: "main.background", mediaId: "song" },
          { action: "state.increment", key: "enabled", amount: 1 },
        ],
        if: [{ condition: "state.equals", key: "enabled", value: "yes" }],
      }],
    });

    expect(result.success).toBe(false);
    const errors = result.errors.join("\n");
    expect(errors).toContain("本地资源");
    expect(errors).toContain("视频");
    expect(errors).toContain("计数器");
    expect(errors).toContain("条件值");
  });

  it("限制规则数、动作数和延迟时间", () => {
    const interactions = Array.from({ length: 101 }, (_, index) => ({
      id: `rule-${index}`,
      when: { event: "theme.activate" },
      do: [{ action: "theme.state.add", value: "active", delayMs: 60_001 }],
    }));

    const result = parseThemeInteractionConfig({ interactions });

    expect(result.success).toBe(false);
    expect(result.errors.join("\n")).toMatch(/100|60000/);
  });
});
