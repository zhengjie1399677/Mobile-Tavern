import React, { createContext, useContext, useState, useMemo, useEffect } from "react";
import { CharacterCard } from "../types";
import { useKernel } from "./KernelContext";
import { ICharacterService } from "@/src/application/serviceContracts";
import { createCharacterUseCases } from "../application/useCases/characterUseCases";
import { useApp } from "./AppContext";
import { TRANSLATIONS } from "../locales/index";
import { Logger } from "../utils/logger";
import { getErrorMessage } from "../utils/errorUtils";

const logger = Logger.create("CharacterContext");

/** CharacterProvider 在 LanguageProvider 上方，无法使用 useTranslation hook。直接从 TRANSLATIONS 读当前语言翻译。 */
function tChar(key: string, errorMessage = ""): string {
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
  loadCharacterById: (id: string) => Promise<CharacterCard | null>;
  saveCharacter: (character: CharacterCard) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;
}

const CharacterContext = createContext<CharacterContextType | undefined>(undefined);

export const CharacterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const kernel = useKernel();
  const characterService = kernel.getService<ICharacterService<CharacterCard>>("character");
  const characterUseCases = useMemo(
    () => createCharacterUseCases(characterService),
    [characterService],
  );
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

  const loadCharacters = async () => {
    try {
      const cleaned = await characterUseCases.loadCatalog();
      if (isMountedRef.current) {
        setCharacters(cleaned);
        setIsDBReady(true);
      }
    } catch (e: unknown) {
      logger.error("Failed to load characters from IndexedDB", e);
      if (isMountedRef.current) {
        showCustomAlert(tChar("chat.load_characters_failed", getErrorMessage(e)));
      }
    }
  };

  useEffect(() => {
    loadCharacters();
  }, []);

  const saveCharacter = async (char: CharacterCard) => {
    try {
      const cleaned = await characterUseCases.saveCharacter(char);
      setCharacters((prev) => {
        const idx = prev.findIndex((c) => c.id === cleaned.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = cleaned;
          return next;
        }
        return [...prev, cleaned];
      });
    } catch (e: unknown) {
      logger.error("Failed to save character to IndexedDB", e, { characterId: char.id, characterName: char.name });
      showCustomAlert(tChar("chat.save_character_failed", getErrorMessage(e)));
      throw e;
    }
  };

  const loadCharacterById = async (id: string): Promise<CharacterCard | null> => {
    const loaded = await characterUseCases.loadCharacter(id, characters);
    if (!loaded) return null;
    // 7.3.3: 异步操作后检查 isMountedRef，避免组件卸载后 setCharacters 触发状态更新泄漏
    if (isMountedRef.current) {
      setCharacters((previous) =>
        previous.map((character) => character.id === id ? loaded : character)
      );
    }
    return loaded;
  };

  /**
   * 活跃角色必须是完整卡。
   *
   * 首屏只加载轻量目录（`getCharacterCatalog()` → `extensions.__catalogOnly`，不含
   * `regex_scripts` / `tavern_helper.scripts` / 世界书 / 开场白）。会话管理器、聊天历史等
   * 入口过去只调用 `setActiveCharId()` 就直接渲染，导致渲染层拿到的是一张"没有脚本的正则
   * 空卡"：角色卡正则不执行、状态栏与插图不出现、MVU 变量不注入，而且完全不报错。
   * 这里在活跃角色仍是目录投影时补一次完整卡加载，作为所有入口的统一兜底。
   */
  const hydratingCharacterIdRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (!activeCharId) return;
    const current = characters.find((character) => character.id === activeCharId);
    if (!current || !current.extensions?.__catalogOnly) return;
    if (hydratingCharacterIdRef.current === activeCharId) return;
    hydratingCharacterIdRef.current = activeCharId;
    void loadCharacterById(activeCharId).finally(() => {
      if (hydratingCharacterIdRef.current === activeCharId) {
        hydratingCharacterIdRef.current = null;
      }
    });
  }, [activeCharId, characters]);

  const deleteCharacter = async (id: string) => {
    try {
      await characterUseCases.deleteCharacter(id);
      setCharacters((prev) => prev.filter((c) => c.id !== id));
      if (activeCharId === id) {
        setActiveCharId(null);
      }
    } catch (e: unknown) {
      const message = getErrorMessage(e);
      if (message.includes("CHARACTER_DELETE_REQUIRES_SESSION_CLEANUP")) {
        logger.warn("Character deletion blocked: character still has active sessions", { characterId: id });
        showCustomAlert(tChar("chat.delete_character_session_guard"));
      } else {
        logger.error("Failed to delete character from IndexedDB", e, { characterId: id });
        showCustomAlert(tChar("chat.delete_character_failed", message));
      }
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
        loadCharacterById,
        saveCharacter,
        deleteCharacter,
      }}
    >
      {children}
    </CharacterContext.Provider>
  );
};

export const useCharacter = () => {
  const context = useContext(CharacterContext);
  if (!context) {
    throw new Error("useCharacter must be used within a CharacterProvider");
  }
  return context;
};

export const useCharactersState = useCharacter;
