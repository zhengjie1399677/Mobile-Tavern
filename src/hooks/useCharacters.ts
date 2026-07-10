/**
 * 角色卡管理聚合 Hook（壳）
 *
 * 职责拆分（AGENTS.md 准则一第 6 条「面向模块化/服务化的轻量化开发」）：
 *   - useCharacterEditor     → 编辑态 + CRUD/保存 handlers
 *   - useCharacterImportExport → 导入/导出 handlers
 *
 * 本文件仅负责组合上述子 hook 并对外暴露统一返回值结构，
 * 保持外部消费者（CharactersTab 等）的导入路径与接口契约不变。
 */
import { useCharacterEditor } from "./useCharacterEditor";
import { useCharacterImportExport } from "./useCharacterImportExport";

export const useCharacters = () => {
  const editor = useCharacterEditor();
  const importExport = useCharacterImportExport();

  return {
    // 导入/导出 handlers
    handleImportCardFile: importExport.handleImportCardFile,
    handleImportSillyLorebook: importExport.handleImportSillyLorebook,
    handleExportCharacterJSON: importExport.handleExportCharacterJSON,
    handleExportCharacterPNG: importExport.handleExportCharacterPNG,
    // 编辑态
    charModalOpen: editor.charModalOpen,
    setCharModalOpen: editor.setCharModalOpen,
    editingChar: editor.editingChar,
    setEditingChar: editor.setEditingChar,
    isDbWriting: editor.isDbWriting,
    activeLoreTab: editor.activeLoreTab,
    setActiveLoreTab: editor.setActiveLoreTab,
    editingLoreEntry: editor.editingLoreEntry,
    setEditingLoreEntry: editor.setEditingLoreEntry,
    expandedLoreIds: editor.expandedLoreIds,
    setExpandedLoreIds: editor.setExpandedLoreIds,
    editingActiveCharLoreEntry: editor.editingActiveCharLoreEntry,
    setEditingActiveCharLoreEntry: editor.setEditingActiveCharLoreEntry,
    // CRUD handlers
    handleAddNewCharacter: editor.handleAddNewCharacter,
    handleEditCharacter: editor.handleEditCharacter,
    handleDeleteCharacter: editor.handleDeleteCharacter,
    handleSaveCharacter: editor.handleSaveCharacter,
    handleSaveLoreEntry: editor.handleSaveLoreEntry,
    handleSaveActiveCharLoreEntry: editor.handleSaveActiveCharLoreEntry,
  };
};
