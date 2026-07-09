import React, { useState, useCallback } from "react";
import { useApp } from "../contexts/AppContext";
import { useCharactersState } from "../contexts/CharacterContext";
import { CharacterCard, LorebookEntry } from "../types";
import { catbotEventBus } from "../utils/catbotEventBus";

/**
 * 角色卡编辑业务 Hook
 *
 * 从 useCharacters.ts 抽离的编辑逻辑，保持职责单一。
 * 包含：
 *   - 编辑态 UI state（弹窗、当前编辑卡、世界书 tab 等）
 *   - 角色卡 CRUD handlers（新增/编辑/删除/保存）
 *   - 世界书条目保存（编辑中的卡 + 活跃卡的立绘词条）
 *
 * 设计遵循 AGENTS.md 准则一第 6 条「面向模块化/服务化的轻量化开发」。
 */
export const useCharacterEditor = () => {
  const { showCustomAlert, showCustomConfirm } = useApp();
  const {
    characters,
    setCharacters,
    activeCharId,
    setActiveCharId,
    saveCharacter,
    deleteCharacter,
  } = useCharactersState();

  // 编辑态：弹窗 / 当前编辑卡 / 写入中标志
  const [charModalOpen, setCharModalOpen] = useState(false);
  const [editingChar, setEditingChar] = useState<Partial<CharacterCard> | null>(null);
  const [isDbWriting, setIsDbWriting] = useState(false);
  // 编辑态：世界书 tab 切换
  const [activeLoreTab, setActiveLoreTab] = useState<"detail" | "lore">("detail");
  const [editingLoreEntry, setEditingLoreEntry] = useState<Partial<LorebookEntry> | null>(null);
  const [expandedLoreIds, setExpandedLoreIds] = useState<Record<string, boolean>>({});
  const [editingActiveCharLoreEntry, setEditingActiveCharLoreEntry] = useState<Partial<LorebookEntry> | null>(null);

  // 触发新建角色
  const handleAddNewCharacter = useCallback(() => {
    setEditingChar({
      id: "char_" + Math.random().toString(36).substring(2, 9),
      name: "",
      description: "",
      personality: "",
      scenario: "",
      first_mes: "",
      mes_example: "",
      system_prompt: "",
      lorebookEntries: [],
      isWorldbookGlobal: false,
    });
    setActiveLoreTab("detail");
    setCharModalOpen(true);
  }, []);

  // 触发编辑已有角色
  const handleEditCharacter = useCallback((char: CharacterCard) => {
    setEditingChar({ ...char });
    setActiveLoreTab("detail");
    setCharModalOpen(true);
  }, []);

  // 删除角色（级联清理关联会话）
  const handleDeleteCharacter = useCallback(async (
    id: string,
    e: React.MouseEvent,
    sessions: any[],
    setSessions: React.Dispatch<React.SetStateAction<any[]>>,
    deleteSession: (id: string) => Promise<void>
  ) => {
    e.stopPropagation();
    const ok = await showCustomConfirm(
      "确认删除该角色卡？其所有衍生聊天记录与世界书皆会被清理。"
    );
    if (ok) {
      setIsDbWriting(true);
      try {
        await deleteCharacter(id);
        // 级联清理关联会话
        const assocSessions = sessions.filter((s) => s.characterId === id);
        for (const s of assocSessions) {
          await deleteSession(s.id);
        }
        setCharacters((prev) => prev.filter((c) => c.id !== id));
        setSessions((prev) => prev.filter((s) => s.characterId !== id));
        if (activeCharId === id) {
          setActiveCharId(null);
        }
      } finally {
        setIsDbWriting(false);
      }
    }
  }, [showCustomConfirm, deleteCharacter, setCharacters, activeCharId, setActiveCharId]);

  // 保存当前编辑中的角色卡
  const handleSaveCharacter = useCallback(async () => {
    if (!editingChar || !editingChar.name?.trim()) {
      await showCustomAlert("请输入角色名字");
      return;
    }
    const fullChar = {
      ...editingChar,
      id:
        editingChar.id || "char_" + Math.random().toString(36).substring(2, 9),
      name: editingChar.name.trim(),
      description: editingChar.description || "",
      personality: editingChar.personality || "",
      scenario: editingChar.scenario || "",
      first_mes: editingChar.first_mes || "",
      mes_example: editingChar.mes_example || "",
      system_prompt: editingChar.system_prompt || "",
      avatar: editingChar.avatar || "",
      lorebookEntries: editingChar.lorebookEntries || [],
    } as CharacterCard;

    setIsDbWriting(true);
    try {
      const isNew = !characters.some((c) => c.id === fullChar.id);
      await saveCharacter(fullChar);
      setCharacters((prev) => {
        const idx = prev.findIndex((c) => c.id === fullChar.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = fullChar;
          return next;
        }
        return [...prev, fullChar];
      });
      if (isNew) {
        catbotEventBus.emit("character_created");
      }
      setCharModalOpen(false);
      setEditingChar(null);
    } catch (err: any) {
      console.error("Failed to save character to IndexedDB:", err);
      showCustomAlert("保存角色失败: " + err.message);
    } finally {
      setIsDbWriting(false);
    }
  }, [editingChar, characters, showCustomAlert, saveCharacter, setCharacters]);

  // 保存编辑中的角色卡的世界书条目
  const handleSaveLoreEntry = useCallback(async () => {
    if (!editingLoreEntry || !editingChar) return;
    if (!editingLoreEntry.content?.trim()) {
      await showCustomAlert("世界书词条叙述内容不能为空");
      return;
    }

    const nextEntries = [...(editingChar.lorebookEntries || [])];
    const newEntry = {
      ...editingLoreEntry,
      id:
        editingLoreEntry.id ||
        "le_" + Math.random().toString(36).substring(2, 9),
      keys: Array.isArray(editingLoreEntry.keys)
        ? editingLoreEntry.keys
        : typeof editingLoreEntry.keys === "string"
          ? (editingLoreEntry.keys as string)
              .split(",")
              .map((k) => k.trim())
              .filter(Boolean)
          : [],
      content: editingLoreEntry.content.trim(),
      constant: !!editingLoreEntry.constant,
      disabled: !!editingLoreEntry.disabled,
      enabled: !editingLoreEntry.disabled,
      comment: editingLoreEntry.comment || "",
      useRegex: !!editingLoreEntry.useRegex,
      addMemo: !!editingLoreEntry.addMemo,
      probability:
        editingLoreEntry.probability !== undefined
          ? Number(editingLoreEntry.probability)
          : 100,
      order:
        editingLoreEntry.order !== undefined
          ? Number(editingLoreEntry.order)
          : 100,
      position: editingLoreEntry.position || "after_char_def",
      depth:
        editingLoreEntry.depth !== undefined
          ? Number(editingLoreEntry.depth)
          : 4,
    } as LorebookEntry;

    const existingIdx = nextEntries.findIndex((e) => String(e.id) === String(newEntry.id));
    if (existingIdx >= 0) {
      nextEntries[existingIdx] = newEntry;
    } else {
      nextEntries.push(newEntry);
    }

    setEditingChar({ ...editingChar, lorebookEntries: nextEntries });
    setEditingLoreEntry(null);
  }, [editingLoreEntry, editingChar, showCustomAlert]);

  // 保存活跃角色（非编辑态）的世界书条目
  const handleSaveActiveCharLoreEntry = useCallback(async (activeCharacter: CharacterCard) => {
    if (!editingActiveCharLoreEntry || !activeCharacter) return;
    if (!editingActiveCharLoreEntry.content?.trim()) {
      await showCustomAlert("世界书词条叙述内容不能为空");
      return;
    }

    const keysArr = Array.isArray(editingActiveCharLoreEntry.keys)
      ? editingActiveCharLoreEntry.keys
      : typeof editingActiveCharLoreEntry.keys === "string"
        ? (editingActiveCharLoreEntry.keys as string)
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean)
        : [];

    const newEntry: LorebookEntry = {
      ...editingActiveCharLoreEntry,
      id:
        editingActiveCharLoreEntry.id ||
        "le_" + Math.random().toString(36).substring(2, 9),
      keys: keysArr,
      content: editingActiveCharLoreEntry.content.trim(),
      constant: !!editingActiveCharLoreEntry.constant,
      disabled: !!editingActiveCharLoreEntry.disabled,
      enabled: !editingActiveCharLoreEntry.disabled,
      comment: editingActiveCharLoreEntry.comment || "",
      useRegex: !!editingActiveCharLoreEntry.useRegex,
      addMemo: !!editingActiveCharLoreEntry.addMemo,
      probability:
        editingActiveCharLoreEntry.probability !== undefined
          ? Number(editingActiveCharLoreEntry.probability)
          : 100,
      order:
        editingActiveCharLoreEntry.order !== undefined
          ? Number(editingActiveCharLoreEntry.order)
          : 100,
      position: editingActiveCharLoreEntry.position || "after_char_def",
      depth:
        editingActiveCharLoreEntry.depth !== undefined
          ? Number(editingActiveCharLoreEntry.depth)
          : 4,
    };

    const nextEntries = [...(activeCharacter.lorebookEntries || [])];
    const existingIdx = nextEntries.findIndex((e) => e.id === newEntry.id);
    if (existingIdx >= 0) {
      nextEntries[existingIdx] = newEntry;
    } else {
      nextEntries.push(newEntry);
    }

    const updatedChar: CharacterCard = {
      ...activeCharacter,
      lorebookEntries: nextEntries,
    };

    setCharacters((prev) =>
      prev.map((c) => (c.id === updatedChar.id ? updatedChar : c))
    );
    try {
      await saveCharacter(updatedChar);
      setEditingActiveCharLoreEntry(null);
    } catch (err: any) {
      console.error("Failed to save character lore to IndexedDB:", err);
      showCustomAlert("保存设定失败: " + err.message);
    }
  }, [editingActiveCharLoreEntry, showCustomAlert, setCharacters, saveCharacter]);

  return {
    // 编辑态
    charModalOpen,
    setCharModalOpen,
    editingChar,
    setEditingChar,
    isDbWriting,
    activeLoreTab,
    setActiveLoreTab,
    editingLoreEntry,
    setEditingLoreEntry,
    expandedLoreIds,
    setExpandedLoreIds,
    editingActiveCharLoreEntry,
    setEditingActiveCharLoreEntry,
    // CRUD handlers
    handleAddNewCharacter,
    handleEditCharacter,
    handleDeleteCharacter,
    handleSaveCharacter,
    handleSaveLoreEntry,
    handleSaveActiveCharLoreEntry,
  };
};
