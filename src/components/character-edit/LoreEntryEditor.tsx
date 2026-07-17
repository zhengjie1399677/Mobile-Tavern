import { LorebookEntry } from "../../types";
import { useTranslation } from "../../contexts/LanguageContext";

export interface LoreEntryEditorProps {
  editingLoreEntry: Partial<LorebookEntry> | null;
  setEditingLoreEntry: (entry: Partial<LorebookEntry> | null) => void;
  handleSaveLoreEntry: () => void;
}

export default function LoreEntryEditor({
  editingLoreEntry,
  setEditingLoreEntry,
  handleSaveLoreEntry,
}: LoreEntryEditorProps) {
  const { t } = useTranslation();
  if (!editingLoreEntry) return null;
  return (
    <div className="space-y-3 text-xs bg-muted/20 p-3 rounded-lg border border-border">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1 font-bold">
            {t("lore_editor.label_comment")}
          </label>
          <input
            type="text"
            placeholder={t("lore_editor.placeholder_comment")}
            value={editingLoreEntry.comment || ""}
            onChange={(e) =>
              setEditingLoreEntry({
                ...editingLoreEntry,
                comment: e.target.value,
              })
            }
            className="w-full bg-input border border-border rounded p-1.5 text-foreground text-xs font-semibold outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1 font-bold">
            {t("lore_editor.label_keys")}
          </label>
          <input
            type="text"
            placeholder={t("lore_editor.placeholder_keys")}
            value={
              editingLoreEntry.keys
                ? Array.isArray(editingLoreEntry.keys)
                  ? editingLoreEntry.keys.join(",")
                  : (editingLoreEntry.keys as unknown as string)
                : ""
            }
            onChange={(e) =>
              setEditingLoreEntry({
                ...editingLoreEntry,
                keys: e.target.value as unknown as string[],
              })
            }
            className="w-full bg-input border border-border rounded p-1.5 text-foreground text-xs font-semibold outline-none focus:border-primary"
          />
        </div>
      </div>
      <div>
        <label className="block text-[10px] text-muted-foreground mb-1 font-bold">
          {t("lore_editor.label_content")}
        </label>
        <textarea
          placeholder={t("lore_editor.placeholder_content")}
          rows={6}
          value={editingLoreEntry.content || ""}
          onChange={(e) =>
            setEditingLoreEntry({
              ...editingLoreEntry,
              content: e.target.value,
            })
          }
          className="w-full bg-input border border-border rounded p-2 text-foreground text-sm leading-relaxed outline-none focus:border-primary resize-y font-medium"
        />
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 p-1.5 bg-muted/20 border border-border/20 rounded">
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!!editingLoreEntry.useRegex}
            onChange={(e) =>
              setEditingLoreEntry({
                ...editingLoreEntry,
                useRegex: e.target.checked,
              })
            }
            className="accent-primary"
          />
          <span>{t("lore_editor.checkbox_regex")}</span>
        </label>
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!!editingLoreEntry.addMemo}
            onChange={(e) =>
              setEditingLoreEntry({
                ...editingLoreEntry,
                addMemo: e.target.checked,
              })
            }
            className="accent-primary"
          />
          <span>{t("lore_editor.checkbox_memo")}</span>
        </label>
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!!editingLoreEntry.constant}
            onChange={(e) =>
              setEditingLoreEntry({
                ...editingLoreEntry,
                constant: e.target.checked,
              })
            }
            className="accent-primary"
          />
          <span>{t("lore_editor.checkbox_constant")}</span>
        </label>
        <label className="flex items-center gap-1 text-[10px] text-rose-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!!editingLoreEntry.disabled}
            onChange={(e) =>
              setEditingLoreEntry({
                ...editingLoreEntry,
                disabled: e.target.checked,
              })
            }
            className="accent-primary"
          />
          <span className="font-semibold">{t("lore_editor.checkbox_disabled")}</span>
        </label>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
        <div>
          <label className="block text-muted-foreground mb-0.5">
            {t("lore_editor.label_position")}
          </label>
          <select
            value={editingLoreEntry.position || "after_char_def"}
            onChange={(e) =>
              setEditingLoreEntry({
                ...editingLoreEntry,
                position: e.target.value as LorebookEntry["position"],
              })
            }
            className="w-full bg-input border border-border rounded p-1 text-foreground"
          >
            <option value="after_char_def">{t("lore_editor.position_after_char")}</option>
            <option value="before_char_def">{t("lore_editor.position_before_char")}</option>
            <option value="top">{t("lore_editor.position_top")}</option>
            <option value="before_last_mes">{t("lore_editor.position_before_last")}</option>
            <option value="in_chat">{t("lore_editor.position_in_chat")}</option>
          </select>
        </div>
        <div>
          <label className="block text-muted-foreground mb-0.5">
            {t("lore_editor.label_depth")}
          </label>
          <input
            type="number"
            value={
              editingLoreEntry.depth !== undefined
                ? editingLoreEntry.depth
                : 4
            }
            onChange={(e) =>
              setEditingLoreEntry({
                ...editingLoreEntry,
                depth: Number(e.target.value),
              })
            }
            className="w-full bg-input border border-border rounded p-1 text-foreground font-semibold"
          />
        </div>
        <div>
          <label className="block text-muted-foreground mb-0.5">
            {t("lore_editor.label_order")}
          </label>
          <input
            type="number"
            value={
              editingLoreEntry.order !== undefined
                ? editingLoreEntry.order
                : 100
            }
            onChange={(e) =>
              setEditingLoreEntry({
                ...editingLoreEntry,
                order: Number(e.target.value),
              })
            }
            className="w-full bg-input border border-border rounded p-1 text-foreground font-semibold"
          />
        </div>
        <div>
          <label className="block text-muted-foreground mb-0.5">
            {t("lore_editor.label_probability")}
          </label>
          <input
            type="number"
            value={
              editingLoreEntry.probability !== undefined
                ? editingLoreEntry.probability
                : 100
            }
            onChange={(e) =>
              setEditingLoreEntry({
                ...editingLoreEntry,
                probability: Number(e.target.value),
              })
            }
            className="w-full bg-input border border-border rounded p-1 text-foreground font-semibold"
          />
        </div>
      </div>

      <div className="flex justify-end gap-1.5 pt-1 border-t border-border/30">
        <button
          onClick={() => setEditingLoreEntry(null)}
          type="button"
          className="bg-muted px-3 py-1 text-muted-foreground hover:text-foreground rounded text-[11px] font-semibold transition"
        >
          {t("lore_editor.cancel")}
        </button>
        <button
          onClick={handleSaveLoreEntry}
          disabled={!editingLoreEntry.content?.trim()}
          type="button"
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-3.5 py-1 rounded text-[11px] transition shadow-sm"
        >
          {t("lore_editor.save")}
        </button>
      </div>
    </div>
  );
}
