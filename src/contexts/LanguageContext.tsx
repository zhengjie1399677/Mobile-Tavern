import React, { createContext, useContext, useState, useEffect } from "react";
import { TRANSLATIONS } from "../locales/translations";

export interface LanguageContextProps {
  language: string;
  changeLanguage: (lang: string) => void;
  t: (key: string, variables?: Record<string, string>) => string;
}

const LanguageContext = createContext<LanguageContextProps | undefined>(undefined);

const SUPPORTED_LANGUAGES = ["zh-CN", "zh-TW", "en", "ja", "ru", "es"];

const getSystemDefaultLanguage = (): string => {
  if (typeof window === "undefined") return "en";
  const sysLang = navigator.language || (navigator as any).userLanguage || "en";
  const lowerLang = sysLang.toLowerCase();

  if (lowerLang === "zh-tw" || lowerLang === "zh-hk" || lowerLang === "zh-mo") {
    return "zh-TW";
  }
  if (lowerLang.startsWith("zh")) {
    return "zh-CN";
  }
  if (lowerLang.startsWith("ja")) {
    return "ja";
  }
  if (lowerLang.startsWith("ru")) {
    return "ru";
  }
  if (lowerLang.startsWith("es")) {
    return "es";
  }
  return "en";
};

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("mobile_tavern_language");
      if (saved && SUPPORTED_LANGUAGES.includes(saved)) {
        return saved;
      }
    }
    // 未设置或不支持，走系统检测
    return getSystemDefaultLanguage();
  });

  // 保持同步，如果是系统检测出来的自动写一次
  useEffect(() => {
    localStorage.setItem("mobile_tavern_language", language);
  }, [language]);

  const changeLanguage = (lang: string) => {
    if (SUPPORTED_LANGUAGES.includes(lang)) {
      setLanguageState(lang);
    }
  };

  // 简易的点链键解析器 (e.g. "features.html_rendering") 与插值查找
  const t = (key: string, variables?: Record<string, string>): string => {
    const keys = key.split(".");
    
    // 1. 尝试从当前选择的语言提取
    let currentDict: any = TRANSLATIONS[language];
    let result = key;
    
    for (const k of keys) {
      if (currentDict && typeof currentDict === "object" && k in currentDict) {
        currentDict = currentDict[k];
      } else {
        currentDict = undefined;
        break;
      }
    }
    
    if (typeof currentDict === "string") {
      result = currentDict;
    } else {
      // 2. 降级：尝试从简体中文获取
      let fallbackDict: any = TRANSLATIONS["zh-CN"];
      for (const k of keys) {
        if (fallbackDict && typeof fallbackDict === "object" && k in fallbackDict) {
          fallbackDict = fallbackDict[k];
        } else {
          fallbackDict = undefined;
          break;
        }
      }
      if (typeof fallbackDict === "string") {
        result = fallbackDict;
      }
    }

    // 3. 动态变量插值替换 (e.g. t("key", { count: "5" }) 替换 {count})
    if (variables && typeof variables === "object") {
      Object.entries(variables).forEach(([k, v]) => {
        result = result.replace(new RegExp(`{${k}}`, "g"), v);
      });
    }

    return result;
  };

  return (
    <LanguageContext.Provider value={{ language, changeLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useTranslation = (): LanguageContextProps => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useTranslation must be used within a LanguageProvider");
  }
  return context;
};
