import React, { createContext, useContext, useState, useMemo, useEffect } from "react";
import { CharacterCard } from "../types";
import { useKernel } from "./KernelContext";
import { ICharacterService } from "../kernel/types";
import { useApp } from "./AppContext";
import { reportUsage } from "../utils/telemetry";
import { TRANSLATIONS } from "../locales/index";

/** CharacterProvider 在 LanguageProvider 上方，无法使用 useTranslation hook。直接从 TRANSLATIONS 读当前语言翻译。 */
function tChar(key: string, errorMessage: string): string {
  const lang = (typeof window !== "undefined" && localStorage.getItem("mobile_tavern_language")) || "zh-CN";
  const template = (TRANSLATIONS[lang]?.[key]) || TRANSLATIONS["zh-CN"]?.[key] || key;
  return template.replace("{error}", errorMessage);
}

interface CharacterContextType {
  characters: CharacterCard[];
  setCharacters: React.Dispatch<React.SetStateAction<CharacterCard[]>>;
  activeCharId: string | null;
  setActiveCharId: (id: string | null) => void;
  activeCharacter: CharacterCard | null;
  isDBReady: boolean;
  setIsDBReady: (ready: boolean) => void;
  loadCharacters: () => Promise<void>;
  saveCharacter: (character: CharacterCard) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;
}

const CharacterContext = createContext<CharacterContextType | undefined>(undefined);

export const CharacterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const kernel = useKernel();
  const characterService = kernel.getService<ICharacterService>("character");
  const { showCustomAlert } = useApp();
  const [characters, setCharacters] = useState<CharacterCard[]>([]);
  const [activeCharId, setActiveCharId] = useState<string | null>(null);
  const [isDBReady, setIsDBReady] = useState(false);

  const isMountedRef = React.useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const activeCharacter = useMemo(
    () => characters.find((c) => c.id === activeCharId) || null,
    [characters, activeCharId]
  );

  const cleanCharacter = (char: CharacterCard): CharacterCard => {
    if (!char) return char;
    return {
      ...char,
      lorebookEntries: (char.lorebookEntries || []).map((entry) => ({
        ...entry,
        keys: Array.isArray(entry.keys)
          ? entry.keys
          : typeof entry.keys === "string"
            ? (entry.keys as string)
                .split(",")
                .map((k) => k.trim())
                .filter(Boolean)
            : [],
      })),
    };
  };

  const loadCharacters = async () => {
    try {
      let stored = await characterService.getAllCharacters();

      const hasInitialized = await characterService.getStoredDefaultCharactersInitializedFlag();

      if (!hasInitialized) {
        // 使用异步加载函数获取含图片数据的完整角色卡
        // 符合 AGENTS.md 准则一第 2 条「物理层数据严格解耦与隔离」
        const { loadBuiltinCharacters } = await import("../utils/builtInCharacters");
        const builtinCharacters = await loadBuiltinCharacters();
        await characterService.bulkSaveCharacters(builtinCharacters);

        await characterService.saveStoredDefaultCharactersInitializedFlag(true);

        stored = await characterService.getAllCharacters();
      }

      const cleaned = (stored || []).map(cleanCharacter);
      if (isMountedRef.current) {
        setCharacters(cleaned);
        setIsDBReady(true);
      }
    } catch (e: any) {
      console.error("Failed to load characters from IndexedDB:", e);
      if (isMountedRef.current) {
        showCustomAlert(tChar("chat.load_characters_failed", e.message));
      }
    }
  };

  useEffect(() => {
    loadCharacters();
  }, []);

  const saveCharacter = async (char: CharacterCard) => {
    try {
      const cleaned = cleanCharacter(char);
      await characterService.saveCharacter(cleaned);
      setCharacters((prev) => {
        const idx = prev.findIndex((c) => c.id === cleaned.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = cleaned;
          return next;
        }
        return [...prev, cleaned];
      });
    } catch (e: any) {
      console.error("Failed to save character to IndexedDB:", e);
      showCustomAlert(tChar("chat.save_character_failed", e.message));
      throw e;
    }
  };

  const deleteCharacter = async (id: string) => {
    try {
      await characterService.deleteCharacter(id);
      setCharacters((prev) => prev.filter((c) => c.id !== id));
      if (activeCharId === id) {
        setActiveCharId(null);
      }
    } catch (e: any) {
      console.error("Failed to delete character from IndexedDB:", e);
      showCustomAlert(tChar("chat.delete_character_failed", e.message));
      throw e;
    }
  };

  return (
    <CharacterContext.Provider
      value={{
        characters,
        setCharacters,
        activeCharId,
        setActiveCharId,
        activeCharacter,
        isDBReady,
        setIsDBReady,
        loadCharacters,
        saveCharacter,
        deleteCharacter,
      }}
    >
      {children}
    </CharacterContext.Provider>
  );
};

export const useCharactersState = () => {
  const context = useContext(CharacterContext);
  if (!context) {
    throw new Error("useCharactersState must be used within a CharacterProvider");
  }
  return context;
};
