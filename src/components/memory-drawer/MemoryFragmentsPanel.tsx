import React, { useCallback, useEffect, useState } from "react";
import { Ban, Check, History, Pencil, RotateCcw, X } from "lucide-react";
import type { ChatSession } from "../../types";
import type { MemoryFragment } from "../../kernel/services/memory/types";
import type { MemoryServiceTyped } from "../../kernel/services/memory";
import { useUnifiedApp } from "../../UnifiedAppContext";
import { useTranslation } from "../../contexts/LanguageContext";

interface MemoryFragmentsPanelProps {
  activeSession: ChatSession;
  saveSession: (session: ChatSession) => Promise<void>;
}

export function MemoryFragmentsPanel({ activeSession, saveSession }: MemoryFragmentsPanelProps) {
  const { t } = useTranslation();
  const { getKernelService, showCustomConfirm } = useUnifiedApp((state) => ({
    getKernelService: state.getKernelService,
    showCustomConfirm: state.showCustomConfirm,
  }));
  const [fragments, setFragments] = useState<MemoryFragment[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    if (typeof getKernelService !== "function") {
      setFragments([]);
      setLoading(false);
      return;
    }
    try {
      const memory = getKernelService<MemoryServiceTyped>("memory");
      setFragments(await memory.getStorage().getFragmentsBySession(activeSession.id));
    } catch (error) {
      console.warn("[MemoryFragmentsPanel] Failed to load fragments:", error);
      setFragments([]);
    } finally {
      setLoading(false);
    }
  }, [activeSession.id, getKernelService]);

  useEffect(() => { void load(); }, [load]);

  const handleCorrect = async (fragment: MemoryFragment) => {
    const content = draft.trim();
    if (!content || content === fragment.content) {
      setEditingId(null);
      return;
    }
    const now = Date.now();
    const replacementId = `${fragment.id}:revision:${now.toString(36)}`;
    const memory = getKernelService<MemoryServiceTyped>("memory");
    await memory.getStorage().supersedeFragment(fragment.id, {
      ...fragment,
      id: replacementId,
      content,
      status: "active",
      supersedesId: fragment.id,
      supersededById: undefined,
      createdAt: now,
      updatedAt: now,
    });

    const replaceId = (ids: string[] | undefined) => (ids ?? []).map((id) =>
      id === fragment.id ? replacementId : id
    );
    if (
      activeSession.pinnedMessageIds?.includes(fragment.id) ||
      activeSession.mutedMessageIds?.includes(fragment.id)
    ) {
      await saveSession({
        ...activeSession,
        pinnedMessageIds: replaceId(activeSession.pinnedMessageIds),
        mutedMessageIds: replaceId(activeSession.mutedMessageIds),
      });
    }
    setEditingId(null);
    await load();
  };

  const handleToggleInvalid = async (fragment: MemoryFragment) => {
    if (fragment.status === "active") {
      const confirmed = await showCustomConfirm(t("recall_tab.fragment_invalidate_confirm"));
      if (!confirmed) return;
    }
    const memory = getKernelService<MemoryServiceTyped>("memory");
    await memory.getStorage().updateFragmentStatus(
      fragment.id,
      fragment.status === "invalid" ? "active" : "invalid",
    );
    await load();
  };

  const visible = fragments.filter((fragment) =>
    showHistory ? true : fragment.status === "active"
  );

  return (
    <section className="space-y-2 rounded-xl border border-border/50 bg-card/25 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold text-foreground">{t("recall_tab.fragment_title")}</h3>
          <p className="text-[9px] text-muted-foreground">{t("recall_tab.fragment_desc")}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowHistory((value) => !value)}
          className="flex min-h-8 items-center gap-1 rounded-lg border border-border/60 px-2 text-[9px] text-muted-foreground"
        >
          <History className="size-3" />
          {showHistory ? t("recall_tab.fragment_active_only") : t("recall_tab.fragment_history")}
        </button>
      </div>

      {loading ? (
        <p className="py-4 text-center text-[10px] text-muted-foreground">…</p>
      ) : visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/50 py-4 text-center text-[10px] text-muted-foreground">
          {t("recall_tab.fragment_empty")}
        </p>
      ) : visible.map((fragment) => (
        <article key={fragment.id} className={`rounded-lg border p-2.5 ${
          fragment.status === "active" ? "border-border/50 bg-background/45" : "border-border/30 bg-muted/20 opacity-60"
        }`}>
          <div className="mb-1.5 flex items-center justify-between gap-2 text-[9px] text-muted-foreground">
            <span>{t("recall_tab.fragment_source", { turn: fragment.sourceTurnEnd + 1 })}</span>
            <span>{t(`recall_tab.fragment_status_${fragment.status}`)}</span>
          </div>
          {editingId === fragment.id ? (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className="min-h-20 w-full rounded-lg border border-border bg-background p-2 text-[11px] outline-none focus:border-primary"
                aria-label={t("recall_tab.fragment_edit_label")}
              />
              <div className="flex justify-end gap-1.5">
                <button type="button" onClick={() => setEditingId(null)} className="flex size-8 items-center justify-center rounded-lg border border-border"><X className="size-3.5" /></button>
                <button type="button" onClick={() => void handleCorrect(fragment)} className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Check className="size-3.5" /></button>
              </div>
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-foreground/90">{fragment.content}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {fragment.tags.map((tag) => <span key={tag} className="rounded bg-primary/8 px-1.5 py-0.5 text-[8px] text-primary">{tag}</span>)}
            </div>
            <div className="flex gap-1">
              {fragment.status === "active" && (
                <button
                  type="button"
                  onClick={() => { setEditingId(fragment.id); setDraft(fragment.content); }}
                  className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground"
                  title={t("recall_tab.fragment_correct")}
                ><Pencil className="size-3.5" /></button>
              )}
              {fragment.status !== "superseded" && (
                <button
                  type="button"
                  onClick={() => void handleToggleInvalid(fragment)}
                  className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground"
                  title={fragment.status === "invalid" ? t("recall_tab.fragment_restore") : t("recall_tab.fragment_invalidate")}
                >{fragment.status === "invalid" ? <RotateCcw className="size-3.5" /> : <Ban className="size-3.5" />}</button>
              )}
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}
