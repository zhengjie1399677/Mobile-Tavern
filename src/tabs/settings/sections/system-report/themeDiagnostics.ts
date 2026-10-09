/**
 * 主题与全屏遮挡层的现场诊断（系统报告 `14. THEME / OVERLAY`）。
 *
 * 用户反馈"整个界面看不清 / 点不动"时，现场成因通常只有两类：
 *
 * 1. 主题变量（`--background` / `--foreground` / `--card` …）没解析、或彼此不匹配，
 *    于是文字与背景撞色——图片、emoji、主色控件照常显示，只有文字"消失"；
 * 2. 有一层覆盖视口的浮层（对话框底幕、写入遮罩等）压在最上面：既压暗内容
 *    （常带 `backdrop-filter`，会把小字糊掉），又吞掉所有点击。
 *
 * 因此这里把"当前主题的实际取值 + 实际生效的文字/背景与对比度"和
 * "当前覆盖视口的浮层清单"一次性采集出来，让报告本身就能区分这两类原因，
 * 不必再靠截图反推。诊断只读 DOM，不触碰存储，也不需要 Kernel 服务。
 */

import { formatRuntimeErrorEntry, getRecentRuntimeErrors } from "../../../../utils/runtimeErrorLog";

export interface ViewportSizeLike {
  width: number;
  height: number;
}

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface RgbaColor extends RgbColor {
  a: number;
}

/** 覆盖视口的判定阈值：宽和高都要达到视口的 90%。 */
const VIEWPORT_COVERAGE_RATIO = 0.9;

/** 报告里最多列出的运行期错误条数（黑匣子本身保留更多）。 */
const MAX_REPORTED_RUNTIME_ERRORS = 5;
/** 透明度低于该值的浮层视为不可见，不计入遮挡。 */
const MIN_VISIBLE_OVERLAY_OPACITY = 0.05;
/** 报告中单次最多列出的浮层数量，避免刷屏。 */
const MAX_REPORTED_OVERLAYS = 5;
/** 报告中列出的 class 数量上限。 */
const MAX_REPORTED_CLASSES = 6;
/** 对比度低于该值即认为"看不清"（正文 WCAG AA 为 4.5:1）。 */
const LOW_CONTRAST_ERROR_RATIO = 2.5;
const LOW_CONTRAST_WARNING_RATIO = 4.5;

const THEME_VARIABLES = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--border",
] as const;

const LEGACY_RGB_PATTERN =
  /^rgba?\(\s*([\d.]+%?)[,\s]+([\d.]+%?)[,\s]+([\d.]+%?)(?:[,\s/]+([\d.]+%?))?\s*\)$/i;
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
 * 只覆盖本项目实际会用到的写法：`rgb()/rgba()`、`#rgb/#rrggbb/#rrggbbaa`、
 * `oklch()`、`oklab()`、`color(srgb …)`。现代 Chromium 的 `getComputedStyle` 对
 * oklch 主题变量会原样回显 `oklch(...)`，所以这里必须能算，不能只认 rgb。
 * 解析失败返回 `null`，调用方在报告里保留原字符串并注明"未解析"。
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

/** `rgb(1, 2, 3)` 形式，便于把解析结果写进报告。 */
export function formatRgb(color: RgbColor): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

/** 元素盒尺寸：优先用真实布局，测试环境（无布局引擎）退化为计算样式的 px 值。 */
const resolveElementBox = (
  element: Element,
  computed: CSSStyleDeclaration,
): { width: number; height: number } => {
  let rectWidth = 0;
  let rectHeight = 0;
  try {
    const rect = element.getBoundingClientRect();
    rectWidth = rect.width;
    rectHeight = rect.height;
  } catch {
    // 极少数宿主环境没有布局 API，走计算样式兜底。
  }

  const computedWidth = Number.parseFloat(computed.width);
  const computedHeight = Number.parseFloat(computed.height);
  return {
    width: rectWidth > 0 ? rectWidth : Number.isFinite(computedWidth) ? computedWidth : 0,
    height: rectHeight > 0 ? rectHeight : Number.isFinite(computedHeight) ? computedHeight : 0,
  };
};

const describeElement = (element: Element): string => {
  const classes = Array.from(element.classList).slice(0, MAX_REPORTED_CLASSES);
  const suffix = element.classList.length > classes.length ? ".…" : "";
  // `data-slot` 是项目 UI 基元（Base UI / shadcn 风格）的自述标识，能直接把
  // "哪个弹层压住了屏幕"讲清楚，比一长串 Tailwind 类名更好用。
  const slot = element.getAttribute("data-slot");
  const slotLabel = slot ? `[data-slot=${slot}]` : "";
  return `${element.tagName.toLowerCase()}${slotLabel}${classes.map((name) => `.${name}`).join("")}${suffix}`;
};

/**
 * 判断元素当前是否真的可见。
 *
 * 主 Tab 是 Keep-Alive 的：非当前页签整体 `display: none`，但子节点自己的
 * 计算样式仍是 `display: block`。因此除了元素自身的样式，还必须往上检查祖先，
 * 否则会把隐藏页签里的浮层误报成"正在遮挡屏幕"。
 */
const isElementVisible = (element: Element, view: Window, scope: Element): boolean => {
  const withVisibilityCheck = element as Element & { checkVisibility?: () => boolean };
  if (typeof withVisibilityCheck.checkVisibility === "function") {
    try {
      if (!withVisibilityCheck.checkVisibility()) return false;
    } catch {
      // 个别宿主实现会抛错，退回祖先 display/visibility 检查。
    }
  }

  let node: Element | null = element;
  while (node) {
    let style: CSSStyleDeclaration;
    try {
      style = view.getComputedStyle(node);
    } catch {
      return false;
    }
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (node === scope) break;
    node = node.parentElement;
  }
  return true;
};

/**
 * 列出当前覆盖视口、且会拦截点击的浮层。
 *
 * 排除 `pointer-events: none`（纯装饰层，例如全局环境光晕）、不可见元素，
 * 以及宽或高不足视口 90% 的条状/卡片式浮层。
 *
 * 扫描面是 `document.body` 而不是 `#root`：Base UI 的 Dialog/Select 弹层默认
 * portal 到 `<body>`（库注释明示），对话框遮罩（`fixed inset-0 bg-black/75`）因此
 * 落在 `#root` 之外——只扫 `#root` 会让"弹层遮罩压住整屏、点不动"在自检里隐形。
 */
export function findViewportCoveringOverlays(
  doc: Document,
  viewport: ViewportSizeLike,
): string[] {
  const view = doc.defaultView;
  if (!view || viewport.width <= 0 || viewport.height <= 0) return [];

  const scope = doc.body ?? doc.documentElement;
  if (!scope) return [];

  const found: { description: string; zIndex: number }[] = [];
  const elements = [scope, ...Array.from(scope.querySelectorAll("*"))];

  for (const element of elements) {
    if (!isElementVisible(element, view, scope)) continue;

    let computed: CSSStyleDeclaration;
    try {
      computed = view.getComputedStyle(element);
    } catch {
      continue;
    }

    const position = computed.position;
    if (position !== "fixed" && position !== "absolute") continue;
    if (computed.display === "none" || computed.visibility === "hidden") continue;
    if (computed.pointerEvents === "none") continue;

    const opacity = Number.parseFloat(computed.opacity);
    if (Number.isFinite(opacity) && opacity < MIN_VISIBLE_OVERLAY_OPACITY) continue;

    const box = resolveElementBox(element, computed);
    if (
      box.width < viewport.width * VIEWPORT_COVERAGE_RATIO ||
      box.height < viewport.height * VIEWPORT_COVERAGE_RATIO
    ) {
      continue;
    }

    const zIndex = Number.parseInt(computed.zIndex, 10);
    const resolvedZIndex = Number.isFinite(zIndex) ? zIndex : 0;
    const backdropFilter = computed.backdropFilter || computed.getPropertyValue("-webkit-backdrop-filter");
    const backdropHint = backdropFilter && backdropFilter !== "none"
      ? ` backdrop-filter:${backdropFilter}`
      : "";
    found.push({
      description: `${describeElement(element)} [position:${position} z-index:${
        Number.isFinite(zIndex) ? zIndex : "auto"
      } opacity:${Number.isFinite(opacity) ? opacity : 1} pointer-events:${
        computed.pointerEvents || "auto"
      }${backdropHint}]`,
      zIndex: resolvedZIndex,
    });
  }

  return found
    .sort((left, right) => right.zIndex - left.zIndex)
    .slice(0, MAX_REPORTED_OVERLAYS)
    .map((entry) => entry.description);
}

/** 逐层向上解析元素实际压在什么底色上；返回 `null` 表示链路上没有不透明底色。 */
function resolveEffectiveBackground(
  element: Element | null,
  view: Window,
): RgbColor | null {
  if (!element) return null;

  let computed: CSSStyleDeclaration;
  try {
    computed = view.getComputedStyle(element);
  } catch {
    return null;
  }

  const own = parseCssColor(computed.backgroundColor);
  if (own && own.a >= 0.999) return { r: own.r, g: own.g, b: own.b };

  const inherited = resolveEffectiveBackground(element.parentElement, view);
  if (!own || own.a <= 0) return inherited;
  if (!inherited) return null;
  return compositeOver(own, inherited);
}

/**
 * 采集主题与遮挡层诊断行（不含 `[14. …]` 段落标题，由调用方补）。
 */
export function collectThemeDiagnosticLines(
  doc: Document,
  viewport: ViewportSizeLike,
): string[] {
  const lines: string[] = [];
  lines.push("Theme variables, effective text/background contrast & viewport-covering overlays...");

  const view = doc.defaultView;
  if (!view) {
    lines.push("ERROR: document.defaultView unavailable, theme diagnostic skipped.");
    return lines;
  }

  const html = doc.documentElement;
  const htmlStyle = view.getComputedStyle(html);
  const themeAttribute = html.getAttribute("data-theme") ?? "(unset)";
  const htmlClasses = Array.from(html.classList).join(" ") || "(none)";
  const metaColorScheme = doc.querySelector('meta[name="color-scheme"]')?.getAttribute("content");
  let prefersDark = "unknown";
  try {
    prefersDark = view.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    prefersDark = "probe failed";
  }

  lines.push(`data-theme: ${themeAttribute}`);
  lines.push(`html class: ${htmlClasses}`);
  lines.push(
    `color-scheme: inline=${html.style.colorScheme || "(unset)"} computed=${
      htmlStyle.colorScheme || "(unset)"
    } meta=${metaColorScheme ?? "(unset)"} prefers-color-scheme=${prefersDark}`,
  );

  let missingVariable = false;
  for (const name of THEME_VARIABLES) {
    const raw = htmlStyle.getPropertyValue(name).trim();
    if (!raw) {
      missingVariable = true;
      lines.push(`${name}: (empty)`);
      continue;
    }
    const parsed = parseCssColor(raw);
    lines.push(`${name}: ${raw}${parsed ? ` → ${formatRgb(parsed)}` : " → (unparsed)"}`);
  }
  if (missingVariable) {
    lines.push(
      "ERROR: theme CSS variables missing on documentElement — theme stylesheet may not be applied.",
    );
  }

  const container = doc.getElementById("root")?.firstElementChild ?? doc.body;
  if (container) {
    const containerStyle = view.getComputedStyle(container);
    const textColor = parseCssColor(containerStyle.color);
    const background = resolveEffectiveBackground(container, view);
    lines.push(
      `#root element: <${container.tagName.toLowerCase()}> color=${containerStyle.color || "(unset)"} background=${
        containerStyle.backgroundColor || "(unset)"
      }`,
    );
    if (textColor && background) {
      const ratio = contrastRatio(textColor, background);
      const verdict =
        ratio < LOW_CONTRAST_ERROR_RATIO
          ? "ERROR: text/background contrast far too low"
          : ratio < LOW_CONTRAST_WARNING_RATIO
            ? "WARNING: text/background contrast below AA"
            : "OK";
      lines.push(
        `effective contrast: ${formatRgb(textColor)} on ${formatRgb(background)} = ${ratio.toFixed(
          2,
        )}:1 ${verdict}`,
      );
    } else {
      lines.push(
        `WARNING: effective text/background pair unresolved (text=${
          textColor ? formatRgb(textColor) : "unparsed"
        }, background=${background ? formatRgb(background) : "transparent chain"}) — page may rely on the native WebView background color.`,
      );
    }
  }

  const glow = doc.querySelector(".ambient-glow-layer");
  if (glow) {
    const glowOpacity = view.getComputedStyle(glow).opacity;
    lines.push(`ambient glow layer: present (opacity=${glowOpacity || "1"})`);
  } else {
    lines.push("ambient glow layer: absent (pure-color background mode)");
  }

  const overlays = findViewportCoveringOverlays(doc, viewport);
  lines.push(`viewport-covering overlays: ${overlays.length}`);
  for (const overlay of overlays) {
    lines.push(`WARNING: blocking overlay over viewport → ${overlay}`);
  }

  // 渲染/合成层面的故障（例如整屏发黑）在 DOM 与计算样式里全是"正常"，
  // JS 错误往往是唯一线索，因此把现场黑匣子一并列进报告。
  const recentErrors = getRecentRuntimeErrors();
  lines.push(`recent runtime errors: ${recentErrors.length}`);
  for (const entry of recentErrors.slice(-MAX_REPORTED_RUNTIME_ERRORS)) {
    lines.push(`WARNING: runtime error → ${formatRuntimeErrorEntry(entry)}`);
  }

  lines.push(...probeTextMetrics(doc, view, viewport));

  return lines;
}

/**
 * 文本度量与视口缩放探针。
 *
 * "线条和字重叠、字体完全看不清，但计算样式一切正常"的典型成因是**实际渲染尺寸被改写**：
 * 系统字体缩放（部分厂商 ROM 会放大 WebView 文字）、字体回退导致的行盒膨胀、
 * 或 WebView 页面缩放。`getComputedStyle` 只会回报请求值（如 13.76px），
 * 因此必须量一个探针元素的真实盒子才能看见这类问题。
 */
function probeTextMetrics(doc: Document, view: Window, viewport: ViewportSizeLike): string[] {
  const container = doc.body ?? doc.documentElement;
  if (!container) return [];
  const lines: string[] = [];

  const probe = doc.createElement("span");
  probe.textContent = "Hg字";
  probe.setAttribute(
    "style",
    "position:absolute;left:-9999px;top:0;font-size:100px;line-height:normal;white-space:nowrap;",
  );
  container.appendChild(probe);
  let height = 0;
  try {
    height = probe.getBoundingClientRect().height;
  } catch {
    height = 0;
  }
  probe.remove();

  const ratio = height > 0 ? height / 100 : 0;
  lines.push(
    `text metrics probe: 100px font renders ${height.toFixed(1)}px line box (ratio ${ratio.toFixed(2)})`,
  );
  // 正常字体行盒约 1.0–1.5 倍字号；明显越界说明被缩放/回退改写。
  if (ratio >= 2 || (ratio > 0 && ratio < 0.5)) {
    lines.push(
      "WARNING: rendered text metrics far from requested font-size — 系统字体缩放或字体回退可能正在改写排版（文字溢出、与边框线条重叠）",
    );
  }

  const visualScale = view.visualViewport?.scale;
  const innerWidth = view.innerWidth;
  const devicePixelRatio = view.devicePixelRatio;
  lines.push(
    `viewport scale: innerWidth=${innerWidth}px devicePixelRatio=${Number.isFinite(devicePixelRatio) ? devicePixelRatio : "?"} visualViewport.scale=${
      typeof visualScale === "number" ? visualScale.toFixed(3) : "(unavailable)"
    } probeViewport=${viewport.width}x${viewport.height}`,
  );

  return lines;
}
