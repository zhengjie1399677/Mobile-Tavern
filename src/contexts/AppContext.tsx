import React, { createContext, useContext, useState, useEffect, useRef, startTransition } from "react";
import { TRANSLATIONS } from "../locales/index";

/**
 * 原生 Android WebView 注入的桥接对象形状（仅声明本文件实际使用的方法子集）。
 * 完整定义见 src-tauri/plugins/android-bridge/guest-js/index.ts。
 */
interface AndroidThemeBridge {
  getSafeAreas?: () => string;
  setStatusBarStyle?: (isDark: boolean, color: string) => void;
}

/**
 * 扩展 Window 以访问原生注入的 AndroidThemeBridge。
 * 字段可选，反映"运行时动态挂载到 window"的真实语义。
 */
interface WindowWithAndroidBridge extends Window {
  AndroidThemeBridge?: AndroidThemeBridge;
}

export type TabType =
  | "characters"
  | "chat"
  | "chat-history"
  | "settings"
  | "global-worldbook"
  | "playground";

export type ThemeType = "snow" | "sand" | "ocean" | "obsidian" | (string & {});

export interface CustomDialogConfig {
  isOpen: boolean;
  title: string;
  message: string;
  type: "alert" | "confirm" | "prompt";
  defaultValue?: string;
  inputType?: "text" | "textarea";
  onConfirmPrompt?: (value: string) => void;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface AppContextType {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  activeWorldbookHostId: string | null;
  setActiveWorldbookHostId: (id: string | null) => void;
  currentTheme: ThemeType;
  handleThemeChange: (theme: ThemeType) => void;
  showSplash: boolean;
  setShowSplash: (show: boolean) => void;
  customDialog: CustomDialogConfig | null;
  setCustomDialog: (config: CustomDialogConfig | null) => void;
  showCustomAlert: (message: string, title?: string) => Promise<void>;
  showCustomConfirm: (message: string, title?: string) => Promise<boolean>;
  showCustomPrompt: (message: string, defaultValue?: string, title?: string) => Promise<string | null>;

  // Timeline Memory states (optional in core context)
  newSummaryTag?: string;
  setNewSummaryTag?: (val: string) => void;
  newSummaryLoc?: string;
  setNewSummaryLoc?: (val: string) => void;
  newSummaryContent?: string;
  setNewSummaryContent?: (val: string) => void;
  safeAreas: { top: number; bottom: number };
}

const APP_CONTEXT_REGISTRY_KEY = "__MOBILE_TAVERN_APP_CONTEXT_V1__" as const;
type AppContextRegistry = typeof globalThis & {
  [APP_CONTEXT_REGISTRY_KEY]?: React.Context<AppContextType | undefined>;
};

// Vite Fast Refresh can evaluate a context module again while mounted providers
// still reference the previous module instance. Keep the context identity stable
// across module reloads so consumers never detach from an otherwise valid provider.
const appContextRegistry = globalThis as AppContextRegistry;
const AppContext =
  appContextRegistry[APP_CONTEXT_REGISTRY_KEY] ??
  createContext<AppContextType | undefined>(undefined);
appContextRegistry[APP_CONTEXT_REGISTRY_KEY] = AppContext;

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTabState] = useState<TabType>(() => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash.replace("#/", "");
      const validTabs: TabType[] = ["characters", "chat", "chat-history", "settings", "global-worldbook", "playground"];
      if (validTabs.includes(hash as TabType)) {
        return hash as TabType;
      }
    }
    return "characters";
  });

  // 主页面均由 React.lazy 按需加载。将页签提交标记为 Transition，能在分包解析的
  // 短暂间隙继续保留当前页面，避免快速加载时局部 loading 转圈一闪而过。
  const commitActiveTab = (tab: TabType) => {
    startTransition(() => setActiveTabState(tab));
  };

  const setActiveTab = (tab: TabType) => {
    if (typeof window !== "undefined") {
      const currentTab = window.location.hash.replace("#/", "");
      if (tab === "chat" && currentTab === "characters") {
        window.history.pushState(null, "", "#/characters");
        window.history.pushState(null, "", "#/chat");
        commitActiveTab("chat");
        return;
      }
      if (tab === "chat" && currentTab === "chat-history") {
        window.history.pushState(null, "", "#/chat-history");
        window.history.pushState(null, "", "#/chat");
        commitActiveTab("chat");
        return;
      }
      if (tab === "chat-history" && currentTab === "chat") {
        window.history.back();
        return;
      }
      if (tab === "characters" && currentTab === "chat") {
        window.history.back();
        return;
      }
      window.location.hash = `#/${tab}`;
    } else {
      commitActiveTab(tab);
    }
  };

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace("#/", "");
      const validTabs: TabType[] = ["characters", "chat", "chat-history", "settings", "global-worldbook", "playground"];
      if (validTabs.includes(hash as TabType)) {
        commitActiveTab(hash as TabType);
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  const [activeWorldbookHostId, setActiveWorldbookHostId] = useState<string | null>(null);
  const [showSplash, setShowSplash] = useState(true);
  const [dialogQueue, setDialogQueue] = useState<CustomDialogConfig[]>([]);
  const setCustomDialog = (config: CustomDialogConfig | null) => {
    if (config === null) {
      setDialogQueue([]);
    } else {
      setDialogQueue([config]);
    }
  };
  const [currentTheme, setCurrentTheme] = useState<ThemeType>(() => {
    return (localStorage.getItem("mobile_tavern_theme") || localStorage.getItem("siuser-theme") || "ocean") as ThemeType;
  });
  const isInitialRender = useRef(true);

  const handleThemeChange = (newTheme: ThemeType) => {
    setCurrentTheme(newTheme);
    localStorage.setItem("mobile_tavern_theme", newTheme);
  };

  const [safeAreas, setSafeAreas] = useState<{ top: number; bottom: number }>(() => {
    if (typeof window !== "undefined") {
      const style = window.getComputedStyle(document.documentElement);
      const topVal = style.getPropertyValue("--safe-area-top") || style.getPropertyValue("--android-safe-area-top");
      const bottomVal = style.getPropertyValue("--safe-area-bottom") || style.getPropertyValue("--android-safe-area-bottom");
      const top = parseInt(topVal, 10);
      const bottom = parseInt(bottomVal, 10);
      return {
        top: isNaN(top) ? 0 : top,
        bottom: isNaN(bottom) ? 0 : bottom,
      };
    }
    return { top: 0, bottom: 0 };
  });

  // Synchronize Android Native Safe Area Heights via bridge and custom events
  useEffect(() => {
    const updateSafeAreas = (top: number, bottom: number) => {
      setSafeAreas({ top, bottom });
      document.documentElement.style.setProperty('--android-safe-area-top', `${top}px`);
      document.documentElement.style.setProperty('--android-safe-area-bottom', `${bottom}px`);
      document.documentElement.style.setProperty('--safe-area-top', `${top}px`);
      document.documentElement.style.setProperty('--safe-area-bottom', `${bottom}px`);
    };

    const tryFetchSafeAreas = () => {
      const bridge = (window as WindowWithAndroidBridge).AndroidThemeBridge;
      if (bridge && typeof bridge.getSafeAreas === "function") {
        try {
          const res = JSON.parse(bridge.getSafeAreas());
          console.log("[AppContext] getSafeAreas success:", res);
          updateSafeAreas(res.top, res.bottom);
          return true;
        } catch (e) {
          console.error("Failed to parse native safe areas:", e);
        }
      }
      return false;
    };

    // 1. 立即尝试一次
    const initialSuccess = tryFetchSafeAreas();

    // 2. 如果初始获取失败（可能由于 Bridge 尚未准备就绪），设置定时器重试（3秒内每150毫秒重试一次）
    let retryCount = 0;
    const maxRetries = 20;
    let timerId: any = null;

    if (!initialSuccess) {
      timerId = setInterval(() => {
        retryCount++;
        const success = tryFetchSafeAreas();
        if (success || retryCount >= maxRetries) {
          clearInterval(timerId);
        }
      }, 150);
    }

    const handleSafeAreasChange = (e: any) => {
      console.log("[AppContext] androidSafeAreasChanged event received:", e.detail);
      if (e.detail) {
        updateSafeAreas(e.detail.top, e.detail.bottom);
      }
    };

    window.addEventListener("androidSafeAreasChanged", handleSafeAreasChange);
    return () => {
      if (timerId) clearInterval(timerId);
      window.removeEventListener("androidSafeAreasChanged", handleSafeAreasChange);
    };
  }, []);

  useEffect(() => {
    let timer: any;
    if (isInitialRender.current) {
      isInitialRender.current = false;
    } else {
      document.documentElement.classList.add("theme-transitioning");
      timer = setTimeout(() => {
        document.documentElement.classList.remove("theme-transitioning");
      }, 350);
    }

    document.documentElement.setAttribute("data-theme", currentTheme);
    // isDark 判定：内置主题用字面量；自定义主题（custom_* 前缀）从 localStorage 读取由
    // ThemeConfigSection 在应用主题前写入的 isDark 标记，避免 AppProvider 反向依赖 settings.customThemes
    let isDark: boolean;
    if (typeof currentTheme === "string" && currentTheme.startsWith("custom_")) {
      isDark = localStorage.getItem("mobile_tavern_custom_is_dark") === "true";
    } else {
      isDark = currentTheme === "ocean" || currentTheme === "obsidian";
    }
    if (isDark) {
      document.documentElement.classList.add("dark");
      document.documentElement.style.colorScheme = "dark";
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.style.colorScheme = "light";
    }

    // Map theme to the actual background hex that matches index.css variables
    let color = "#f5f0e8"; // sand default
    if (currentTheme === "snow") {
      color = "#f9fbfc";
    } else if (currentTheme === "ocean") {
      color = "#1a2040"; // approximates oklch(0.15 0.03 260)
    } else if (currentTheme === "obsidian") {
      color = "#0d0f17"; // obsidian background
    } else if (typeof currentTheme === "string" && currentTheme.startsWith("custom_")) {
      // 自定义主题：根据 isDark 复用相近内置主题的状态栏色作为兜底
      // 真实背景由注入的 CSS 变量控制，此处仅用于原生状态栏配色对齐
      color = isDark ? "#0d0f17" : "#f5f0e8";
    }

    // Synchronize meta color-scheme
    let metaColorScheme = document.querySelector('meta[name="color-scheme"]');
    if (!metaColorScheme) {
      metaColorScheme = document.createElement("meta");
      metaColorScheme.setAttribute("name", "color-scheme");
      document.head.appendChild(metaColorScheme);
    }
    metaColorScheme.setAttribute("content", isDark ? "dark" : "light");

    // Synchronize meta theme-color to style system status bar elements
    let metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (!metaThemeColor) {
      metaThemeColor = document.createElement("meta");
      metaThemeColor.setAttribute("name", "theme-color");
      document.head.appendChild(metaThemeColor);
    }
    metaThemeColor.setAttribute("content", color);

    // Toggle Android native status bar icon color and background.
    // Cold-start initialization is handled by Kotlin reading SharedPreferences in onCreate().
    // This call updates the live status bar when the user switches themes at runtime.
    const bridge = (window as WindowWithAndroidBridge).AndroidThemeBridge;
    if (bridge && typeof bridge.setStatusBarStyle === "function") {
      try {
        bridge.setStatusBarStyle(isDark, color);
      } catch (e) {
        console.error("Failed to set Android status bar style:", e);
      }
    }

    return () => {
      if (timer) {
        clearTimeout(timer);
        document.documentElement.classList.remove("theme-transitioning");
      }
    };
  }, [currentTheme]);


  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const showCustomAlert = (message: string, title: string = TRANSLATIONS["zh-CN"]["dialog.alert_default_title"]) => {
    return new Promise<void>((resolve) => {
      const newDialog: CustomDialogConfig = {
        isOpen: true,
        title,
        message,
        type: "alert",
        onConfirm: () => {
          setDialogQueue((prev) => prev.slice(1));
          resolve();
        },
      };
      setDialogQueue((prev) => [...prev, newDialog]);
    });
  };

  const showCustomConfirm = (message: string, title: string = TRANSLATIONS["zh-CN"]["dialog.confirm_default_title"]) => {
    return new Promise<boolean>((resolve) => {
      const newDialog: CustomDialogConfig = {
        isOpen: true,
        title,
        message,
        type: "confirm",
        onConfirm: () => {
          setDialogQueue((prev) => prev.slice(1));
          resolve(true);
        },
        onCancel: () => {
          setDialogQueue((prev) => prev.slice(1));
          resolve(false);
        },
      };
      setDialogQueue((prev) => [...prev, newDialog]);
    });
  };

  const showCustomPrompt = (message: string, defaultValue: string = "", title: string = TRANSLATIONS["zh-CN"]["dialog.prompt_default_title"], inputType: "text" | "textarea" = "text") => {
    return new Promise<string | null>((resolve) => {
      const newDialog: CustomDialogConfig = {
        isOpen: true,
        title,
        message,
        type: "prompt",
        defaultValue,
        inputType,
        onConfirmPrompt: (value: string) => {
          setDialogQueue((prev) => prev.slice(1));
          resolve(value);
        },
        onCancel: () => {
          setDialogQueue((prev) => prev.slice(1));
          resolve(null);
        },
      };
      setDialogQueue((prev) => [...prev, newDialog]);
    });
  };

  return (
    <AppContext.Provider
      value={{
        activeTab,
        setActiveTab,
        activeWorldbookHostId,
        setActiveWorldbookHostId,
        currentTheme,
        handleThemeChange,
        showSplash,
        setShowSplash,
        customDialog: dialogQueue[0] || null,
        setCustomDialog,
        showCustomAlert,
        showCustomConfirm,
        showCustomPrompt,
        safeAreas,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within an AppProvider");
  }
  return context;
};

export const useApp = useAppContext;

