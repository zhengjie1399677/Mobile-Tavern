import React from "react";
import { globalKernel } from "../../kernel/Kernel";
import { ICharacterService, IWorldbookService } from "../../kernel/types";
import {
  LorebookEntry,
  CharacterCard,
  CustomWorldbook,
} from "../../types";
import { mapSillyTavernLorebookEntry } from "../../utils/cardParser";

/**
 * 微内核插件式架构：业务持久化操作统一走内核服务插件，不再直接触碰 localDB。
 * 遵循 AGENTS.md 准则一「极致微服务与解耦」与准则八「AI 协作物理隔离开发铁律」。
 */
function saveCharacter(character: CharacterCard): Promise<void> {
  return globalKernel.getService<ICharacterService>("character").saveCharacter(character);
}

function saveGlobalLorebook(entries: LorebookEntry[]): Promise<void> {
  return globalKernel.getService<IWorldbookService>("worldbook").saveGlobalLorebook(entries);
}

/**
 * 内联编辑表单的状态类型。
 * 在 LorebookEntry 基础上扩展了 isGlobal / targetOwnerId 两个用于切换宿主的辅助字段。
 */
export type EditFormState = Partial<LorebookEntry> & {
  isGlobal?: boolean;
  targetOwnerId?: string;
};

export interface UseWorldbookActionsParams {
  characters: CharacterCard[];
  setCharacters: React.Dispatch<React.SetStateAction<CharacterCard[]>>;
  showCustomConfirm: (message: string, title?: string) => Promise<boolean>;
  showCustomAlert: (message: string, title?: string) => Promise<void>;
  showCustomPrompt: (
    message: string,
    defaultValue?: string,
    title?: string,
  ) => Promise<string | null>;
  globalLorebook: LorebookEntry[];
  setGlobalLorebook: React.Dispatch<React.SetStateAction<LorebookEntry[]>>;
  customWorldbooks: Record<string, CustomWorldbook>;
  updateCustomWorldbooks: (
    updater:
      | Record<string, CustomWorldbook>
      | ((prev: Record<string, CustomWorldbook>) => Record<string, CustomWorldbook>),
  ) => Promise<void>;
  activeHostId: string;
  isCustomWorldbook: boolean;
  editingId: string | null;
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>;
  editForm: EditFormState;
  setEditForm: React.Dispatch<React.SetStateAction<EditFormState>>;
  setExpandedEntryIds: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
}

/**
 * 世界书面板的业务动作集合 Hook。
 *
 * 将原 GlobalWorldbookTab 中 15 个 CRUD / 移动 / 开关 / 导入导出 handler 集中抽离，
 * 接收必要的依赖（context 数据 + 局部 state setter）作为参数，保持纯函数式数据流动。
 */
export function useWorldbookActions(params: UseWorldbookActionsParams) {
  const {
    characters,
    setCharacters,
    showCustomConfirm,
    showCustomAlert,
    showCustomPrompt,
    globalLorebook,
    setGlobalLorebook,
    customWorldbooks,
    updateCustomWorldbooks,
    activeHostId,
    isCustomWorldbook,
    editingId,
    setEditingId,
    editForm,
    setEditForm,
    setExpandedEntryIds,
  } = params;

  // 折叠 / 展开条目；编辑态下禁止折叠
  const toggleExpand = (id: string) => {
    if (editingId === id) return;
    setExpandedEntryIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // 触发关键词字符串转数组
  const parseKeys = (val: string | string[]): string[] => {
    if (Array.isArray(val)) return val;
    return val
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
  };

  // 在编辑表单或快捷下拉中直接切换条目的宿主 / 作用域
  const handleMoveScope = async (
    entry: LorebookEntry,
    fromHostId: string,
    toHostId: string,
  ) => {
    if (fromHostId === toHostId) return;

    // 标准化条目副本
    const cleanEntry: LorebookEntry = {
      id: String(entry.id),
      keys: entry.keys || [],
      content: entry.content || "",
      constant: !!entry.constant,
      disabled: !!entry.disabled,
      enabled: !entry.disabled,
      comment: entry.comment || "",
      useRegex: !!entry.useRegex,
      addMemo: !!entry.addMemo,
      probability: entry.probability !== undefined ? entry.probability : 100,
      order: entry.order !== undefined ? entry.order : 100,
      position: entry.position || "after_char_def",
      depth: entry.depth !== undefined ? entry.depth : 4,
    };

    // 1. 从源宿主删除
    let nextGlobals = [...globalLorebook];
    if (fromHostId === "global") {
      nextGlobals = nextGlobals.filter((e) => String(e.id) !== String(entry.id));
    } else {
      const srcChar = characters.find((c) => c.id === fromHostId);
      if (srcChar) {
        const nextLocals = (srcChar.lorebookEntries || []).filter(
          (e) => String(e.id) !== String(entry.id),
        );
        const updated = { ...srcChar, lorebookEntries: nextLocals };
        setCharacters((prev: CharacterCard[]) =>
          prev.map((c) => (c.id === srcChar.id ? updated : c)),
        );
        await saveCharacter(updated);
      }
    }

    // 2. 添加到目标宿主
    if (toHostId === "global") {
      if (!nextGlobals.some((e) => String(e.id) === String(entry.id))) {
        nextGlobals.push(cleanEntry);
      }
      setGlobalLorebook(nextGlobals);
      await saveGlobalLorebook(nextGlobals);
    } else {
      const destChar = characters.find((c) => c.id === toHostId);
      if (destChar) {
        const nextLocals = [...(destChar.lorebookEntries || [])];
        if (!nextLocals.some((e) => String(e.id) === String(entry.id))) {
          nextLocals.push(cleanEntry);
        }
        const updated = { ...destChar, lorebookEntries: nextLocals };
        setGlobalLorebook(nextGlobals);
        await saveGlobalLorebook(nextGlobals);
        setCharacters((prev: CharacterCard[]) =>
          prev.map((c) => (c.id === destChar.id ? updated : c)),
        );
        await saveCharacter(updated);
      }
    }

    // 重置编辑态
    setEditingId(null);
    setEditForm({});
  };

  // 在列表项内原地启动编辑
  const startInlineEdit = (entry: LorebookEntry) => {
    setEditingId(entry.id);

    // 强制防腐清洗 keys 属性，绝对防止 React 渲染输入框 value 时因为遇到 Object 发生致命崩溃
    let cleanedKeys: string[] = [];
    if (Array.isArray(entry.keys)) {
      cleanedKeys = entry.keys.map((k) =>
        typeof k === "string" ? k : String(k || ""),
      );
    } else if (typeof entry.keys === "string") {
      cleanedKeys = (entry.keys as string)
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
    } else if (entry.keys && typeof entry.keys === "object") {
      try {
        cleanedKeys = Object.values(entry.keys)
          .map((v) => String(v || ""))
          .filter(Boolean);
      } catch (e) {
        cleanedKeys = [];
      }
    }

    setEditForm({
      id: entry.id,
      comment: String(entry.comment || ""),
      keys: cleanedKeys,
      content: String(entry.content || ""),
      constant: !!entry.constant,
      disabled: entry.disabled ?? !entry.enabled,
      useRegex: !!entry.useRegex,
      addMemo: !!entry.addMemo,
      position: entry.position || "after_char_def",
      depth:
        typeof entry.depth === "number" && !isNaN(entry.depth)
          ? entry.depth
          : Number(entry.depth) || 4,
      order:
        typeof entry.order === "number" && !isNaN(entry.order)
          ? entry.order
          : Number(entry.order) || 100,
      probability:
        typeof entry.probability === "number" && !isNaN(entry.probability)
          ? entry.probability
          : Number(entry.probability) || 100,
      isGlobal: activeHostId === "global",
      targetOwnerId: activeHostId === "global" ? "" : activeHostId,
    });
    setExpandedEntryIds((prev) => ({ ...prev, [entry.id]: true }));
  };

  // 保存内联编辑结果
  const handleSaveInlineEntry = async (id: string) => {
    if (!editForm.content?.trim()) {
      await showCustomAlert("⚠️ 设定叙述内容不能为空");
      return;
    }

    const nextKeys = parseKeys(editForm.keys || []);
    const entryDataId = String(id || "").startsWith("new_inline_temp")
      ? "le_" + Math.random().toString(36).substring(2, 9)
      : String(id);

    const baseEntry: LorebookEntry = {
      id: entryDataId,
      keys: nextKeys,
      content: editForm.content.trim(),
      comment: editForm.comment || "",
      constant: !!editForm.constant,
      disabled: !!editForm.disabled,
      enabled: !editForm.disabled,
      useRegex: !!editForm.useRegex,
      addMemo: !!editForm.addMemo,
      position: editForm.position || "after_char_def",
      depth: editForm.depth !== undefined ? Number(editForm.depth) : 4,
      order: editForm.order !== undefined ? Number(editForm.order) : 100,
      probability:
        editForm.probability !== undefined ? Number(editForm.probability) : 100,
    };

    // 根据表单内选择判定目标宿主
    const isGlobalSelected =
      !!editForm.isGlobal || !characters || characters.length === 0;
    const targetHostId = isGlobalSelected
      ? "global"
      : editForm.targetOwnerId || characters[0]?.id;

    // 作用域切换 / 全新条目 / 更新条目三种分支
    if (isCustomWorldbook) {
      if (String(id || "").startsWith("new_inline_temp")) {
        const nextEntries = [
          ...(customWorldbooks[activeHostId]?.entries || []),
          baseEntry,
        ];
        updateCustomWorldbooks((prev) => ({
          ...prev,
          [activeHostId]: {
            ...prev[activeHostId],
            entries: nextEntries,
          },
        }));
      } else {
        const nextEntries = (
          customWorldbooks[activeHostId]?.entries || []
        ).map((e) =>
          String(e.id) === String(entryDataId) ? baseEntry : e,
        );
        updateCustomWorldbooks((prev) => ({
          ...prev,
          [activeHostId]: {
            ...prev[activeHostId],
            entries: nextEntries,
          },
        }));
      }
    } else if (String(id || "").startsWith("new_inline_temp")) {
      // 直接保存到目标宿主
      if (targetHostId === "global") {
        const nextGlobals = [...globalLorebook, baseEntry];
        setGlobalLorebook(nextGlobals);
        await saveGlobalLorebook(nextGlobals);
      } else {
        const targetChar = characters.find((c) => c.id === targetHostId);
        if (targetChar) {
          const nextLocals = [
            ...(targetChar.lorebookEntries || []),
            baseEntry,
          ];
          const updated = { ...targetChar, lorebookEntries: nextLocals };
          setCharacters((prev: CharacterCard[]) =>
            prev.map((c) => (c.id === targetChar.id ? updated : c)),
          );
          await saveCharacter(updated);
        }
      }
    } else {
      // 更新操作；可能切换了目标宿主
      if (activeHostId === targetHostId) {
        // 在当前宿主内简单更新
        if (activeHostId === "global") {
          const nextGlobals = globalLorebook.map((e) =>
            String(e.id) === String(entryDataId) ? baseEntry : e,
          );
          setGlobalLorebook(nextGlobals);
          await saveGlobalLorebook(nextGlobals);
        } else {
          const targetChar = characters.find((c) => c.id === activeHostId);
          if (targetChar) {
            const nextLocals = (targetChar.lorebookEntries || []).map((e) =>
              String(e.id) === String(entryDataId) ? baseEntry : e,
            );
            const updated = { ...targetChar, lorebookEntries: nextLocals };
            setCharacters((prev: CharacterCard[]) =>
              prev.map((c) => (c.id === targetChar.id ? updated : c)),
            );
            await saveCharacter(updated);
          }
        }
      } else {
        // 作用域实际发生迁移，复用 transfer 逻辑
        await handleMoveScope(baseEntry, activeHostId, targetHostId);
      }
    }

    setEditingId(null);
    setEditForm({});
  };

  const startNewInlineEntry = () => {
    const tempId = "new_inline_temp_creator";
    setEditingId(tempId);
    setEditForm({
      id: tempId,
      comment: "",
      keys: [],
      content: "",
      constant: false,
      disabled: false,
      useRegex: false,
      addMemo: false,
      position: "after_char_def",
      depth: 4,
      order: 100,
      probability: 100,
      isGlobal: activeHostId === "global",
      targetOwnerId:
        activeHostId === "global" ? characters[0]?.id || "" : activeHostId,
    });
    setExpandedEntryIds((prev) => ({ ...prev, [tempId]: true }));
  };

  const handleDeleteEntry = async (entry: LorebookEntry) => {
    const ok = await showCustomConfirm(
      `确定要删除此条世界设定 [${entry.comment || entry.keys[0] || "未命名"}] 吗？`,
    );
    if (!ok) return;

    if (activeHostId === "global") {
      const next = globalLorebook.filter(
        (e) => String(e.id) !== String(entry.id),
      );
      setGlobalLorebook(next);
      await saveGlobalLorebook(next);
    } else if (isCustomWorldbook) {
      const nextEntries = (
        customWorldbooks[activeHostId]?.entries || []
      ).filter((e) => String(e.id) !== String(entry.id));
      updateCustomWorldbooks((prev) => ({
        ...prev,
        [activeHostId]: {
          ...prev[activeHostId],
          entries: nextEntries,
        },
      }));
    } else {
      const srcChar = characters.find((c) => c.id === activeHostId);
      if (srcChar) {
        const nextLocals = (srcChar.lorebookEntries || []).filter(
          (e) => String(e.id) !== String(entry.id),
        );
        const updated = { ...srcChar, lorebookEntries: nextLocals };
        setCharacters((prev: CharacterCard[]) =>
          prev.map((c) => (c.id === srcChar.id ? updated : c)),
        );
        await saveCharacter(updated);
      }
    }
  };

  // 列表项上的快捷全局开关（滑块）
  const handleFastToggleGlobal = async (
    entry: LorebookEntry,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation(); // 阻止触发展开

    const isCurrentlyGlobal = activeHostId === "global";

    if (isCurrentlyGlobal) {
      // 关闭：从全局迁移到角色专属
      if (characters.length === 0) {
        await showCustomAlert(
          "⚠️ 无法转换为专属回路。请先在「宿体配置」中添加一个角色宿体！",
        );
        return;
      }

      let targetId = characters[0].id;
      if (characters.length > 1) {
        const charNames = characters
          .map((c, i) => `${i + 1}. ${c.name}`)
          .join("\n");
        const choice = await showCustomPrompt(
          `将该通用词条转换为专属词条，请指定绑定的角色序号 (1-${characters.length}):\n${charNames}`,
          "1",
        );
        if (!choice) return;
        const idx = parseInt(choice, 10) - 1;
        if (idx >= 0 && idx < characters.length) {
          targetId = characters[idx].id;
        } else {
          await showCustomAlert("❌ 无效的序号，转换取消");
          return;
        }
      }

      await handleMoveScope(entry, "global", targetId);
    } else {
      // 开启：从当前角色迁移到全局
      const ok = await showCustomConfirm(
        `确定要将词条 [${entry.comment || entry.keys[0] || "未命名"}] 移至「🌎 全局常驻共用词库」吗？转换后所有角色对话都将共享它。`,
      );
      if (!ok) return;
      await handleMoveScope(entry, activeHostId, "global");
    }
  };

  const handleToggleCharacterWorldbookGlobal = async (char: CharacterCard) => {
    const isGlobal = !char.isWorldbookGlobal;
    const updated = { ...char, isWorldbookGlobal: isGlobal };
    setCharacters((prev: CharacterCard[]) =>
      prev.map((c) => (c.id === char.id ? updated : c)),
    );
    await saveCharacter(updated);
  };

  const handleCreateCustomWorldbook = async () => {
    const name = await showCustomPrompt("请输入新设定集的名称:", "新设定集");
    if (!name || !name.trim()) return;
    const newId = "custom-" + Math.random().toString(36).substring(2, 9);
    const newWorldbook = {
      id: newId,
      name: name.trim(),
      entries: [],
      enabled: true,
    };
    updateCustomWorldbooks((prev) => ({
      ...prev,
      [newId]: newWorldbook,
    }));
    await showCustomAlert(`成功创建独立设定集: ${name.trim()}`);
  };

  const handleDeleteCustomWorldbook = async (id: string, name: string) => {
    const ok = await showCustomConfirm(
      `确定要永久删除独立设定集 "${name}" 吗？(该操作无法撤销)`,
    );
    if (!ok) return;
    updateCustomWorldbooks((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    await showCustomAlert(`已成功删除独立设定集: ${name}`);
  };

  // 导入世界书到当前选中的 activeHostId 作用域（全局或角色专属）
  const handleImportLorebookJSON = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

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
        await showCustomAlert(
          "无有效设定词条。请确保该 JSON 是 SillyTavern 兼容标准的 World Info 世界书。",
        );
        return;
      }

      const importedEntries: LorebookEntry[] = rawEntries
        .map(mapSillyTavernLorebookEntry)
        .filter((e) => e.content);

      if (importedEntries.length === 0) {
        await showCustomAlert("没有找到任何有效的设定句。");
        return;
      }

      if (activeHostId === "list") {
        await showCustomAlert(
          "请先点击进入一个记忆回路（全局或角色），再进行导入。",
        );
        return;
      } else if (activeHostId === "global") {
        const nextGlobals = [...globalLorebook, ...importedEntries];
        setGlobalLorebook(nextGlobals);
        await saveGlobalLorebook(nextGlobals);
        await showCustomAlert(
          `成功导入 ${importedEntries.length} 条设定到【全局共享词库】！`,
        );
      } else if (isCustomWorldbook) {
        const nextEntries = [
          ...(customWorldbooks[activeHostId]?.entries || []),
          ...importedEntries,
        ];
        updateCustomWorldbooks((prev) => ({
          ...prev,
          [activeHostId]: {
            ...prev[activeHostId],
            entries: nextEntries,
          },
        }));
        await showCustomAlert(
          `成功导入 ${importedEntries.length} 条设定到自定义设定集【${customWorldbooks[activeHostId].name}】！`,
        );
      } else {
        const targetChar = characters.find((c) => c.id === activeHostId);
        if (targetChar) {
          const nextLocals = [
            ...(targetChar.lorebookEntries || []),
            ...importedEntries,
          ];
          const updated = { ...targetChar, lorebookEntries: nextLocals };
          setCharacters((prev: CharacterCard[]) =>
            prev.map((c) => (c.id === targetChar.id ? updated : c)),
          );
          await saveCharacter(updated);
          await showCustomAlert(
            `成功导入 ${importedEntries.length} 条设定到【${targetChar.name}】的专属角色词库！`,
          );
        } else {
          await showCustomAlert(
            "❌ 未找到当前导入的目标容器。请返回宿体名录选择一个目标进入后再试。",
          );
        }
      }
    } catch (err: any) {
      await showCustomAlert(
        "解析世界书失败，请检查文件格式。错误: " + err.message,
      );
    } finally {
      e.target.value = "";
    }
  };

  // 导出当前世界书（全局或当前激活角色绑定的条目列表）
  const handleExportLorebookJSON = async () => {
    let entriesToExport = [];
    let fileName = "worldbook-export.json";

    if (activeHostId === "global") {
      entriesToExport = globalLorebook || [];
      fileName = "global-worldbook.json";
    } else if (isCustomWorldbook) {
      entriesToExport = customWorldbooks[activeHostId]?.entries || [];
      fileName = `${customWorldbooks[activeHostId]?.name || "custom"}-worldbook.json`;
    } else {
      const char = characters.find((c) => c.id === activeHostId);
      if (char) {
        entriesToExport = char.lorebookEntries || [];
        fileName = `${char.name}-worldbook.json`;
      }
    }

    if (!entriesToExport || entriesToExport.length === 0) {
      await showCustomAlert("📭 当前设定集为空，无需导出。");
      return;
    }

    // 包装为标准 Tavern worldbook 格式
    const payload = {
      entries: entriesToExport,
    };
    const content = JSON.stringify(payload, null, 2);

    // 在 Android 环境通过原生桥接保存
    if (
      (window as any).AndroidThemeBridge &&
      typeof (window as any).AndroidThemeBridge.saveFile === "function"
    ) {
      const path = (window as any).AndroidThemeBridge.saveFile(
        fileName,
        content,
      );
      if (path && !path.startsWith("error:")) {
        await showCustomAlert(
          `📂 世界书导出成功！\n文件已保存至手机 /Download 公共文件夹下，绝对路径为：\n${path}`,
        );
      } else {
        await showCustomAlert(`❌ 导出失败：${path || "未知错误"}`);
      }
      return;
    }

    const blob = new Blob([content], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    await showCustomAlert(
      `📂 世界书导出成功！\n文件已触发下载，请前往您的系统“下载 (Downloads)”目录查找文件名：\n${fileName}`,
    );
  };

  return {
    toggleExpand,
    parseKeys,
    handleMoveScope,
    startInlineEdit,
    handleSaveInlineEntry,
    startNewInlineEntry,
    handleDeleteEntry,
    handleFastToggleGlobal,
    handleToggleCharacterWorldbookGlobal,
    handleCreateCustomWorldbook,
    handleDeleteCustomWorldbook,
    handleImportLorebookJSON,
    handleExportLorebookJSON,
  };
}
