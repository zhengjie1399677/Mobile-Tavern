import { useState } from "react";

type AndroidOrientationMode = "landscape" | "auto";

interface AndroidOrientationBridge {
  setScreenOrientation?: (mode: AndroidOrientationMode) => boolean;
}

interface WindowWithAndroidOrientationBridge extends Window {
  AndroidThemeBridge?: AndroidOrientationBridge;
}

/**
 * 暴露 Android 原生屏幕方向控制。浏览器与未实现该桥接的平台会自动隐藏入口。
 */
export function useAndroidOrientationControl() {
  const [forcedLandscape, setForcedLandscape] = useState(false);
  const bridge = typeof window === "undefined"
    ? undefined
    : (window as WindowWithAndroidOrientationBridge).AndroidThemeBridge;
  const available = typeof bridge?.setScreenOrientation === "function";

  const toggleOrientation = () => {
    if (!bridge?.setScreenOrientation) return false;

    const nextForcedLandscape = !forcedLandscape;
    const accepted = bridge.setScreenOrientation(nextForcedLandscape ? "landscape" : "auto");
    if (accepted) setForcedLandscape(nextForcedLandscape);
    return accepted;
  };

  return { available, forcedLandscape, toggleOrientation };
}
