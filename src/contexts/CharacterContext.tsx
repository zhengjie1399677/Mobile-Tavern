import React, { createContext, useContext, useState, useMemo, useEffect } from "react";
import { CharacterCard } from "../types";
import {
  getAllCharacters,
  saveCharacter as dbSaveCharacter,
  deleteCharacter as dbDeleteCharacter,
  getStoredDefaultCharactersInitializedFlag,
  saveStoredDefaultCharactersInitializedFlag,
  bulkSaveCharacters,
} from "../utils/localDB";
import { useApp } from "./AppContext";
import { reportUsage } from "../utils/telemetry";

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

  const activeCharacter = useMemo(
    () => characters.find((c) => c.id === activeCharId) || null,
    [characters, activeCharId]
  );



  const loadCharacters = async () => {
    try {
      let stored = await getAllCharacters();
      
      const hasInitialized = await getStoredDefaultCharactersInitializedFlag();

      if (!hasInitialized) {
        const { BUILTIN_CHARACTERS } = await import("../utils/builtInCharacters");
        await bulkSaveCharacters(BUILTIN_CHARACTERS);

        await saveStoredDefaultCharactersInitializedFlag(true);

        stored = await getAllCharacters();
      }

      setCharacters(stored || []);
      setIsDBReady(true);
    } catch (e: any) {
      console.error("Failed to load characters from IndexedDB:", e);
      showCustomAlert("加载本地角色库失败: " + e.message);
    }
  };

  useEffect(() => {
    loadCharacters();
  }, []);

  const saveCharacter = async (char: CharacterCard) => {
    try {
      await dbSaveCharacter(char);
      setCharacters((prev) => {
        const idx = prev.findIndex((c) => c.id === char.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = char;
          return next;
        }
        return [...prev, char];
      });
    } catch (e: any) {
      console.error("Failed to save character to IndexedDB:", e);
      showCustomAlert("保存角色失败: " + e.message);
      throw e;
    }
  };

  const deleteCharacter = async (id: string) => {
    try {
      await dbDeleteCharacter(id);
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
