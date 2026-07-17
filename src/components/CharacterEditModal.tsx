import React from "react";
import { useUnifiedApp } from "../UnifiedAppContext";
import { useTranslation } from "../contexts/LanguageContext";
import { X } from "lucide-react";
import CharacterDetailTab from "./character-edit/CharacterDetailTab";
import LorebookTab from "./character-edit/LorebookTab";

export default function CharacterEditModal() {
  const { t } = useTranslation();
  const {
    charModalOpen,
    setCharModalOpen,
    editingChar,
    setEditingChar,
    activeLoreTab,
    setActiveLoreTab,
    editingLoreEntry,
    setEditingLoreEntry,
    expandedLoreIds,
    setExpandedLoreIds,
    showCustomConfirm,
    showCustomAlert,
    handleSaveCharacter,
    handleSaveLoreEntry,
    setActiveTab,
    safeAreas,
  } = useUnifiedApp();

  if (!charModalOpen || !editingChar) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[999] flex flex-col justify-end sm:justify-center sm:items-center p-0 sm:p-4">
      <div className="bg-background border-t sm:border border-border max-h-[92%] sm:max-h-[85%] w-full sm:max-w-3xl overflow-y-auto rounded-t-2xl sm:rounded-2xl flex flex-col shadow-2xl">
        {/* Modal sticky titles */}
        <div className="p-4 border-b border-border flex items-center justify-between sticky top-0 bg-background z-10">
          <p className="font-bold text-foreground text-sm">
            {String(editingChar.id || "").startsWith("char_ST_")
              ? t("character_editor.modal_title_edit")
              : t("character_editor.modal_title_create")}
          </p>
          <button
            onClick={() => {
              setCharModalOpen(false);
              setEditingChar(null);
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sub content tab for Detail Config vs Attached Worldbook */}
        <div className="flex border-b border-border/80 bg-input px-3">
          <button
            onClick={() => setActiveLoreTab("detail")}
            className={`py-2 px-3 text-xs font-semibold ${
              activeLoreTab === "detail"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground"
            }`}
          >
            {t("character_editor.tab_detail")}
          </button>
          <button
            onClick={() => setActiveLoreTab("lore")}
            className={`py-2 px-3 text-xs font-semibold ${
              activeLoreTab === "lore"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground"
            }`}
          >
            {t("character_editor.tab_lore", { count: String(editingChar.lorebookEntries?.length || 0) })}
          </button>
        </div>

        {/* Tab: main character metadata configs */}
        {activeLoreTab === "detail" && (
          <CharacterDetailTab
            editingChar={editingChar}
            setEditingChar={setEditingChar}
            showCustomAlert={showCustomAlert}
          />
        )}

        {/* Tab: Character-bound lorebook items details entry */}
        {activeLoreTab === "lore" && (
          <LorebookTab
            editingChar={editingChar}
            setEditingChar={setEditingChar}
            editingLoreEntry={editingLoreEntry}
            setEditingLoreEntry={setEditingLoreEntry}
            expandedLoreIds={expandedLoreIds}
            setExpandedLoreIds={setExpandedLoreIds}
            showCustomConfirm={showCustomConfirm}
            handleSaveLoreEntry={handleSaveLoreEntry}
            setCharModalOpen={setCharModalOpen}
            setActiveTab={setActiveTab}
          />
        )}

        {/* Modal final saving operations */}
        <div
          style={{ paddingBottom: `${16 + Math.max(safeAreas?.bottom ?? 0, 16)}px` }}
          className="p-4 bg-input/80 border-t border-border gap-2.5 flex items-center justify-end sticky bottom-0 z-10"
        >
          <button
            onClick={() => {
              setCharModalOpen(false);
              setEditingChar(null);
            }}
            className="bg-muted text-muted-foreground hover:text-foreground px-4 py-2 rounded-lg text-xs font-semibold"
          >
            {t("character_editor.cancel_button")}
          </button>
          <button
            onClick={handleSaveCharacter}
            className="bg-primary hover:bg-primary text-primary-foreground px-5 py-2 rounded-lg text-xs font-bold"
          >
            {t("character_editor.save_button")}
          </button>
        </div>
      </div>
    </div>
  );
}
