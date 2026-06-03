import React, { useState } from "react";
import { useApp } from "../contexts/AppContext";
import { useCharactersState } from "../contexts/CharacterContext";
import { CharacterCard, LorebookEntry } from "../types";
import { parseCharacterFile, injectPngMetadata } from "../utils/cardParser";

export const useCharacters = () => {
  const { showCustomAlert, showCustomConfirm } = useApp();
  const {
    characters,
    setCharacters,
    activeCharId,
    setActiveCharId,
    saveCharacter,
    deleteCharacter,
  } = useCharactersState();

  // Local states for editing character cards
  const [charModalOpen, setCharModalOpen] = useState(false);
  const [editingChar, setEditingChar] = useState<Partial<CharacterCard> | null>(null);
  const [isDbWriting, setIsDbWriting] = useState(false);
  const [activeLoreTab, setActiveLoreTab] = useState<"detail" | "lore">("detail");
  const [editingLoreEntry, setEditingLoreEntry] = useState<Partial<LorebookEntry> | null>(null);
  const [expandedLoreIds, setExpandedLoreIds] = useState<Record<string, boolean>>({});
  const [editingActiveCharLoreEntry, setEditingActiveCharLoreEntry] = useState<Partial<LorebookEntry> | null>(null);

  const handleAddNewCharacter = () => {
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
    });
    setActiveLoreTab("detail");
    setCharModalOpen(true);
  };

  const handleEditCharacter = (char: CharacterCard) => {
    setEditingChar({ ...char });
    setActiveLoreTab("detail");
    setCharModalOpen(true);
  };

  const handleDeleteCharacter = async (
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
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        await deleteCharacter(id);
        // Clean sessions associated too
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
  };

  const handleSaveCharacter = async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
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
      setCharModalOpen(false);
      setEditingChar(null);
    } catch (err: any) {
      console.error("Failed to save character to IndexedDB:", err);
      showCustomAlert("保存角色失败: " + err.message);
    } finally {
      setIsDbWriting(false);
    }
  };

  const handleSaveLoreEntry = async () => {
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

    const existingIdx = nextEntries.findIndex((e) => e.id === newEntry.id);
    if (existingIdx >= 0) {
      nextEntries[existingIdx] = newEntry;
    } else {
      nextEntries.push(newEntry);
    }

    setEditingChar({ ...editingChar, lorebookEntries: nextEntries });
    setEditingLoreEntry(null);
  };

  const handleSaveActiveCharLoreEntry = async (activeCharacter: CharacterCard) => {
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
  };

  const handleImportCardFile = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const parsedData = await parseCharacterFile(file);
      const importedChar: CharacterCard = {
        id: "char_ST_" + Math.random().toString(36).substring(2, 9),
        name: parsedData.name || "导入角色",
        avatar: parsedData.avatar || "",
        description: parsedData.description || "",
        personality: parsedData.personality || "",
        scenario: parsedData.scenario || "",
        first_mes: parsedData.first_mes || "",
        mes_example: parsedData.mes_example || "",
        system_prompt: parsedData.system_prompt || "",
        post_history_instructions: parsedData.post_history_instructions || "",
        alternate_greetings: parsedData.alternate_greetings || [],
        lorebookEntries: parsedData.lorebookEntries || [],
        creator: parsedData.creator || "",
        creator_notes: parsedData.creator_notes || "",
        tags: parsedData.tags || [],
        character_version: parsedData.character_version || "1.0.0",
        extensions: parsedData.extensions || {},
      };

      await saveCharacter(importedChar);
      showCustomAlert(
        `导入成功: Character Card "${importedChar.name}" 已正确就绪！`
      );
    } catch (err: any) {
      showCustomAlert(
        `文件解析失败: ${err.message}. 请确保上传的是标度 SillyTavern 兼容格式。`
      );
    } finally {
      e.target.value = "";
    }
  };

  const handleImportSillyLorebook = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!activeCharId) {
      showCustomAlert("请先选择或切换到对应的活跃AI角色。");
      return;
    }
    const currentActiveChar = characters.find((c) => c.id === activeCharId);
    if (!currentActiveChar) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      let rawEntries: any[] = [];
      if (Array.isArray(parsed)) {
        rawEntries = parsed;
      } else if (parsed.entries) {
        if (Array.isArray(parsed.entries)) {
          rawEntries = parsed.entries;
        } else if (typeof parsed.entries === "object") {
          rawEntries = Object.values(parsed.entries);
        }
      } else if (parsed.data?.character_book?.entries) {
        rawEntries = parsed.data.character_book.entries;
      } else if (parsed.character_book?.entries) {
        rawEntries = parsed.character_book.entries;
      } else {
        showCustomAlert(
          "无有效设定词条。请确保该 JSON 是 SillyTavern 兼容标准的 World Info 世界书。"
        );
        return;
      }

      const importedEntries: LorebookEntry[] = rawEntries
        .map((entry: any) => {
          const keysArr: string[] = Array.isArray(entry.keys)
            ? entry.keys
            : Array.isArray(entry.key)
              ? entry.key
              : (entry.key || entry.keys || "")
                  .split(",")
                  .map((k: string) => k.trim())
                  .filter(Boolean);

          let stPosition = entry.position !== undefined ? entry.position : entry.placement;
          let position: "top" | "after_char_def" | "before_char_def" | "before_last_mes" | "in_chat" = "after_char_def";
          if (stPosition !== undefined) {
            const numPos = Number(stPosition);
            if (!isNaN(numPos)) {
              switch (numPos) {
                case 0: position = "before_char_def"; break;
                case 1: position = "after_char_def"; break;
                case 2: position = "after_char_def"; break;
                case 3: position = "after_char_def"; break;
                case 4: position = "in_chat"; break;
                default: position = "after_char_def"; break;
              }
            } else if (typeof stPosition === "string") {
              const strPos = stPosition as string;
              if (strPos === "top" || strPos === "after_char_def" || strPos === "before_char_def" || strPos === "before_last_mes" || strPos === "in_chat") {
                position = strPos;
              } else {
                position = "after_char_def";
              }
            }
          }

          let depth = entry.depth !== undefined ? Number(entry.depth) : 4;
          let order = entry.order !== undefined ? Number(entry.order) : 100;
          let probability = entry.probability !== undefined ? Number(entry.probability) : 100;
          let addMemo = !!entry.addMemo;

          const extensions = entry.extensions || {};
          if (extensions.position !== undefined) {
            const numExtPos = Number(extensions.position);
            if (!isNaN(numExtPos)) {
              switch (numExtPos) {
                case 0: position = "before_char_def"; break;
                case 1: position = "after_char_def"; break;
                case 2: position = "after_char_def"; break;
                case 3: position = "after_char_def"; break;
                case 4: position = "in_chat"; break;
                default: position = "after_char_def"; break;
              }
            }
          }
          if (extensions.depth !== undefined) depth = Number(extensions.depth);

          return {
            id: "import_wi_" + Math.random().toString(36).substring(2, 9),
            keys: keysArr,
            content: entry.content || entry.value || "",
            constant: !!(entry.constant || entry.constant_active),
            enabled: entry.enabled !== false,
            comment: entry.comment || "",
            position,
            depth,
            order,
            probability,
            addMemo,
          };
        })
        .filter((e) => e.content);

      if (importedEntries.length === 0) {
        showCustomAlert("没有找到任何有效的设定句。");
        return;
      }

      const updatedEntries = [
        ...(currentActiveChar.lorebookEntries || []),
        ...importedEntries,
      ];
      const updatedChar = {
        ...currentActiveChar,
        lorebookEntries: updatedEntries,
      };

      setCharacters((prev) =>
        prev.map((c) => (c.id === updatedChar.id ? updatedChar : c))
      );
      await saveCharacter(updatedChar);
      showCustomAlert(
        `成功从酒馆格式 JSON 导入 ${importedEntries.length} 条世界设定到 [${updatedChar.name}]！`
      );
    } catch (err: any) {
      showCustomAlert("解析世界书失败，请检查文件格式。错误: " + err.message);
    } finally {
      e.target.value = "";
    }
  };

  const handleExportCharacterJSON = (char: CharacterCard) => {
    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(char, null, 2));
    const dlAnchorEl = document.createElement("a");
    dlAnchorEl.setAttribute("href", dataStr);
    dlAnchorEl.setAttribute(
      "download",
      `${char.name.replace(/\s+/g, "_")}_ST_Card.json`
    );
    document.body.appendChild(dlAnchorEl);
    dlAnchorEl.click();
    document.body.removeChild(dlAnchorEl);
    showCustomAlert(`JSON 角色卡 [${char.name}] 导出成功！`);
  };

  const handleExportCharacterPNG = async (char: CharacterCard) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 400;
      canvas.height = 400;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#1e1e2e";
      ctx.fillRect(0, 0, 400, 400);

      if (char.avatar) {
        const img = new Image();
        if (!char.avatar.startsWith("data:")) {
          img.crossOrigin = "anonymous";
        }
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = char.avatar || "";
        });
        ctx.drawImage(img, 0, 0, 400, 400);
      } else {
        ctx.fillStyle = "#cdd6f4";
        ctx.font = "bold 28px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(char.name, 200, 200);
      }

      const rawBlob: Blob = await new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b!), "image/png");
      });

      const arrayBuffer = await rawBlob.arrayBuffer();
      const modifiedBlob = injectPngMetadata(arrayBuffer, char);

      const downloadUrl = URL.createObjectURL(modifiedBlob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `${char.name.replace(/\s+/g, "_")}_SillyTavern.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);
      showCustomAlert(`PNG 角色卡 [${char.name}] 导出成功！`);
    } catch (e: any) {
      console.warn("Failed to generate tavern image card:", e);
      showCustomAlert("制作精美 PNG 角色卡出错: " + e.message);
    }
  };

  return {
    handleImportCardFile,
    handleImportSillyLorebook,
    handleExportCharacterJSON,
    handleExportCharacterPNG,
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
    handleAddNewCharacter,
    handleEditCharacter,
    handleDeleteCharacter,
    handleSaveCharacter,
    handleSaveLoreEntry,
    handleSaveActiveCharLoreEntry,
  };
};
