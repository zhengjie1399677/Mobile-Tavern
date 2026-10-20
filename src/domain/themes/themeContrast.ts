/**
 * 主题变量对比度分析。
 *
 * 只评估主题声明的语义变量，不分析任意自定义 CSS。前景/表面带 alpha 时先合成
 * 到实际底色再做 WCAG 计算；任何一侧缺失或无法解析都返回 `unresolved`，
 * 不能当作通过。
 */

import {
  compositeOver,
  contrastRatio,
  formatRgb,
  parseThemeColorValue,
  type RgbColor,
  type RgbaColor,
} from "./themeColor";

export type ThemeContrastStatus = "pass" | "fail" | "unresolved";
export type ThemeContrastKind = "text" | "ui";

export interface ThemeContrastCheck {
  id: string;
  kind: ThemeContrastKind;
  foregroundVariable: string;
  backgroundVariable: string;
  /** WCAG 阈值：正文 4.5，非文本 UI 3.0。 */
  threshold: number;
  ratio: number | null;
  status: ThemeContrastStatus;
  /** 解析并合成后的颜色；未解析时为 null。 */
  foregroundRgb: string | null;
  backgroundRgb: string | null;
}

interface ThemeContrastPair {
  id: string;
  kind: ThemeContrastKind;
  foreground: string;
  background: string;
  threshold: number;
}

const TEXT_THRESHOLD = 4.5;
const UI_THRESHOLD = 3;

const CONTRAST_PAIRS: readonly ThemeContrastPair[] = [
  { id: "foreground-background", kind: "text", foreground: "--foreground", background: "--background", threshold: TEXT_THRESHOLD },
  { id: "card-foreground-card", kind: "text", foreground: "--card-foreground", background: "--card", threshold: TEXT_THRESHOLD },
  { id: "popover-foreground-popover", kind: "text", foreground: "--popover-foreground", background: "--popover", threshold: TEXT_THRESHOLD },
  { id: "primary-foreground-primary", kind: "text", foreground: "--primary-foreground", background: "--primary", threshold: TEXT_THRESHOLD },
  { id: "secondary-foreground-secondary", kind: "text", foreground: "--secondary-foreground", background: "--secondary", threshold: TEXT_THRESHOLD },
  { id: "muted-foreground-muted", kind: "text", foreground: "--muted-foreground", background: "--muted", threshold: TEXT_THRESHOLD },
  { id: "accent-foreground-accent", kind: "text", foreground: "--accent-foreground", background: "--accent", threshold: TEXT_THRESHOLD },
  { id: "destructive-foreground-destructive", kind: "text", foreground: "--destructive-foreground", background: "--destructive", threshold: TEXT_THRESHOLD },
  { id: "dialogue-card", kind: "text", foreground: "--dialogue-color", background: "--card", threshold: TEXT_THRESHOLD },
  { id: "prose-card", kind: "text", foreground: "--prose-color", background: "--card", threshold: TEXT_THRESHOLD },
  { id: "primary-background", kind: "ui", foreground: "--primary", background: "--background", threshold: UI_THRESHOLD },
  { id: "border-background", kind: "ui", foreground: "--border", background: "--background", threshold: UI_THRESHOLD },
  { id: "ring-background", kind: "ui", foreground: "--ring", background: "--background", threshold: UI_THRESHOLD },
];

function readVariable(
  variables: Record<string, string>,
  name: string,
): RgbaColor | null {
  const value = variables[name];
  if (typeof value !== "string" || value.trim() === "") return null;
  return parseThemeColorValue(value);
}

/**
 * 把带 alpha 的表面合成到页面背景上。
 * 页面背景本身带 alpha 时使用黑色作为最终兜底，保证结果确定。
 */
function resolveSurface(
  surface: RgbaColor,
  pageBackground: RgbaColor | null,
): RgbColor {
  if (surface.a >= 1) return surface;
  const backdrop = pageBackground && pageBackground.a >= 1
    ? pageBackground
    : { r: 0, g: 0, b: 0 };
  return compositeOver(surface, backdrop);
}

function evaluatePair(
  pair: ThemeContrastPair,
  variables: Record<string, string>,
  pageBackground: RgbaColor | null,
): ThemeContrastCheck {
  const foreground = readVariable(variables, pair.foreground);
  const background = readVariable(variables, pair.background);
  if (!foreground || !background) {
    return {
      id: pair.id,
      kind: pair.kind,
      foregroundVariable: pair.foreground,
      backgroundVariable: pair.background,
      threshold: pair.threshold,
      ratio: null,
      status: "unresolved",
      foregroundRgb: foreground ? formatRgb(foreground) : null,
      backgroundRgb: background ? formatRgb(background) : null,
    };
  }

  const backgroundRgb = resolveSurface(background, pageBackground);
  const foregroundRgb = foreground.a >= 1
    ? foreground
    : compositeOver(foreground, backgroundRgb);
  const ratio = contrastRatio(foregroundRgb, backgroundRgb);
  return {
    id: pair.id,
    kind: pair.kind,
    foregroundVariable: pair.foreground,
    backgroundVariable: pair.background,
    threshold: pair.threshold,
    ratio,
    status: ratio >= pair.threshold ? "pass" : "fail",
    foregroundRgb: formatRgb(foregroundRgb),
    backgroundRgb: formatRgb(backgroundRgb),
  };
}

/** 评估全部内置变量配对；失败项排在前面，便于 UI 直接展示。 */
export function analyzeThemeContrast(
  variables: Record<string, string>,
): ThemeContrastCheck[] {
  const pageBackground = readVariable(variables, "--background");
  const checks = CONTRAST_PAIRS.map(pair => evaluatePair(pair, variables, pageBackground));
  const order: Record<ThemeContrastStatus, number> = { fail: 0, unresolved: 1, pass: 2 };
  return checks.sort((left, right) => order[left.status] - order[right.status]);
}
