import React, { createContext, useContext, useState, useMemo, useEffect } from "react";
import { CharacterCard } from "../types";
import { globalKernel } from "../kernel/Kernel";
import { ICharacterService } from "../kernel/types";
import { useApp } from "./AppContext";
import { reportUsage } from "../utils/telemetry";

/**
 * 获取角色业务服务插件（微内核插件式架构）。
 * 在调用点而非模块加载期取服务，避免服务未注册时的初始化时序问题。
 */
function getCharacterService(): ICharacterService {
  return globalKernel.getService<ICharacterService>("character");
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
      const characterService = getCharacterService();
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
        showCustomAlert("加载本地角色库失败: " + e.message);
      }
    }
  };

  useEffect(() => {
    loadCharacters();
  }, []);

  const saveCharacter = async (char: CharacterCard) => {
    try {
      const cleaned = cleanCharacter(char);
      await getCharacterService().saveCharacter(cleaned);
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
      showCustomAlert("保存角色失败: " + e.message);
      throw e;
    }
  };

  const deleteCharacter = async (id: string) => {
    try {
      await getCharacterService().deleteCharacter(id);
      setCharacters((prev) => prev.filter((c) => c.id !== id));
      if (activeCharId === id) {
        setActiveCharId(null);
      }
    } catch (e: any) {
      console.error("Failed to delete character from IndexedDB:", e);
      showCustomAlert("删除角色失败: " + e.message);
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
