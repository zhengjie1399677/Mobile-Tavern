import React from "react";

/**
 * Android UA 括号段里不代表机型的占位词。
 *
 * - `wv`：Android System WebView 标记（过去被误当成机型上报，见下方注释）；
 * - `K`：Chrome UA Reduction 之后用来替换真实机型的占位符；
 * - 其余是平台/形态标记，不属于机型。
 */
const ANDROID_UA_NON_MODEL_SEGMENTS = new Set([
  "wv",
  "mobile",
  "tablet",
  "linux",
  "k",
]);

/**
 * 从 Android UA 中解析"机型 (Android 版本)"。
 *
 * WebView UA 形如 `Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TKQ1.221114.001; wv) …`：
 * 机型在带 `Build/` 的那一段里，而括号内**最后一段**是 WebView 标记 `wv`。
 * 旧实现直接取最后一段，于是所有 WebView 用户都被上报成"设备型号：wv"。
 *
 * 返回 `null` 表示这不是一段能识别出 Android 的 UA。
 */
export function parseAndroidDeviceModel(userAgent: string): string | null {
  const group = userAgent.match(/\(([^)]+)\)/)?.[1];
  if (!group) return null;

  const segments = group
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const androidIndex = segments.findIndex((segment) => /android/i.test(segment));
  if (androidIndex < 0) return null;

  const androidPart = segments[androidIndex].replace(/\s+/g, " ");

  // 1) 首选带 `Build/` 的段：机型在其之前（小米/华为等 ROM 也会照此保留）。
  const buildSegment = segments.find((segment) => /build\//i.test(segment));
  let model = buildSegment ? buildSegment.replace(/\s*build\/.*$/i, "").trim() : "";

  // 2) 退化为"Android 段之后的第一个非占位段"（部分 ROM 不带 Build/ 串）。
  if (!model) {
    model =
      segments
        .slice(androidIndex + 1)
        .find(
          (segment) =>
            !ANDROID_UA_NON_MODEL_SEGMENTS.has(segment.toLowerCase()) &&
            !/android/i.test(segment),
        ) ?? "";
  }

  return `${model || "Android Device"} (${androidPart})`;
}

export function getDeviceModel(): string {
  if (typeof navigator === "undefined") return "Unknown Device";
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) {
    return parseAndroidDeviceModel(ua) ?? "Android Device";
  }
  if (/iphone|ipad|ipod/i.test(ua)) {
    return "iOS Device";
  }
  return "PC Web/Browser";
}

export function getFreeTrialCount(): number {
  return Number(localStorage.getItem("mobile_tavern_free_trial_count") || 0);
}

export interface ViewportSize {
  w: number;
  h: number;
  vW: number;
  vH: number;
}

export function useViewportSize(): ViewportSize {
  const [viewportSize, setViewportSize] = React.useState<ViewportSize>(() => {
    if (typeof window === "undefined") return { w: 0, h: 0, vW: 0, vH: 0 };
    return {
      w: window.innerWidth,
      h: window.innerHeight,
      vW: window.visualViewport?.width || window.innerWidth,
      vH: window.visualViewport?.height || window.innerHeight,
    };
  });

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const updateSize = () => {
      setViewportSize({
        w: window.innerWidth,
        h: window.innerHeight,
        vW: window.visualViewport?.width || window.innerWidth,
        vH: window.visualViewport?.height || window.innerHeight,
      });
    };
    window.addEventListener("resize", updateSize);
    window.visualViewport?.addEventListener("resize", updateSize);
    return () => {
      window.removeEventListener("resize", updateSize);
      window.visualViewport?.removeEventListener("resize", updateSize);
    };
  }, []);

  return viewportSize;
}
