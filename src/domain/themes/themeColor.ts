/**
 * 主题颜色解析与 WCAG 对比度计算。
 *
 * 主题变量既可能是 `#rrggbb`、`rgb()`、`oklch()`，也可能是文档推荐的
 * 裸 HSL 通道写法 `"268 90% 72%"`。系统报告与主题工作室必须使用同一套
 * 解析口径，否则会出现“报告说看不清、编辑器却显示正常”的分裂。
 */

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface RgbaColor extends RgbColor {
  a: number;
}

const LEGACY_RGB_PATTERN =
  /^rgba?\(\s*([\d.]+%?)[,\s]+([\d.]+%?)[,\s]+([\d.]+%?)(?:[,\s/]+([\d.]+%?))?\s*\)$/i;
const HSL_PATTERN =
  /^hsla?\(\s*([\d.+-]+(?:deg|turn|rad|grad)?)\s*[,\s]+\s*([\d.]+)%\s*[,\s]+\s*([\d.]+)%\s*(?:[,\/]\s*([\d.]+%?))?\s*\)$/i;
const BARE_HSL_PATTERN =
  /^([\d.+-]+(?:deg|turn|rad|grad)?)\s+([\d.]+)%\s+([\d.]+)%\s*(?:\/\s*([\d.]+%?))?$/i;
const OKLCH_PATTERN = /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.-]+)(?:deg)?\s*(?:\/\s*([\d.]+%?))?\s*\)$/i;
const OKLAB_PATTERN = /^oklab\(\s*([\d.]+%?)\s+([\d.-]+)\s+([\d.-]+)\s*(?:\/\s*([\d.]+%?))?\s*\)$/i;
const COLOR_SRGB_PATTERN = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?))?\s*\)$/i;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** 解析 `rgb()/rgba()` 或百分比写法；通道值统一归一到 0~255。 */
const parseChannel = (raw: string, scale = 255): number | null => {
  const trimmed = raw.trim();
  if (trimmed.endsWith("%")) {
    const percent = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(percent) ? (percent / 100) * scale : null;
  }
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) ? value : null;
};

const parseAlpha = (raw: string | undefined): number => {
  if (raw == null) return 1;
  const trimmed = raw.trim();
  if (trimmed.endsWith("%")) {
    const percent = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(percent) ? clamp01(percent / 100) : 1;
  }
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) ? clamp01(value) : 1;
};

/** 解析 HSL 色相，支持 deg（默认）/turn/rad/grad。 */
const parseHue = (raw: string): number | null => {
  const match = raw.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+))(deg|turn|rad|grad)?$/i);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = (match[2] ?? "deg").toLowerCase();
  const degrees = unit === "turn"
    ? value * 360
    : unit === "rad"
      ? (value * 180) / Math.PI
      : unit === "grad"
        ? value * 0.9
        : value;
  return ((degrees % 360) + 360) % 360;
};

/** 解析 HSL 的饱和度/亮度百分比，返回 0~1。 */
const parsePercent01 = (raw: string): number | null => {
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? clamp01(value / 100) : null;
};

/** HSL → gamma 编码 sRGB（0~255）。 */
const hslToRgb = (hue: number, saturation: number, lightness: number): RgbColor => {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = hue / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;
  if (sector < 1) [red, green, blue] = [chroma, second, 0];
  else if (sector < 2) [red, green, blue] = [second, chroma, 0];
  else if (sector < 3) [red, green, blue] = [0, chroma, second];
  else if (sector < 4) [red, green, blue] = [0, second, chroma];
  else if (sector < 5) [red, green, blue] = [second, 0, chroma];
  else [red, green, blue] = [chroma, 0, second];
  const match = lightness - chroma / 2;
  return {
    r: Math.round((red + match) * 255),
    g: Math.round((green + match) * 255),
    b: Math.round((blue + match) * 255),
  };
};

/** 线性 sRGB → gamma 编码 sRGB（0~1）。 */
const linearToSrgb = (value: number): number => {
  const clamped = clamp01(value);
  return clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
};

/** Oklab → gamma 编码 sRGB（0~255），越界通道按 sRGB 色域裁剪。 */
const oklabToRgb = (l: number, a: number, b: number): RgbColor => {
  const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = l - 0.0894841775 * a - 1.291485548 * b;

  const lCube = lPrime ** 3;
  const mCube = mPrime ** 3;
  const sCube = sPrime ** 3;

  const rLinear = 4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube;
  const gLinear = -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube;
  const bLinear = -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube;

  return {
    r: Math.round(linearToSrgb(rLinear) * 255),
    g: Math.round(linearToSrgb(gLinear) * 255),
    b: Math.round(linearToSrgb(bLinear) * 255),
  };
};

/**
 * 把一段 CSS 颜色解析成 sRGB 通道。
 *
 * 覆盖 `#rgb/#rrggbb/#rrggbbaa`、`rgb()/rgba()`、`hsl()/hsla()`、
 * `oklch()`、`oklab()`、`color(srgb …)` 与 `transparent`。
 * 解析失败返回 `null`。
 */
export function parseCssColor(value: string): RgbaColor | null {
  const text = value.trim();
  if (!text) return null;

  if (text.toLowerCase() === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  const hex = text.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hex) {
    const expand = (chunk: string): number => Number.parseInt(chunk, 16);
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a] = hex.split("").map(expand);
      return {
        r: r * 17,
        g: g * 17,
        b: b * 17,
        a: a === undefined ? 1 : a / 15,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = expand(hex.slice(0, 2));
      const g = expand(hex.slice(2, 4));
      const b = expand(hex.slice(4, 6));
      const a = hex.length === 8 ? expand(hex.slice(6, 8)) / 255 : 1;
      return { r, g, b, a };
    }
    return null;
  }

  const legacy = text.match(LEGACY_RGB_PATTERN);
  if (legacy) {
    const r = parseChannel(legacy[1]);
    const g = parseChannel(legacy[2]);
    const b = parseChannel(legacy[3]);
    if (r == null || g == null || b == null) return null;
    return { r, g, b, a: parseAlpha(legacy[4]) };
  }

  const hsl = text.match(HSL_PATTERN);
  if (hsl) {
    const hue = parseHue(hsl[1]);
    const saturation = parsePercent01(hsl[2]);
    const lightness = parsePercent01(hsl[3]);
    if (hue == null || saturation == null || lightness == null) return null;
    return { ...hslToRgb(hue, saturation, lightness), a: parseAlpha(hsl[4]) };
  }

  const oklch = text.match(OKLCH_PATTERN);
  if (oklch) {
    const lightnessRaw = oklch[1];
    const chromaRaw = oklch[2];
    const hue = Number.parseFloat(oklch[3]);
    const lightness = lightnessRaw.endsWith("%")
      ? Number.parseFloat(lightnessRaw.slice(0, -1)) / 100
      : Number.parseFloat(lightnessRaw);
    const chroma = chromaRaw.endsWith("%")
      ? (Number.parseFloat(chromaRaw.slice(0, -1)) / 100) * 0.4
      : Number.parseFloat(chromaRaw);
    if (!Number.isFinite(lightness) || !Number.isFinite(chroma) || !Number.isFinite(hue)) {
      return null;
    }
    const hueRadians = (hue * Math.PI) / 180;
    const rgb = oklabToRgb(
      lightness,
      chroma * Math.cos(hueRadians),
      chroma * Math.sin(hueRadians),
    );
    return { ...rgb, a: parseAlpha(oklch[4]) };
  }

  const oklab = text.match(OKLAB_PATTERN);
  if (oklab) {
    const lightnessRaw = oklab[1];
    const lightness = lightnessRaw.endsWith("%")
      ? Number.parseFloat(lightnessRaw.slice(0, -1)) / 100
      : Number.parseFloat(lightnessRaw);
    const a = Number.parseFloat(oklab[2]);
    const b = Number.parseFloat(oklab[3]);
    if (!Number.isFinite(lightness) || !Number.isFinite(a) || !Number.isFinite(b)) {
      return null;
    }
    return { ...oklabToRgb(lightness, a, b), a: parseAlpha(oklab[4]) };
  }

  const colorSrgb = text.match(COLOR_SRGB_PATTERN);
  if (colorSrgb) {
    const r = Number.parseFloat(colorSrgb[1]);
    const g = Number.parseFloat(colorSrgb[2]);
    const b = Number.parseFloat(colorSrgb[3]);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
    return {
      r: Math.round(clamp01(r) * 255),
      g: Math.round(clamp01(g) * 255),
      b: Math.round(clamp01(b) * 255),
      a: parseAlpha(colorSrgb[4]),
    };
  }

  return null;
}

/**
 * 解析主题变量值：先按标准 CSS 颜色，再按文档推荐的裸 HSL 通道
 * （`"268 90% 72%"`、`"268 90% 72% / 0.5"`）。
 */
export function parseThemeColorValue(value: string): RgbaColor | null {
  const direct = parseCssColor(value);
  if (direct) return direct;
  const bare = value.trim().match(BARE_HSL_PATTERN);
  if (!bare) return null;
  const hue = parseHue(bare[1]);
  const saturation = parsePercent01(bare[2]);
  const lightness = parsePercent01(bare[3]);
  if (hue == null || saturation == null || lightness == null) return null;
  return { ...hslToRgb(hue, saturation, lightness), a: parseAlpha(bare[4]) };
}

/** WCAG 相对亮度（输入为 sRGB 通道）。 */
export function relativeLuminance(color: RgbColor): number {
  const channel = (value: number): number => {
    const normalized = clamp01(value / 255);
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** WCAG 对比度（1~21）。 */
export function contrastRatio(foreground: RgbColor, background: RgbColor): number {
  const light = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const dark = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (light + 0.05) / (dark + 0.05);
}

/** 把半透明前景合成到不透明底色上。 */
export function compositeOver(foreground: RgbaColor, background: RgbColor): RgbColor {
  const alpha = clamp01(foreground.a);
  return {
    r: Math.round(foreground.r * alpha + background.r * (1 - alpha)),
    g: Math.round(foreground.g * alpha + background.g * (1 - alpha)),
    b: Math.round(foreground.b * alpha + background.b * (1 - alpha)),
  };
}

/** `rgb(1, 2, 3)` 形式，便于把解析结果写进报告或色块。 */
export function formatRgb(color: RgbColor): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}
