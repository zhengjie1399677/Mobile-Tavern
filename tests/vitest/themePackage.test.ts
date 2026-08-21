import { afterEach, describe, expect, it } from "vitest";
import {
  applyThemePackage,
  buildThemeCss,
  detectCriticalNavigationHiding,
  setActiveThemePackageStyles,
  type CustomThemePackage,
  validateThemePackage,
} from "../../src/utils/themePackage";

function createTheme(id: string, customCss: string): CustomThemePackage {
  return {
    schemaVersion: "1.0",
    name: id,
    version: "1.0.0",
    isDark: true,
    id,
    variables: { "--primary": "#8b5cf6" },
    customCss,
  };
}

describe("自定义主题样式隔离", () => {
  afterEach(() => {
    document.querySelectorAll("style[data-tavern-theme]").forEach(style => style.remove());
    document.documentElement.removeAttribute("data-theme");
  });

  it("只启用当前主题的 style，隔离关键帧等全局声明", () => {
    document.documentElement.setAttribute("data-theme", "custom_alpha");
    applyThemePackage(createTheme("custom_alpha", "@keyframes glow { from { opacity: 0 } to { opacity: 1 } }"));
    applyThemePackage(createTheme("custom_beta", "@keyframes glow { from { opacity: 1 } to { opacity: 0 } }"));

    const alpha = document.querySelector<HTMLStyleElement>('style[data-tavern-theme="custom_alpha"]');
    const beta = document.querySelector<HTMLStyleElement>('style[data-tavern-theme="custom_beta"]');

    expect(alpha?.disabled).toBe(false);
    expect(beta?.disabled).toBe(true);

    setActiveThemePackageStyles("custom_beta");

    expect(alpha?.disabled).toBe(true);
    expect(beta?.disabled).toBe(false);
  });

  it("切回内置主题时禁用全部自定义主题样式", () => {
    document.documentElement.setAttribute("data-theme", "custom_alpha");
    applyThemePackage(createTheme("custom_alpha", ".card { opacity: .9; }"));

    setActiveThemePackageStyles("ocean");

    const alpha = document.querySelector<HTMLStyleElement>('style[data-tavern-theme="custom_alpha"]');
    expect(alpha?.disabled).toBe(true);
  });

  it("主题变量不能绕过 customCss 的远程资源限制", () => {
    const unsafeTheme = createTheme("custom_remote", "");
    unsafeTheme.variables["--background"] = "url(https://example.com/tracker.png)";

    expect(validateThemePackage(unsafeTheme).valid).toBe(false);
    expect(buildThemeCss(unsafeTheme)).not.toContain("example.com");
  });

  it("检测明显隐藏关键导航的主题 CSS", () => {
    const risks = detectCriticalNavigationHiding(`
      [data-ui="main-tab-bar"] { display: none; }
      [data-ui = "main-tab"][data-tab-id = "characters"] { visibility: hidden !important; }
      [data-ui="main-tab"][data-tab-id="community"] { display: none; }
    `);

    expect(risks).toEqual(["整条主导航", "关键入口 characters"]);
    expect(detectCriticalNavigationHiding('[data-ui="main-tab-bar"] .label { display: none; }')).toEqual([]);
  });

  it("兼容 1.0，并校验与保留 1.1 受限交互", () => {
    const interactiveTheme: CustomThemePackage = {
      ...createTheme("custom_interactive", ""),
      schemaVersion: "1.1",
      media: {
        rain: { type: "audio", src: "tavern-resource://r_rain", loop: true, volume: 0.4, preload: "metadata" },
      },
      state: {
        active: { type: "boolean", default: false },
      },
      interactions: [{
        id: "activate",
        when: { event: "theme.activate" },
        if: [],
        do: [{ action: "media.play", target: "rain", delayMs: 0 }],
        cooldownMs: 100,
        once: false,
      }],
    };

    const result = validateThemePackage(interactiveTheme);
    expect(result.valid).toBe(true);
    expect(result.sanitized?.schemaVersion).toBe("1.1");
    expect(result.sanitized?.interactions).toHaveLength(1);
    expect(validateThemePackage(createTheme("custom_legacy", "")).valid).toBe(true);
  });

  it("拒绝 1.0 偷带交互字段", () => {
    const invalid = { ...createTheme("custom_invalid", ""), media: {} };
    expect(validateThemePackage(invalid).errors.join("\n")).toContain("schemaVersion 1.1");
  });
});
