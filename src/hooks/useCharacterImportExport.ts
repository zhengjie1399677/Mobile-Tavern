import React, { useCallback } from "react";
import { useApp } from "../contexts/AppContext";
import { useCharactersState } from "../contexts/CharacterContext";
import { CharacterCard, LorebookEntry } from "../types";
import { mapSillyTavernLorebookEntry, parseCharacterFile } from "../utils/cardParser";
import { catbotEventBus } from "../utils/catbotEventBus";
import { getErrorMessage, getErrorName } from '../utils/errorUtils';
import {
  generateCharacterPngBlob,
  saveBlobViaBridgeOrDownload,
} from "../utils/characterPngExporter";

/**
 * 原生 Android WebView 注入的桥接对象形状（仅声明本文件实际使用的方法子集）。
 * 完整定义见 src-tauri/plugins/android-bridge/guest-js/index.ts。
 */
interface AndroidThemeBridge {
  saveFile?: (fileName: string, content: string) => string;
}

/**
 * 扩展 Window 以访问原生注入的 AndroidThemeBridge。
 * 字段可选，反映"运行时动态挂载到 window"的真实语义。
 */
interface WindowWithAndroidBridge extends Window {
  AndroidThemeBridge?: AndroidThemeBridge;
}

/**
 * 角色卡导入/导出业务 Hook
 *
 * 从 useCharacters.ts 抽离的导入导出逻辑，保持职责单一。
 * 包含：
 *   - 卡片文件导入（SillyTavern JSON/PNG）
 *   - 世界书 JSON 导入
 *   - JSON 角色卡导出
 *   - PNG 角色卡导出（Canvas 渲染委托 characterPngExporter）
 *
 * 设计遵循 AGENTS.md 准则一第 6 条「面向模块化/服务化的轻量化开发」。
 */
export const useCharacterImportExport = () => {
  const { showCustomAlert } = useApp();
  const {
    characters,
    activeCharId,
    setCharacters,
    saveCharacter,
  } = useCharactersState();

  // 导入 SillyTavern 兼容角色卡（JSON/PNG）
  const handleImportCardFile = useCallback(async (
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
        isWorldbookGlobal: false,
        creator: parsedData.creator || "",
        creator_notes: parsedData.creator_notes || "",
        tags: parsedData.tags || [],
        character_version: parsedData.character_version || "1.0.0",
        extensions: parsedData.extensions || {},
        visualSettings: parsedData.visualSettings,
      };

      await saveCharacter(importedChar);
      catbotEventBus.emit("character_imported");
      showCustomAlert(
        `导入成功: Character Card "${importedChar.name}" 已正确就绪！`
      );
    } catch (err: unknown) {
      showCustomAlert(
        `文件解析失败: ${getErrorMessage(err)}. 请确保上传的是标度 SillyTavern 兼容格式。`
      );
    } finally {
      e.target.value = "";
    }
  }, [saveCharacter, showCustomAlert]);

  // 导入 SillyTavern 世界书 JSON
  const handleImportSillyLorebook = useCallback(async (
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

      // 与卡片内嵌世界书共用同一份映射，避免两套字段解释各自漂移。
      const importedEntries: LorebookEntry[] = rawEntries
        .map((entry: any) => mapSillyTavernLorebookEntry(entry))
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
      catbotEventBus.emit("lorebook_imported");
      showCustomAlert(
        `成功从酒馆格式 JSON 导入 ${importedEntries.length} 条世界设定到 [${updatedChar.name}]！`
      );
    } catch (err: unknown) {
      showCustomAlert("解析世界书失败，请检查文件格式。错误: " + getErrorMessage(err));
    } finally {
      e.target.value = "";
    }
  }, [activeCharId, characters, showCustomAlert, setCharacters, saveCharacter]);

  // 导出 JSON 格式角色卡
  const handleExportCharacterJSON = useCallback((char: CharacterCard) => {
    const fileName = `${char.name.replace(/\s+/g, "_")}_ST_Card.json`;
    const content = JSON.stringify(char, null, 2);

    // 原生桥接路径：Android WebView 下走 AndroidThemeBridge.saveFile
    if ((window as WindowWithAndroidBridge).AndroidThemeBridge && typeof (window as WindowWithAndroidBridge).AndroidThemeBridge?.saveFile === "function") {
      const path = (window as WindowWithAndroidBridge).AndroidThemeBridge!.saveFile!(fileName, content);
      if (path && !path.startsWith("error:")) {
        showCustomAlert(`📂 JSON 角色卡 [${char.name}] 导出成功！\n文件已保存至手机 /Download 公共文件夹下，绝对路径为：\n${path}`);
      } else {
        showCustomAlert(`❌ 导出失败：${path || "未知错误"}`);
      }
      return;
    }

    // 浏览器下载路径
    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(content);
    const dlAnchorEl = document.createElement("a");
    dlAnchorEl.setAttribute("href", dataStr);
    dlAnchorEl.setAttribute("download", fileName);
    document.body.appendChild(dlAnchorEl);
    dlAnchorEl.click();
    document.body.removeChild(dlAnchorEl);
    showCustomAlert(`JSON 角色卡 [${char.name}] 导出成功！\n文件已触发下载，请前往您的系统“下载 (Downloads)”目录查找文件名：\n${fileName}`);
  }, [showCustomAlert]);

  // 导出 PNG 格式角色卡（含 Canvas 头像渲染 + 元数据注入）
  const handleExportCharacterPNG = useCallback(async (char: CharacterCard) => {
    try {
      const blob = await generateCharacterPngBlob(char);
      const fileName = `${char.name.replace(/\s+/g, "_")}_SillyTavern.png`;

      saveBlobViaBridgeOrDownload(
        blob,
        fileName,
        "image/png",
        (path) => {
          if (path) {
            showCustomAlert(`📂 PNG 角色卡 [${char.name}] 导出成功！\n文件已保存至手机 /Download 公共文件夹下，绝对路径为：\n${path}`);
          } else {
            showCustomAlert(`PNG 角色卡 [${char.name}] 导出成功！\n文件已触发下载，请前往您的系统“下载 (Downloads)”目录查找文件名：\n${fileName}`);
          }
        },
        (errMsg) => {
          showCustomAlert(`❌ 导出失败：${errMsg}`);
        }
      );
    } catch (e: unknown) {
      console.warn("Failed to generate tavern image card:", e);
      showCustomAlert("制作精美 PNG 角色卡出错: " + getErrorMessage(e));
    }
  }, [showCustomAlert]);

  return {
    handleImportCardFile,
    handleImportSillyLorebook,
    handleExportCharacterJSON,
    handleExportCharacterPNG,
  };
};
