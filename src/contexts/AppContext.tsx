import React, { createContext, useContext, useState, useEffect } from "react";

export type TabType =
  | "characters"
  | "chat"
  | "chat-history"
  | "settings"
  | "global-worldbook";

export type ThemeType = "snow" | "sand" | "ocean";

export interface CustomDialogConfig {
  isOpen: boolean;
  title: string;
  message: string;
  type: "alert" | "confirm" | "prompt";
  defaultValue?: string;
  onConfirmPrompt?: (value: string) => void;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface AppContextType {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  currentTheme: ThemeType;
  handleThemeChange: (theme: ThemeType) => void;
  showSplash: boolean;
  setShowSplash: (show: boolean) => void;
  customDialog: CustomDialogConfig | null;
  setCustomDialog: (config: CustomDialogConfig | null) => void;
  showCustomAlert: (message: string, title?: string) => Promise<void>;
  showCustomConfirm: (message: string, title?: string) => Promise<boolean>;
  showCustomPrompt: (message: string, defaultValue?: string, title?: string) => Promise<string | null>;
  promptInputVal: string;
  setPromptInputVal: (val: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<TabType>("characters");
  const [showSplash, setShowSplash] = useState(true);
  const [promptInputVal, setPromptInputVal] = useState("");
  const [customDialog, setCustomDialog] = useState<CustomDialogConfig | null>(null);
  const [currentTheme, setCurrentTheme] = useState<ThemeType>(() => {
    return (localStorage.getItem("siuser-theme") as any) || "sand";
  });

  const handleThemeChange = (newTheme: ThemeType) => {
    setCurrentTheme(newTheme);
    localStorage.setItem("siuser-theme", newTheme);
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", currentTheme);
    if (currentTheme === "ocean") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [currentTheme]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  const showCustomAlert = (message: string, title: string = "提示") => {
    return new Promise<void>((resolve) => {
      setCustomDialog({
        isOpen: true,
        title,
        message,
        type: "alert",
        onConfirm: () => {
          setCustomDialog(null);
          resolve();
        },
      });
    });
  };

  const showCustomConfirm = (message: string, title: string = "确认操作") => {
    return new Promise<boolean>((resolve) => {
      setCustomDialog({
        isOpen: true,
        title,
        message,
        type: "confirm",
        onConfirm: () => {
          setCustomDialog(null);
          resolve(true);
        },
        onCancel: () => {
          setCustomDialog(null);
          resolve(false);
        },
      });
    });
  };

  const showCustomPrompt = (
    message: string,
    defaultValue: string = "",
    title: string = "输入内容"
  ) => {
    setPromptInputVal(defaultValue);
    return new Promise<string | null>((resolve) => {
      setCustomDialog({
        isOpen: true,
        title,
        message,
        type: "prompt",
        defaultValue,
        onConfirmPrompt: (value) => {
          setCustomDialog(null);
          resolve(value);
        },
        onCancel: () => {
          setCustomDialog(null);
          resolve(null);
        },
      });
    });
  };

  return (
    <AppContext.Provider
      value={{
        activeTab,
        setActiveTab,
        currentTheme,
        handleThemeChange,
        showSplash,
        setShowSplash,
        customDialog,
        setCustomDialog,
        showCustomAlert,
        showCustomConfirm,
        showCustomPrompt,
        promptInputVal,
        setPromptInputVal,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
};
