import { describe, expect, it } from "vitest";
import {
  isValidThemeMediaId,
  isValidThemeStateKey,
  parseThemeInteractionConfigDetailed,
  type ThemeInteractionConfig,
} from "../../src/domain/themes/themeInteractionContract";
import {
  createThemeMediaId,
  createThemeRuleId,
  createThemeStateKey,
  deriveThemeInteractionSchemaVersion,
  getDefaultThemeStateTokens,
  parseThemeInteractionSource,
  serializeThemeInteractionSource,
} from "../../src/domain/themes/themeInteractionDraft";

const CONFIG: ThemeInteractionConfig = {
  media: {
    rain: { type: "audio", src: "tavern-resource://r_rain", loop: true, volume: 0.35, preload: "metadata" },
    aurora: {
      type: "video",
      src: "tavern-resource://r_aurora",
      loop: true,
      volume: 1,
      muted: true,
      fit: "cover",
      preload: "metadata",
    },
  },
  state: {
    mood: { type: "enum", values: ["calm", "dream"], default: "calm" },
    alert: { type: "boolean", default: false },
    visits: { type: "counter", default: 0, min: 0, max: 99 },
  },
  interactions: [{
    id: "activate-ambient",
    when: { event: "theme.activate" },
    if: [],
    do: [
      { action: "media.play", target: "rain", delayMs: 0 },
      { action: "state.set", key: "mood", value: "dream", delayMs: 0 },
    ],
    cooldownMs: 100,
    once: false,
  }],
};

describe("主题交互草稿", () => {
  it("源字符串解析/序列化可往返", () => {
    const source = serializeThemeInteractionSource(CONFIG);
    const parsed = parseThemeInteractionSource(source);
    expect(parsed.success).toBe(true);
    expect(parsed.config).toEqual(CONFIG);
  });

  it("非法 JSON 与非法契约都返回可读错误", () => {
    expect(parseThemeInteractionSource("{")).toMatchObject({ success: false });
    expect(parseThemeInteractionSource(JSON.stringify({ media: {}, state: {}, interactions: [{ id: "x" }] })))
      .toMatchObject({ success: false });
  });

  it("schema 版本按媒体/状态/规则是否为空自动推导", () => {
    expect(deriveThemeInteractionSchemaVersion({ media: {}, state: {}, interactions: [] })).toBe("1.0");
    expect(deriveThemeInteractionSchemaVersion(CONFIG)).toBe("1.1");
  });

  it("生成的 ID/状态键合法且不重复", () => {
    const mediaId = createThemeMediaId(CONFIG);
    const stateKey = createThemeStateKey(CONFIG);
    const ruleId = createThemeRuleId(CONFIG);
    expect(isValidThemeMediaId(mediaId)).toBe(true);
    expect(isValidThemeStateKey(stateKey)).toBe(true);
    expect(isValidThemeMediaId(ruleId)).toBe(true);
    expect(mediaId).not.toBe("rain");
    expect(stateKey).not.toBe("mood");
    expect(ruleId).not.toBe("activate-ambient");
  });

  it("默认状态 token 与运行时口径一致", () => {
    expect(getDefaultThemeStateTokens(CONFIG)).toEqual(["alert-false", "mood-calm", "visits-0"]);
  });

  it("详细解析保留 issue.path，便于 UI 定位", () => {
    const detailed = parseThemeInteractionConfigDetailed({
      media: {},
      state: { enabled: { type: "boolean", default: false } },
      interactions: [{
        id: "bad",
        when: { event: "theme.activate" },
        do: [{ action: "state.increment", key: "enabled", amount: 1 }],
      }],
    });
    expect(detailed.success).toBe(false);
    expect(detailed.issues.some(issue => (
      issue.path.join(".") === "interactions.0.do.0.key"
    ))).toBe(true);
  });
});
