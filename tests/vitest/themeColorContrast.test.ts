import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  parseCssColor,
  parseThemeColorValue,
  type RgbaColor,
} from "../../src/domain/themes/themeColor";
import { analyzeThemeContrast } from "../../src/domain/themes/themeContrast";

function rgba(value: string): RgbaColor {
  const parsed = parseThemeColorValue(value);
  if (!parsed) throw new Error(`unparsable color: ${value}`);
  return parsed;
}

describe("主题颜色解析", () => {
  it("解析 hsl()/hsla() 的现代与旧式写法", () => {
    expect(rgba("hsl(0 100% 50%)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(rgba("hsl(120deg 100% 25%)")).toEqual({ r: 0, g: 128, b: 0, a: 1 });
    expect(rgba("hsla(240, 100%, 50%, 0.5)")).toEqual({ r: 0, g: 0, b: 255, a: 0.5 });
    expect(rgba("hsl(0 100% 50% / 50%)").a).toBeCloseTo(0.5, 5);
  });

  it("解析裸 HSL 通道（主题文档推荐的写法）", () => {
    expect(rgba("0 100% 50%")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(rgba("0 100% 50% / 0.25").a).toBeCloseTo(0.25, 5);
    expect(rgba("268 90% 72%").b).toBeGreaterThan(rgba("268 90% 72%").r);
  });

  it("裸 HSL 只在明确匹配时解析，普通文本仍返回 null", () => {
    expect(parseThemeColorValue("var(--foreground)")).toBeNull();
    expect(parseThemeColorValue("268 90%")).toBeNull();
    expect(parseThemeColorValue("not a color")).toBeNull();
    expect(parseCssColor("hsl()")).toBeNull();
  });
});

describe("主题变量对比度", () => {
  const readableVariables = {
    "--background": "#000000",
    "--foreground": "#ffffff",
    "--card": "#111111",
    "--card-foreground": "#ffffff",
    "--popover": "#111111",
    "--popover-foreground": "#ffffff",
    "--primary": "#ffffff",
    "--primary-foreground": "#000000",
    "--secondary": "#222222",
    "--secondary-foreground": "#ffffff",
    "--muted": "#222222",
    "--muted-foreground": "#ffffff",
    "--accent": "#333333",
    "--accent-foreground": "#ffffff",
    "--destructive": "#990000",
    "--destructive-foreground": "#ffffff",
    "--border": "#888888",
    "--ring": "#888888",
    "--dialogue-color": "#ffffff",
    "--prose-color": "#ffffff",
  };

  it("黑白文本对为 21:1 并通过", () => {
    const checks = analyzeThemeContrast(readableVariables);
    const primary = checks.find(check => check.id === "foreground-background");
    expect(primary?.status).toBe("pass");
    expect(primary?.ratio).toBeCloseTo(21, 1);
  });

  it("低对比度标记为 fail，失败项排在前面", () => {
    const checks = analyzeThemeContrast({
      ...readableVariables,
      "--foreground": "#010101",
    });
    expect(checks[0].id).toBe("foreground-background");
    expect(checks[0].status).toBe("fail");
    expect(checks[0].ratio).toBeLessThan(4.5);
  });

  it("缺失变量返回 unresolved，而不是当作通过", () => {
    const checks = analyzeThemeContrast({
      "--background": "#000000",
      "--foreground": "#ffffff",
    });
    const card = checks.find(check => check.id === "card-foreground-card");
    expect(card?.status).toBe("unresolved");
    expect(card?.ratio).toBeNull();
  });

  it("裸 HSL 变量也能评估", () => {
    const checks = analyzeThemeContrast({
      ...readableVariables,
      "--background": "0 0% 0%",
      "--foreground": "0 0% 100%",
    });
    const primary = checks.find(check => check.id === "foreground-background");
    expect(primary?.status).toBe("pass");
    expect(primary?.ratio).toBeCloseTo(21, 1);
  });

  it("半透明前景先合成再计算，不会虚高", () => {
    const opaque = analyzeThemeContrast({
      ...readableVariables,
      "--foreground": "#ffffff",
    }).find(check => check.id === "foreground-background");
    const translucent = analyzeThemeContrast({
      ...readableVariables,
      "--foreground": "rgba(255, 255, 255, 0.5)",
    }).find(check => check.id === "foreground-background");
    expect(translucent?.ratio ?? 0).toBeLessThan(opaque?.ratio ?? 0);
  });

  it("对比度函数对同色返回 1", () => {
    expect(contrastRatio({ r: 10, g: 10, b: 10 }, { r: 10, g: 10, b: 10 })).toBeCloseTo(1, 5);
  });
});
