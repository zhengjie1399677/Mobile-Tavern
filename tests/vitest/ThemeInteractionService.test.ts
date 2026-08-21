import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeInteractionService } from "../../src/application/services/ThemeInteractionService";
import type { IKernel } from "../../src/application/serviceContracts";
import type { ThemeInteractionConfig } from "../../src/domain/themes/themeInteractionContract";

const config: ThemeInteractionConfig = {
  media: {
    rain: { type: "audio", src: "tavern-resource://r_rain", loop: true, volume: 0.35, preload: "metadata" },
    aurora: { type: "video", src: "tavern-resource://r_aurora", loop: true, volume: 1, muted: true, fit: "cover", preload: "metadata" },
  },
  state: {
    mood: { type: "enum", values: ["calm", "dream"], default: "calm" },
    pulses: { type: "counter", default: 0, min: 0, max: 2 },
  },
  interactions: [
    {
      id: "activate",
      when: { event: "theme.activate" },
      if: [],
      do: [
        { action: "media.play", target: "rain", delayMs: 0 },
        { action: "surface.show", target: "main.background", mediaId: "aurora", delayMs: 0 },
        { action: "media.setMuted", target: "aurora", muted: false, delayMs: 0 },
        { action: "state.set", key: "mood", value: "dream", delayMs: 0 },
        { action: "theme.state.add", value: "ambient-active", delayMs: 0 },
      ],
      cooldownMs: 100,
      once: false,
    },
    {
      id: "landscape-character",
      when: { event: "tab.enter", tabId: "characters" },
      if: [
        { condition: "orientation.is", value: "landscape" },
        { condition: "media.enabled", value: true },
      ],
      do: [{ action: "state.increment", key: "pulses", amount: 1, delayMs: 0 }],
      cooldownMs: 100,
      once: false,
    },
    {
      id: "delayed",
      when: { event: "ui.tap", target: "main-tab" },
      if: [],
      do: [{ action: "theme.state.add", value: "late", delayMs: 500 }],
      cooldownMs: 100,
      once: true,
    },
  ],
};

describe("ThemeInteractionService", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("激活主题后编排媒体、Surface 和主题自身状态", async () => {
    const service = new ThemeInteractionService();
    await service.init({} as IKernel);
    service.setEnvironment({ mediaEnabled: true, orientation: "portrait", activeTab: "characters", appVisible: true, reducedMotion: false });

    service.activateTheme("custom_test", config);

    const snapshot = service.getSnapshot();
    expect(snapshot.media.rain.status).toBe("playing");
    expect(snapshot.media.aurora.muted).toBe(false);
    expect(snapshot.surfaces["main.background"]).toEqual({ visible: true, mediaId: "aurora" });
    expect(snapshot.state.mood).toBe("dream");
    expect(snapshot.styleStates).toContain("ambient-active");
    expect(snapshot.styleStates).toContain("mood-dream");
  });

  it("只在条件满足时执行规则，并把计数器限制在声明范围", async () => {
    const service = new ThemeInteractionService();
    await service.init({} as IKernel);
    service.setEnvironment({ mediaEnabled: true, orientation: "portrait", activeTab: "characters", appVisible: true, reducedMotion: false });
    service.activateTheme("custom_test", config);

    service.dispatch({ type: "tab.enter", tabId: "characters" });
    expect(service.getSnapshot().state.pulses).toBe(0);

    service.setEnvironment({ orientation: "landscape" });
    vi.advanceTimersByTime(101);
    service.dispatch({ type: "tab.enter", tabId: "characters" });
    vi.advanceTimersByTime(101);
    service.dispatch({ type: "tab.enter", tabId: "characters" });
    vi.advanceTimersByTime(101);
    service.dispatch({ type: "tab.enter", tabId: "characters" });
    expect(service.getSnapshot().state.pulses).toBe(2);
  });

  it("停用主题会取消延迟动作并清理全部运行态", async () => {
    const service = new ThemeInteractionService();
    await service.init({} as IKernel);
    service.activateTheme("custom_test", config);
    service.dispatch({ type: "ui.tap", target: "main-tab" });

    service.deactivateTheme();
    vi.advanceTimersByTime(1000);

    const snapshot = service.getSnapshot();
    expect(snapshot.themeId).toBeNull();
    expect(snapshot.styleStates).toEqual([]);
    expect(snapshot.media).toEqual({});
    expect(snapshot.surfaces).toEqual({});
  });
});
