import {
  Sparkles,
  Book,
  Hash,
  ChevronUp,
  ChevronDown,
  Edit2,
  Trash2,
  X,
} from "lucide-react";
import { CharacterCard, LorebookEntry } from "../../types";
import { useTranslation } from "../../contexts/LanguageContext";
import LoreEntryEditor from "./LoreEntryEditor";

export interface LorebookTabProps {
  editingChar: Partial<CharacterCard>;
  setEditingChar: (char: Partial<CharacterCard> | null) => void;
  editingLoreEntry: Partial<LorebookEntry> | null;
  setEditingLoreEntry: (entry: Partial<LorebookEntry> | null) => void;
  expandedLoreIds: Record<string, boolean>;
  setExpandedLoreIds: (
    updater:
      | Record<string, boolean>
      | ((prev: Record<string, boolean>) => Record<string, boolean>)
  ) => void;
  showCustomConfirm: (msg: string) => Promise<boolean>;
  handleSaveLoreEntry: () => void;
  setCharModalOpen: (open: boolean) => void;
  setActiveTab: (tab: string) => void;
}

export default function LorebookTab({
  editingChar,
  setEditingChar,
  editingLoreEntry,
  setEditingLoreEntry,
  expandedLoreIds,
  setExpandedLoreIds,
  showCustomConfirm,
  handleSaveLoreEntry,
  setCharModalOpen,
  setActiveTab,
}: LorebookTabProps) {
  const { t } = useTranslation();
  return (
    <div className="p-4 space-y-4 text-xs animate-fadeIn">
      {/* Visual upgrade Callout Banner */}
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 space-y-1.5 shadow-sm text-foreground">
        <div className="flex items-center gap-1.5 font-bold text-primary text-xs">
          <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
          {t("lorebook_tab.upgrade_title")}
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed font-light">
          {t("lorebook_tab.upgrade_desc")}
        </p>
        <button
          onClick={() => {
            setCharModalOpen(false);
            setEditingChar(null);
            setEditingLoreEntry(null);
            setActiveTab("global-worldbook");
          }}
          type="button"
          className="text-[10.5px] text-primary hover:underline font-bold flex items-center gap-1 mt-1 font-mono transition"
        >
          {t("lorebook_tab.goto_worldbook")}
        </button>
      </div>

      {/* Inline creator toggle button */}
      {(!editingLoreEntry ||
        !String(editingLoreEntry.id || "").startsWith("new_temp_")) && (
        <button
          onClick={() => {
            setEditingLoreEntry({
              id:
                "new_temp_" +
                Math.random().toString(36).substring(2, 9),
              keys: [],
              content: "",
              comment: "",
              constant: false,
              disabled: false,
              useRegex: false,
              addMemo: false,
              position: "after_char_def",
              depth: 4,
              order: 100,
              probability: 100,
            });
          }}
          type="button"
          className="w-full py-2 bg-muted/20 border border-dashed border-border hover:border-primary text-muted-foreground hover:text-primary rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition"
        >
          {t("lorebook_tab.new_entry")}
        </button>
      )}

      {/* Inline Creation Card Block at the top of list */}
      {editingLoreEntry &&
        String(editingLoreEntry.id || "").startsWith("new_temp_") && (
          <div className="bg-card p-3 rounded-lg border border-primary/40 space-y-3 shadow animate-fadeIn">
            <div className="flex items-center justify-between border-b border-border/60 pb-1 text-xs">
              <span className="font-bold text-primary">
                {t("lorebook_tab.new_entry_card_title")}
              </span>
              <button
                onClick={() => setEditingLoreEntry(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <LoreEntryEditor
              editingLoreEntry={editingLoreEntry}
              setEditingLoreEntry={setEditingLoreEntry}
              handleSaveLoreEntry={handleSaveLoreEntry}
            />
          </div>
        )}

      {/* Bound Lore Entry list */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-1">
          <span className="font-bold text-foreground flex items-center gap-1.5">
            <Book className="w-3.5 h-3.5" /> {t("lorebook_tab.entry_list_title", { count: String(editingChar.lorebookEntries?.length || 0) })}
          </span>
        </div>

        {editingChar.lorebookEntries?.map((entry, idx) => {
          const entryKey = entry.id || `lore-${idx}`;
          const isExpanded = !!expandedLoreIds[entryKey];
          const isEditingThis =
            editingLoreEntry && editingLoreEntry.id === entry.id;
          const entryName =
            entry.comment ||
            (Array.isArray(entry.keys) && entry.keys.length > 0
              ? entry.keys.slice(0, 3).join(", ")
              : typeof entry.keys === "string" && entry.keys
                ? entry.keys
                : "") ||
            t("lorebook_tab.unnamed_entry");

          return (
            <div
              key={entryKey}
              className={`bg-card rounded-xl border text-xs transition-all duration-200 ${
                isEditingThis
                  ? "border-primary ring-1 ring-primary/40 shadow-sm"
                  : entry.disabled
                    ? "border-dashed border-red-900/10 bg-red-950/2 opacity-60"
                    : isExpanded
                      ? "border-primary/40 text-foreground bg-muted/5"
                      : "border-border/80 hover:border-border"
              }`}
            >
              {/* Compact Header */}
              <div
                onClick={() =>
                  setExpandedLoreIds((prev: any) => ({
                    ...prev,
                    [entryKey]: !prev[entryKey],
                  }))
                }
                className="p-3 flex items-center justify-between cursor-pointer select-none gap-2"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-muted-foreground shrink-0 text-sm text-primary/70">
                    <Hash className="w-4 h-4" />
                  </span>
                  <span className="font-semibold text-foreground truncate max-w-[180px] md:max-w-[320px]">
                    {entryName}
                  </span>

                  {/* Short indicators/badges */}
                  <div className="flex items-center gap-1 shrink-0 scale-90">
                    {entry.constant && (
                      <span className="bg-emerald-950/25 text-emerald-400 border border-emerald-900/15 px-1 py-0.2 rounded text-[9px]">
                        {t("lorebook_tab.badge_constant")}
                      </span>
                    )}
                    {entry.disabled && (
                      <span className="bg-rose-950/25 text-rose-400 border border-rose-900/15 px-1 py-0.2 rounded text-[9px]">
                        {t("lorebook_tab.badge_disabled")}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 text-muted-foreground shrink-0 text-[10px]">
                  {entry.keys &&
                    entry.keys.length > 0 &&
                    t("lorebook_tab.trigger_word_count", { count: String(entry.keys.length) })}
                  {isExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </div>
              </div>

              {/* Collapsible Content */}
              {isExpanded && (
                <div className="px-3.5 pb-3.5 pt-1 border-t border-border/40 space-y-3 animate-fadeIn text-xs">
                  {!isEditingThis ? (
                    <>
                      {/* Meta row details */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-muted/20 p-2 rounded text-[10px] text-muted-foreground font-mono">
                        <div>
                          <span className="text-muted-foreground/75">
                            {t("lorebook_tab.meta_keys")}{" "}
                          </span>
                          <span className="text-foreground font-semibold">
                            {Array.isArray(entry.keys) && entry.keys.length > 0
                              ? entry.keys.join(", ")
                              : typeof entry.keys === "string" && (entry.keys as string).trim()
                                ? entry.keys
                                : t("lorebook_tab.none")}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground/75">
                            {t("lorebook_tab.meta_position")}{" "}
                          </span>
                          <span className="text-foreground font-semibold">
                            {entry.position === "after_char_def"
                              ? t("lorebook_tab.position_after")
                              : entry.position === "before_char_def"
                                ? t("lorebook_tab.position_before")
                                : t("lorebook_tab.position_top")}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground/75">
                            {t("lorebook_tab.meta_depth_weight")}{" "}
                          </span>
                          <span className="text-foreground font-semibold">
                            {entry.depth !== undefined ? entry.depth : 4}{" "}
                            / {entry.order !== undefined ? entry.order : 100}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground/75">
                            {t("lorebook_tab.meta_probability_regex")}{" "}
                          </span>
                          <span className="text-foreground font-semibold">
                            {entry.probability !== undefined
                              ? entry.probability
                              : 100}
                            % / {entry.useRegex ? "是" : "否"}
                          </span>
                        </div>
                      </div>

                      {/* Content description view */}
                      <div className="space-y-1">
                        <span className="block text-[10px] text-muted-foreground font-medium">
                          {t("lorebook_tab.label_content")}
                        </span>
                        <p
                          className={`font-light leading-relaxed whitespace-pre-wrap rounded-lg bg-muted/40 p-2 border border-border/30 text-[11px] ${
                            entry.disabled
                              ? "line-through text-muted-foreground/50"
                              : "text-muted-foreground"
                          }`}
                        >
                          {entry.content}
                        </p>
                      </div>

                      {/* Bottom actions row */}
                      <div className="flex items-center justify-between pt-1 border-t border-border/30">
                        <span className="text-[10px] text-muted-foreground">
                          {entry.addMemo ? t("lorebook_tab.label_memo") : ""}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingLoreEntry({
                                ...entry,
                                disabled: entry.disabled ?? !entry.enabled,
                              });
                            }}
                            type="button"
                            className="text-[11px] bg-primary/15 hover:bg-primary hover:text-primary-foreground text-primary border border-primary/25 px-2.5 py-1 rounded-md flex items-center gap-1 font-semibold transition"
                          >
                            <Edit2 className="w-3 h-3" /> {t("lorebook_tab.edit_inline")}
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              const ok = await showCustomConfirm(
                                t("lorebook_tab.confirm_delete")
                              );
                              if (ok) {
                                const next = (
                                  editingChar.lorebookEntries || []
                                ).filter((g) => String(g.id) !== String(entry.id));
                                setEditingChar({
                                  ...editingChar,
                                  lorebookEntries: next,
                                });
                              }
                            }}
                            type="button"
                            className="text-[11px] bg-rose-950/20 hover:bg-rose-950/45 text-red-400 border border-thin border-rose-900/35 px-2.5 py-1 rounded-md flex items-center gap-1 transition"
                          >
                            <Trash2 className="w-3 h-3" /> {t("lorebook_tab.delete")}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    /* Active inline editor inside local list card item */
                    <div className="space-y-3 pt-1.5 animate-fadeIn">
                      <LoreEntryEditor
                        editingLoreEntry={editingLoreEntry}
                        setEditingLoreEntry={setEditingLoreEntry}
                        handleSaveLoreEntry={handleSaveLoreEntry}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {(!editingChar.lorebookEntries ||
          editingChar.lorebookEntries.length === 0) && (
          <div className="text-center py-8 text-muted-foreground border border-dashed border-border/80 rounded-xl bg-muted/5 italic">
            {t("lorebook_tab.empty_state")}
          </div>
        )}
      </div>
    </div>
  );
}
