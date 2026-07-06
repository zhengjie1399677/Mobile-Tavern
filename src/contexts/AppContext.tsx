import React, { createContext, useContext, useState, useEffect, useRef } from "react";

export type TabType =
  | "characters"
  | "chat"
  | "chat-history"
  | "settings"
  | "global-worldbook"
  | "playground";

export type ThemeType = "snow" | "sand" | "ocean" | "obsidian";

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

const AppContext = createContext<AppContextType | undefined>(undefined);

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

  const setActiveTab = (tab: TabType) => {
    if (typeof window !== "undefined") {
      const currentTab = window.location.hash.replace("#/", "");
      if (tab === "chat" && currentTab === "characters") {
        window.history.pushState(null, "", "#/characters");
        window.history.pushState(null, "", "#/chat");
        setActiveTabState("chat");
        return;
      }
      if (tab === "chat" && currentTab === "chat-history") {
        window.history.pushState(null, "", "#/chat-history");
        window.history.pushState(null, "", "#/chat");
        setActiveTabState("chat");
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
      setActiveTabState(tab);
    }
  };

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace("#/", "");
      const validTabs: TabType[] = ["characters", "chat", "chat-history", "settings", "global-worldbook", "playground"];
      if (validTabs.includes(hash as TabType)) {
        setActiveTabState(hash as TabType);
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
    return (localStorage.getItem("mobile_tavern_theme") || localStorage.getItem("siuser-theme") as any) || "ocean";
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
      const bridge = (window as any).AndroidThemeBridge;
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
    const isDark = currentTheme === "ocean" || currentTheme === "obsidian";
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
    const bridge = (window as any).AndroidThemeBridge;
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

  const showCustomAlert = (message: string, title: string = "提示") => {
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

  const showCustomConfirm = (message: string, title: string = "确认") => {
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

  const showCustomPrompt = (message: string, defaultValue: string = "", title: string = "输入", inputType: "text" | "textarea" = "text") => {
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

