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

  // 直接键解析器 (e.g. "features.html_rendering") 与插值查找
  const t = (key: string, variables?: Record<string, string>): string => {
    // 1. 尝试从当前选择的语言提取
    const currentDict = TRANSLATIONS[language];
    let result = key;
    
    if (currentDict && currentDict[key] !== undefined) {
      result = currentDict[key];
    } else {
      // 2. 降级：尝试从英文 (en) 获取
      const fallbackDictEn = TRANSLATIONS["en"];
      if (fallbackDictEn && fallbackDictEn[key] !== undefined) {
        result = fallbackDictEn[key];
      } else {
        // 3. 最终降级：尝试从简体中文 (zh-CN) 获取
        const fallbackDictZh = TRANSLATIONS["zh-CN"];
        if (fallbackDictZh && fallbackDictZh[key] !== undefined) {
          result = fallbackDictZh[key];
        }
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
