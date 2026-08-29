import React from "react";
import { useUnifiedApp } from "../UnifiedAppContext";
import { useTranslation } from "../contexts/LanguageContext";
import { X } from "lucide-react";
import CharacterDetailTab from "./character-edit/CharacterDetailTab";
import LorebookTab from "./character-edit/LorebookTab";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "../../components/ui/dialog";
import { useMobileBackHandler } from "../hooks/useMobileBackHandler";

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
  } = useUnifiedApp((state) => ({
    charModalOpen: state.charModalOpen,
    setCharModalOpen: state.setCharModalOpen,
    editingChar: state.editingChar,
    setEditingChar: state.setEditingChar,
    activeLoreTab: state.activeLoreTab,
    setActiveLoreTab: state.setActiveLoreTab,
    editingLoreEntry: state.editingLoreEntry,
    setEditingLoreEntry: state.setEditingLoreEntry,
    expandedLoreIds: state.expandedLoreIds,
    setExpandedLoreIds: state.setExpandedLoreIds,
    showCustomConfirm: state.showCustomConfirm,
    showCustomAlert: state.showCustomAlert,
    handleSaveCharacter: state.handleSaveCharacter,
    handleSaveLoreEntry: state.handleSaveLoreEntry,
    setActiveTab: state.setActiveTab,
    safeAreas: state.safeAreas,
  }));

  const closeEditor = () => {
    setCharModalOpen(false);
    setEditingChar(null);
  };

  useMobileBackHandler(charModalOpen, () => {
    closeEditor();
    return true;
  }, 900);

  if (!charModalOpen || !editingChar) return null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) closeEditor(); }}>
      <DialogContent
        showCloseButton={false}
        className="!top-auto !bottom-0 !translate-y-0 z-[900] flex max-h-[92dvh] w-full max-w-3xl flex-col gap-0 overflow-y-auto rounded-t-2xl rounded-b-none border-x-0 border-b-0 border-t border-border bg-background p-0 shadow-2xl data-open:slide-in-from-bottom sm:!top-1/2 sm:!bottom-auto sm:!-translate-y-1/2 sm:max-h-[85dvh] sm:rounded-2xl sm:border"
      >
        {/* Modal sticky titles */}
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between sticky top-0 bg-background z-10">
          <DialogTitle className="font-bold text-foreground text-sm">
            {String(editingChar.id || "").startsWith("char_ST_")
              ? t("character_editor.modal_title_edit")
              : t("character_editor.modal_title_create")}
          </DialogTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
            aria-label={t("character_editor.cancel_button")}
            onClick={closeEditor}
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* Sub content tab for Detail Config vs Attached Worldbook */}
        <div className="flex border-b border-border/80 bg-input px-3">
          <button
            type="button"
            aria-pressed={activeLoreTab === "detail"}
            onClick={() => setActiveLoreTab("detail")}
            className={`h-8.5 py-1 px-3 text-xs font-semibold ${
              activeLoreTab === "detail"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground"
            }`}
          >
            {t("character_editor.tab_detail")}
          </button>
          <button
            type="button"
            aria-pressed={activeLoreTab === "lore"}
            onClick={() => setActiveLoreTab("lore")}
            className={`h-8.5 py-1 px-3 text-xs font-semibold ${
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
          style={{ paddingBottom: `${8 + Math.max(safeAreas?.bottom ?? 0, 8)}px` }}
          className="p-2.5 bg-input/80 border-t border-border gap-2 flex items-center justify-end sticky bottom-0 z-10"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 min-w-16 px-3 text-xs"
            onClick={closeEditor}
          >
            {t("character_editor.cancel_button")}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 min-w-16 px-3 text-xs font-semibold"
            onClick={handleSaveCharacter}
          >
            {t("character_editor.save_button")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
