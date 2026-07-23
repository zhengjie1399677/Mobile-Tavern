/**
 * 视口诊断黑匣子记录器。
 *
 * 设计目的：键盘遮挡输入框等问题是瞬态的，用户遇到后关闭键盘再跑诊断就会丢失现场。
 * 本模块在应用最早阶段初始化，持续记录 window/visualViewport 的 resize 事件历史，
 * 使系统报告能在事后回溯键盘弹出/关闭瞬间的实际视口尺寸与事件来源，定位：
 *   - interactive-widget=resizes-content 在特定 WebView 上是否生效
 *   - visualViewport.resize 与 window.resize 哪个触发、哪个缺失
 *   - 键盘弹出时 innerHeight 与 visualViewport.height 的实际差值
 *
 * 非业务逻辑，纯诊断工具，全局单例 + 环形缓冲，无副作用依赖。
 */

/** 单次 resize 事件记录。 */
export interface ViewportEventRecord {
  /** 事件时间戳（ms）。 */
  time: number;
  /** 事件来源：window resize / visualViewport resize / 初始化基准。 */
  source: "window" | "visualViewport" | "init";
  /** window.innerWidth / innerHeight（layout viewport 尺寸）。 */
  innerW: number;
  innerH: number;
  /** visualViewport.width / height（可见视口尺寸，键盘弹出时减小）；无 vvp 时为 null。 */
  vvpW: number | null;
  vvpH: number | null;
  /** visualViewport.offsetTop（overlays-content 模式下等于键盘高度）；无 vvp 时为 null。 */
  vvpOffsetTop: number | null;
  /** visualViewport.scale（CSS 像素与物理像素比）；无 vvp 时为 null。 */
  vvpScale: number | null;
}

/** 当前视口快照（供报告即时读取）。 */
export interface ViewportSnapshot {
  innerW: number;
  innerH: number;
  vvpW: number | null;
  vvpH: number | null;
  vvpOffsetTop: number | null;
  vvpScale: number | null;
  hasVisualViewport: boolean;
}

const MAX_RECORDS = 30;
const records: ViewportEventRecord[] = [];
let initialized = false;

/**
 * 采集一条视口事件记录并入缓冲。无 visualViewport 时对应字段为 null，
 * 这本身也是有价值的诊断信号（说明运行环境不支持 vvp）。
 */
function record(source: ViewportEventRecord["source"]): void {
  if (typeof window === "undefined") return;
  const vvp = window.visualViewport;
  records.push({
    time: Date.now(),
    source,
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    vvpW: vvp?.width ?? null,
    vvpH: vvp?.height ?? null,
    vvpOffsetTop: vvp?.offsetTop ?? null,
    vvpScale: vvp?.scale ?? null,
  });
  if (records.length > MAX_RECORDS) records.shift();
}

/**
 * 初始化视口诊断记录器。应在应用入口（main.tsx）最早阶段调用一次，
 * 以捕获从启动到首次键盘交互的完整事件序列。重复调用安全（幂等）。
 */
export function initViewportDiagnostic(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  // 先记录启动基准，作为后续高度变化的对照原点。
  record("init");

  // 同时监听 window.resize 与 visualViewport.resize：
  // interactive-widget=resizes-content 模式下，部分 WebView 只触发其一，
  // 分别记录来源以判定哪个事件通道在工作。
  window.addEventListener("resize", () => record("window"));
  const vvp = window.visualViewport;
  if (vvp) {
    vvp.addEventListener("resize", () => record("visualViewport"));
    // scroll 事件在 overlays-content 模式下伴随键盘弹出触发，offsetTop 变化是关键信号。
    vvp.addEventListener("scroll", () => record("visualViewport"));
  }
}

/** 获取当前视口快照。 */
export function getViewportSnapshot(): ViewportSnapshot {
  if (typeof window === "undefined") {
    return { innerW: 0, innerH: 0, vvpW: null, vvpH: null, vvpOffsetTop: null, vvpScale: null, hasVisualViewport: false };
  }
  const vvp = window.visualViewport;
  return {
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    vvpW: vvp?.width ?? null,
    vvpH: vvp?.height ?? null,
    vvpOffsetTop: vvp?.offsetTop ?? null,
    vvpScale: vvp?.scale ?? null,
    hasVisualViewport: !!vvp,
  };
}

/** 获取最近 resize 事件历史（副本，最早 → 最新）。 */
export function getViewportHistory(): ViewportEventRecord[] {
  return [...records];
}

/** 读取 index.html 的 viewport meta 标签 content 属性，判定 interactive-widget 模式。 */
export function getViewportMeta(): string {
  if (typeof document === "undefined") return "(no document)";
  const meta = document.querySelector('meta[name="viewport"]');
  return meta?.getAttribute("content") ?? "(viewport meta not found)";
}

/**
 * 测量 100dvh 对应的实际像素值。dvh（dynamic viewport height）在键盘弹出时的行为
 * 因 WebView 而异，实测值能揭示容器高度是否被 dvh 单位卡住。
 */
export function measureDynamicViewportHeight(): number | null {
  if (typeof document === "undefined") return null;
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;top:0;left:0;width:0;height:100dvh;visibility:hidden;";
  document.documentElement.appendChild(probe);
  const h = probe.offsetHeight;
  probe.remove();
  return h;
}

/** 仅供测试：重置内部状态。生产代码不应调用。 */
export function __resetViewportDiagnosticForTest(): void {
  records.length = 0;
  initialized = false;
}

// ---------------------------------------------------------------------------
// 键盘状态与 active element 遮挡判定（纯函数，供系统报告自检调用）
// ---------------------------------------------------------------------------

/** 键盘弹出状态判定结果。 */
export interface KeyboardState {
  /** 键盘是否被认为已弹出。 */
  likelyUp: boolean;
  /** 估算的键盘高度（px），无法估算时为 null。 */
  estimatedHeightPx: number | null;
  /** 判定依据说明，便于人工核对。 */
  basis: string;
}

/**
 * 基于视口快照判定键盘弹出状态与估算高度。
 *
 * 两种 WebView 键盘避让模式下的判定逻辑：
 *  - overlays-content：visualViewport.offsetTop 在键盘弹出时增大，近似键盘高度
 *  - resizes-content：visualViewport.height 在键盘弹出时减小，差值近似键盘高度
 *
 * 阈值 50px 用于过滤状态栏/导航栏等小幅 inset 噪声。
 */
export function estimateKeyboardState(snap: ViewportSnapshot): KeyboardState {
  if (!snap.hasVisualViewport || snap.vvpH === null) {
    return { likelyUp: false, estimatedHeightPx: null, basis: "no visualViewport API" };
  }
  // overlays-content 模式：offsetTop 增大代表键盘顶起可视区域
  if (snap.vvpOffsetTop !== null && snap.vvpOffsetTop > 50) {
    return {
      likelyUp: true,
      estimatedHeightPx: snap.vvpOffsetTop,
      basis: `overlays-content (offsetTop=${snap.vvpOffsetTop}px)`,
    };
  }
  // resizes-content 模式：vvp.height 明显小于 innerHeight
  const heightDiff = snap.innerH - snap.vvpH;
  if (heightDiff > 50) {
    return {
      likelyUp: true,
      estimatedHeightPx: heightDiff,
      basis: `resizes-content (innerH ${snap.innerH} - vvpH ${snap.vvpH} = ${heightDiff}px)`,
    };
  }
  return {
    likelyUp: false,
    estimatedHeightPx: 0,
    basis: `vvpH=${snap.vvpH} ≈ innerH=${snap.innerH}`,
  };
}

/** active element 遮挡判定结果。 */
export interface ActiveElementOcclusion {
  /** 是否有可评估的 active element。 */
  hasActiveElement: boolean;
  /** active element 的 tagName（如 INPUT/TEXTAREA）。 */
  tagName: string | null;
  /** active element 的 boundingClientRect（px）。 */
  rect: { top: number; bottom: number; left: number; right: number; width: number; height: number } | null;
  /** 当前可视区域底部边界（px），即键盘上沿位置。 */
  visibleBottomPx: number | null;
  /** active element 底部是否超出可视区域（被键盘遮挡）。 */
  isOccluded: boolean;
  /** 遮挡距离（px），正值表示被遮挡的程度，负值表示未遮挡的余量。 */
  occlusionDistancePx: number | null;
  /** 判定说明，供报告直接输出。 */
  detail: string;
}

/**
 * 判定当前 active element 是否被键盘遮挡。
 *
 * 需在键盘弹出状态下调用才有意义；键盘未弹出时 isOccluded 恒为 false，
 * 但仍会输出 active element 的 rect 与 visibleBottom 供人工核对。
 */
export function checkActiveElementOcclusion(snap: ViewportSnapshot): ActiveElementOcclusion {
  const empty: ActiveElementOcclusion = {
    hasActiveElement: false,
    tagName: null,
    rect: null,
    visibleBottomPx: null,
    isOccluded: false,
    occlusionDistancePx: null,
    detail: "no active element",
  };
  if (typeof document === "undefined") return empty;

  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body || el === document.documentElement) {
    return empty;
  }

  const tag = el.tagName;
  const isEditable = tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
  if (!isEditable) {
    return {
      ...empty,
      hasActiveElement: true,
      tagName: tag,
      detail: `active element is <${tag}> (not input/textarea/contentEditable)`,
    };
  }

  const rect = el.getBoundingClientRect();
  // 可视区域底部：overlays 模式用 offsetTop + vvp.height，resizes 模式 vvp.height 已是缩小后的值
  let visibleBottom: number;
  if (snap.hasVisualViewport && snap.vvpH !== null) {
    visibleBottom = (snap.vvpOffsetTop ?? 0) + snap.vvpH;
  } else {
    visibleBottom = snap.innerH;
  }

  const occlusionDist = Math.round(rect.bottom - visibleBottom);
  const isOccluded = occlusionDist > 0;

  return {
    hasActiveElement: true,
    tagName: tag,
    rect: {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    visibleBottomPx: Math.round(visibleBottom),
    isOccluded,
    occlusionDistancePx: occlusionDist,
    detail: isOccluded
      ? `OCCLUDED: <${tag}> bottom ${Math.round(rect.bottom)}px > visible bottom ${Math.round(visibleBottom)}px (超出 ${occlusionDist}px)`
      : `<${tag}> bottom ${Math.round(rect.bottom)}px ≤ visible bottom ${Math.round(visibleBottom)}px (余量 ${-occlusionDist}px)`,
  };
}
