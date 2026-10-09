import { beforeEach, describe, expect, it } from "vitest";
import {
  recordRuntimeError,
  resetRuntimeErrorLogForTest,
} from "../../src/utils/runtimeErrorLog";
import {
  collectThemeDiagnosticLines,
  compositeOver,
  contrastRatio,
  findViewportCoveringOverlays,
  parseCssColor,
  type RgbColor,
} from "../../src/tabs/settings/sections/system-report/themeDiagnostics";

const VIEWPORT = { width: 390, height: 844 };

const rgba = (value: string): RgbColor & { a: number } => {
  const parsed = parseCssColor(value);
  if (!parsed) throw new Error(`unparsable color: ${value}`);
  return parsed;
};

describe("CSS 颜色解析", () => {
  it("解析 rgb/rgba/hex/transparent", () => {
    expect(rgba("rgb(255, 255, 255)")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(rgba("rgba(0, 0, 0, 0.5)")).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(rgba("#abc")).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(rgba("#0d0f17ff")).toEqual({ r: 13, g: 15, b: 23, a: 1 });
    expect(rgba("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("解析 oklch/oklab/color(srgb)，覆盖 Tailwind v4 主题变量", () => {
    // 亮色主题的近白底色
    const light = rgba("oklch(0.985 0.005 240)");
    expect(light.r).toBeGreaterThan(240);
    expect(light.g).toBeGreaterThan(240);
    expect(light.b).toBeGreaterThan(240);

    // 暗色主题的极暗底色
    const dark = rgba("oklch(0.12 0.01 250)");
    expect(dark.r).toBeLessThan(40);
    expect(dark.g).toBeLessThan(40);
    expect(dark.b).toBeLessThan(40);

    // 带 alpha 的 oklch（color-mix 结果的常见序列化形态）
    expect(rgba("oklch(0.5 0 0 / 40%)").a).toBeCloseTo(0.4, 5);
    // Oklab L=0.5 的中灰约等于 sRGB 99/255
    expect(rgba("oklab(0.5 0 0)").r).toBeGreaterThan(90);
    expect(rgba("oklab(0.5 0 0)").r).toBeLessThan(110);
    expect(rgba("color(srgb 1 0 0)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it("无法解析的取值返回 null，而不是猜一个颜色", () => {
    expect(parseCssColor("")).toBeNull();
    expect(parseCssColor("var(--background)")).toBeNull();
    expect(parseCssColor("oklch()")).toBeNull();
  });
});

describe("对比度计算", () => {
  it("黑白对比度为 21:1，同色为 1:1", () => {
    expect(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 })).toBeCloseTo(21, 1);
    expect(contrastRatio({ r: 13, g: 15, b: 23 }, { r: 13, g: 15, b: 23 })).toBeCloseTo(1, 5);
  });

  it("半透明前景合成到不透明底色上", () => {
    expect(compositeOver({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0 })).toEqual({
      r: 128,
      g: 128,
      b: 128,
    });
  });
});

describe("全屏遮挡层扫描", () => {
  let overlay: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"><div id="app"></div></div>';
    overlay = document.createElement("div");
    overlay.className = "absolute inset-0 bg-black/60 z-50";
    overlay.style.position = "absolute";
    overlay.style.width = `${VIEWPORT.width}px`;
    overlay.style.height = `${VIEWPORT.height}px`;
    overlay.style.backgroundColor = "rgba(0, 0, 0, 0.6)";
    overlay.style.zIndex = "50";
  });

  it("识别覆盖视口且会拦截点击的浮层", () => {
    document.getElementById("root")!.appendChild(overlay);

    const found = findViewportCoveringOverlays(document, VIEWPORT);

    expect(found).toHaveLength(1);
    expect(found[0]).toContain("z-index:50");
    expect(found[0]).toContain("pointer-events:auto");
  });

  it("忽略装饰层（pointer-events:none）与不足视口尺寸的浮层", () => {
    overlay.style.pointerEvents = "none";
    document.getElementById("root")!.appendChild(overlay);

    const small = document.createElement("div");
    small.style.position = "absolute";
    small.style.width = "100px";
    small.style.height = "100px";
    document.getElementById("root")!.appendChild(small);

    expect(findViewportCoveringOverlays(document, VIEWPORT)).toHaveLength(0);
  });

  it("忽略隐藏页签（Keep-Alive 下 display:none）里的浮层", () => {
    const hiddenTabPanel = document.createElement("div");
    hiddenTabPanel.style.display = "none";
    document.getElementById("root")!.appendChild(hiddenTabPanel);
    hiddenTabPanel.appendChild(overlay);

    expect(findViewportCoveringOverlays(document, VIEWPORT)).toHaveLength(0);
  });

  it("识别 #root 之外 portal 到 body 的弹层遮罩（Dialog 位置所在）", () => {
    // Base UI 的 Dialog/Select 默认 portal 到 <body>，遮罩不在 #root 内。
    // 只扫 #root 会让"弹层遮罩压住整屏、点不动"在自检里隐形（历史盲区）。
    const portalOverlay = document.createElement("div");
    portalOverlay.setAttribute("data-slot", "dialog-overlay");
    portalOverlay.className = "fixed inset-0 z-50";
    portalOverlay.style.position = "fixed";
    portalOverlay.style.width = `${VIEWPORT.width}px`;
    portalOverlay.style.height = `${VIEWPORT.height}px`;
    portalOverlay.style.zIndex = "50";
    document.body.appendChild(portalOverlay);

    const found = findViewportCoveringOverlays(document, VIEWPORT);

    expect(found).toHaveLength(1);
    expect(found[0]).toContain("data-slot=dialog-overlay");
  });

  it("报告里带上 backdrop-filter，便于定位 WebView 合成异常", () => {
    overlay.style.backdropFilter = "blur(2px)";
    document.getElementById("root")!.appendChild(overlay);

    const found = findViewportCoveringOverlays(document, VIEWPORT);

    expect(found[0]).toContain("backdrop-filter:blur(2px)");
  });
});

describe("主题诊断输出", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"><div id="app"></div></div>';
    document.documentElement.setAttribute("data-theme", "snow");
    document.documentElement.style.setProperty("--background", "oklch(0.985 0.005 240)");
    document.documentElement.style.setProperty("--foreground", "oklch(0.18 0.015 240)");
  });

  it("报告主题属性、变量取值与生效对比度", () => {
    const container = document.getElementById("app")!;
    container.setAttribute(
      "style",
      "color: rgb(24, 28, 35); background-color: rgb(250, 251, 253); width: 390px; height: 844px;",
    );

    const lines = collectThemeDiagnosticLines(document, VIEWPORT);
    const text = lines.join("\n");

    expect(text).toContain("data-theme: snow");
    expect(text).toContain("--background: oklch(0.985 0.005 240)");
    expect(text).toContain("effective contrast:");
    expect(text).toMatch(/effective contrast: .* = 1[0-9]\.\d+:1 OK/);
    expect(text).toContain("viewport-covering overlays: 0");
  });

  it("文字与背景撞色时给出 ERROR", () => {
    const container = document.getElementById("app")!;
    container.setAttribute(
      "style",
      "color: rgb(18, 20, 26); background-color: rgb(22, 24, 30);",
    );

    const text = collectThemeDiagnosticLines(document, VIEWPORT).join("\n");

    expect(text).toContain("ERROR: text/background contrast far too low");
  });

  it("遮罩层存在时列入报告并标记 WARNING", () => {
    const overlay = document.createElement("div");
    overlay.className = "absolute inset-0 bg-black/60 z-50";
    overlay.style.position = "absolute";
    overlay.style.width = `${VIEWPORT.width}px`;
    overlay.style.height = `${VIEWPORT.height}px`;
    overlay.style.zIndex = "50";
    document.getElementById("root")!.appendChild(overlay);

    const text = collectThemeDiagnosticLines(document, VIEWPORT).join("\n");

    expect(text).toContain("viewport-covering overlays: 1");
    expect(text).toContain("WARNING: blocking overlay over viewport");
  });

  it("主题变量缺失时明确报错", () => {
    document.documentElement.style.removeProperty("--background");
    document.documentElement.style.removeProperty("--foreground");

    const text = collectThemeDiagnosticLines(document, VIEWPORT).join("\n");

    expect(text).toContain("--background: (empty)");
    expect(text).toContain("ERROR: theme CSS variables missing");
  });

  it("报告列出最近的运行期错误（渲染类故障往往只剩这一条线索）", () => {
    resetRuntimeErrorLogForTest();
    recordRuntimeError({ kind: "error", message: "compositor boom", source: "app.js:1", at: Date.now() });

    const text = collectThemeDiagnosticLines(document, VIEWPORT).join("\n");

    expect(text).toContain("recent runtime errors: 1");
    expect(text).toContain("WARNING: runtime error → ");
    expect(text).toContain("compositor boom");
    resetRuntimeErrorLogForTest();
  });
});
