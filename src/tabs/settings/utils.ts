import React from "react";

export function getDeviceModel(): string {
  if (typeof navigator === "undefined") return "Unknown Device";
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) {
    const parts = ua.match(/\(([^)]+)\)/);
    if (parts && parts[1]) {
      const subParts = parts[1].split(';');
      const androidPart = subParts.find(p => p.includes('Android'));
      if (androidPart) {
        const modelPart = subParts[subParts.length - 1] || "";
        return `${modelPart.trim().replace(/Build\/.*/g, "")} (${androidPart.trim()})`;
      }
    }
    return "Android Device";
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
