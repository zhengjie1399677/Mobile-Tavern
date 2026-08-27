import React, { useMemo, useState } from "react";
import { Check, Plus, Tag, Trash2, X } from "lucide-react";
import { useTranslation } from "../contexts/LanguageContext";
import type {
  MemoryFragment,
  MemoryPersistencePort,
} from "../application/services/memory/types";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "../../components/ui/dialog";
import { useMobileBackHandler } from "../hooks/useMobileBackHandler";

interface MemoryFragmentEditorProps {
  sessionId: string;
  sourceTurnEnd: number;
  fragments: MemoryFragment[];
  persistence: MemoryPersistencePort;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}

export default function MemoryFragmentEditor({
  sessionId,
  sourceTurnEnd,
  fragments,
  persistence,
  onClose,
  onChanged,
}: MemoryFragmentEditorProps) {
  const { t } = useTranslation();
  const activeFragments = useMemo(
    () => fragments.filter((fragment) => fragment.status === "active"),
    [fragments],
  );
  const [selectedId, setSelectedId] = useState<string | null>(activeFragments[0]?.id ?? null);
  const selected = activeFragments.find((fragment) => fragment.id === selectedId) ?? null;
  const [content, setContent] = useState(selected?.content ?? "");
  const [tags, setTags] = useState<string[]>(selected?.tags ?? []);
  const [newTag, setNewTag] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useMobileBackHandler(true, () => {
    onClose();
    return true;
  }, 950);

  const selectFragment = (fragment: MemoryFragment | null) => {
    setSelectedId(fragment?.id ?? null);
    setContent(fragment?.content ?? "");
    setTags(fragment?.tags ?? []);
    setError("");
  };

  const handleSave = async () => {
    const normalizedContent = content.trim();
    if (!normalizedContent || isSaving) return;
    setIsSaving(true);
    setError("");
    try {
      const now = Date.now();
      if (selected) {
        const replacement: MemoryFragment = {
          ...selected,
          id: `memory_manual_${now}_${Math.random().toString(36).slice(2, 8)}`,
          content: normalizedContent,
          tags,
          status: "active",
          supersedesId: selected.id,
          supersededById: undefined,
          createdAt: now,
          updatedAt: now,
        };
        await persistence.supersedeFragment(selected.id, replacement);
      } else {
        await persistence.upsertFragment({
          id: `memory_manual_${now}_${Math.random().toString(36).slice(2, 8)}`,
          sessionId,
          content: normalizedContent,
          participants: [],
          tags,
          sourceMessageIds: [],
          sourceRole: "assistant",
          sourceTurnStart: sourceTurnEnd,
          sourceTurnEnd,
          status: "active",
          importance: 0.6,
          confidence: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
      await onChanged();
      onClose();
    } catch (cause) {
      console.error("[MemoryFragmentEditor] Save failed", cause);
      setError(t("memory.save_failed"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected || isSaving) return;
    setIsSaving(true);
    setError("");
    try {
      await persistence.updateFragmentStatus(selected.id, "invalid");
      await onChanged();
      const next = activeFragments.find((fragment) => fragment.id !== selected.id) ?? null;
      selectFragment(next);
    } catch (cause) {
      console.error("[MemoryFragmentEditor] Invalidate failed", cause);
      setError(t("memory.delete_failed"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddTag = (event: React.FormEvent) => {
    event.preventDefault();
    const tag = newTag.trim();
    if (tag && !tags.includes(tag)) setTags([...tags, tag]);
    setNewTag("");
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="z-[1000] bg-black/65 backdrop-blur-md"
        className="!bottom-0 !top-auto z-[1000] flex max-h-[88dvh] w-full max-w-md !translate-y-0 flex-col gap-4 overflow-y-auto rounded-b-none rounded-t-2xl border border-zinc-800 bg-zinc-900/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-foreground shadow-2xl sm:!bottom-auto sm:!top-1/2 sm:!-translate-y-1/2 sm:rounded-2xl sm:p-5"
      >
        <header className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div>
            <DialogTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
              <Tag className="size-4 text-primary" aria-hidden="true" />
              {t("memory.audit_title")}
            </DialogTitle>
            <p className="mt-1 text-xs text-zinc-500">
              {t("memory.turn_label", { turn: String(sourceTurnEnd) })}
            </p>
          </div>
          <button type="button" aria-label={t("common.close")} onClick={onClose} className="flex size-11 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white">
            <X className="size-4" />
          </button>
        </header>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {activeFragments.map((fragment, index) => (
            <button
              key={fragment.id}
              onClick={() => selectFragment(fragment)}
              className={`min-h-11 shrink-0 rounded-lg border px-3 text-xs ${
                selectedId === fragment.id
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-zinc-800 bg-zinc-950/50 text-zinc-400"
              }`}
            >
              {t("memory.fragment_number", { number: String(index + 1) })}
            </button>
          ))}
          <button
            onClick={() => selectFragment(null)}
            className={`flex min-h-11 shrink-0 items-center gap-1 rounded-lg border px-3 text-xs ${
              selectedId === null
                ? "border-primary bg-primary/15 text-primary"
                : "border-zinc-800 bg-zinc-950/50 text-zinc-400"
            }`}
          >
            <Plus className="size-3.5" />
            {t("memory.new_fragment")}
          </button>
        </div>

        <label className="flex flex-col gap-1.5 text-xs font-semibold text-zinc-400">
          {t("memory.content_label")}
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className="min-h-28 w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm font-normal leading-relaxed text-zinc-200 outline-none focus:border-primary"
            placeholder={t("memory.content_placeholder")}
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-zinc-400">{t("memory.tags_label")}</span>
          <div className="flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">
            {tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 pl-2 text-xs text-primary">
                {tag}
                <button type="button" aria-label={t("memory.remove_tag", { tag })} onClick={() => setTags(tags.filter((item) => item !== tag))} className="size-8 rounded-full">
                  ×
                </button>
              </span>
            ))}
            {tags.length === 0 && <span className="text-[10px] italic text-zinc-500">{t("memory.no_tags")}</span>}
          </div>
          <form onSubmit={handleAddTag} className="flex gap-2">
            <input
              value={newTag}
              onChange={(event) => setNewTag(event.target.value)}
              placeholder={t("memory.tag_placeholder")}
              className="min-h-11 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-200 outline-none focus:border-primary"
            />
            <button type="submit" aria-label={t("memory.add_tag")} className="size-11 rounded-lg bg-zinc-800 text-zinc-200">
              <Plus className="mx-auto size-4" />
            </button>
          </form>
        </div>

        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}

        <footer className="flex items-center justify-between gap-2 border-t border-zinc-800 pt-3">
          <button
            onClick={handleDelete}
            disabled={!selected || isSaving}
            className="flex min-h-11 items-center gap-1.5 rounded-lg border border-red-900/60 bg-red-950/40 px-3 text-xs text-red-400 disabled:opacity-40"
          >
            <Trash2 className="size-3.5" />
            {t("common.delete")}
          </button>
          <button
            onClick={handleSave}
            disabled={!content.trim() || isSaving}
            className="flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-40"
          >
            <Check className="size-3.5" />
            {isSaving ? t("common.saving") : t("common.save")}
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
