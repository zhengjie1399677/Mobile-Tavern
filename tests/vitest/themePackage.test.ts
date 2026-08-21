import { afterEach, describe, expect, it } from "vitest";
import {
  applyThemePackage,
  buildThemeCss,
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
});
