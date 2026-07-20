import { Copy, Expand, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "../../contexts/LanguageContext";
import type { PromptBlock, PromptMessageRole } from "../../domain/prompt-composition";

interface PromptBlockQuickEditorProps {
  block: PromptBlock;
  historyBlocks: PromptBlock[];
  onPatch: (patch: Partial<PromptBlock>) => void;
  onClose: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onOpenFullEditor: () => void;
}

const FIELD_CLASS = "w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary";

export default function PromptBlockQuickEditor({
  block,
  historyBlocks,
  onPatch,
  onClose,
  onDelete,
  onDuplicate,
  onOpenFullEditor,
}: PromptBlockQuickEditorProps) {
  const { t } = useTranslation();
  const recentSelection = block.source.type === "chat_history" && block.source.selection?.mode === "recent"
    ? block.source.selection
    : undefined;
  const inChatPlacement = block.placement.type === "in_chat" ? block.placement : undefined;

  return (
    <section role="region" aria-label={t("prompt_composer.wide_editor")} className="space-y-3 rounded-xl border border-primary/20 bg-background/80 p-3">
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold">{t("prompt_composer.quick_editor_title")}</div>
          <div className="truncate text-[10px] text-muted-foreground">{block.name}</div>
        </div>
        <button type="button" onClick={onClose} aria-label={t("prompt_composer.close_editor")} className="rounded-lg p-2 text-muted-foreground hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </header>

      <label className="flex items-center justify-between rounded-lg border border-border bg-muted/20 p-2.5 text-xs font-semibold">
        {t("prompt_composer.block_enabled")}
        <input type="checkbox" checked={block.enabled} onChange={(event) => onPatch({ enabled: event.target.checked })} className="h-4 w-4 accent-primary" />
      </label>

      <Field label={t("prompt_composer.block_name")}>
        <input value={block.name} onChange={(event) => onPatch({ name: event.target.value })} className={FIELD_CLASS} />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label={t("prompt_composer.source")}>
          <select
            value={block.source.type}
            onChange={(event) => onPatch({
              source: event.target.value === "chat_history"
                ? { type: "chat_history", selection: { mode: "all" } }
                : { type: "template" },
              placement: event.target.value === "chat_history" ? { type: "ordered" } : block.placement,
            })}
            className={FIELD_CLASS}
          >
            <option value="template">{t("prompt_composer.template_source")}</option>
            <option value="chat_history">{t("prompt_composer.history_source")}</option>
          </select>
        </Field>
        <Field label={t("prompt_composer.role")}>
          <select
            value={block.role}
            disabled={block.source.type === "chat_history"}
            onChange={(event) => onPatch({ role: event.target.value as PromptMessageRole })}
            className={`${FIELD_CLASS} disabled:opacity-40`}
          >
            <option value="system">system</option>
            <option value="user">user</option>
            <option value="assistant">assistant</option>
          </select>
        </Field>
      </div>

      {block.source.type === "chat_history" ? (
        <div className="space-y-2">
          <Field label={t("prompt_composer.history_selection")}>
            <select
              value={block.source.selection?.mode ?? "all"}
              onChange={(event) => onPatch({
                source: event.target.value === "recent"
                  ? { type: "chat_history", selection: { mode: "recent", count: 6, preserveFirstAssistant: false } }
                  : { type: "chat_history", selection: { mode: "all" } },
              })}
              className={FIELD_CLASS}
            >
              <option value="all">{t("prompt_composer.all_messages")}</option>
              <option value="recent">{t("prompt_composer.recent_messages")}</option>
            </select>
          </Field>
          {recentSelection && (
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("prompt_composer.message_count")}>
                <input
                  type="number"
                  min={0}
                  value={recentSelection.count}
                  onChange={(event) => onPatch({ source: { type: "chat_history", selection: { ...recentSelection, count: Math.max(0, Number(event.target.value) || 0) } } })}
                  className={FIELD_CLASS}
                />
              </Field>
              <label className="mt-5 flex items-center gap-2 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={recentSelection.preserveFirstAssistant}
                  onChange={(event) => onPatch({ source: { type: "chat_history", selection: { ...recentSelection, preserveFirstAssistant: event.target.checked } } })}
                />
                {t("prompt_composer.preserve_greeting")}
              </label>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("prompt_composer.placement")}>
              <select
                value={block.placement.type}
                onChange={(event) => onPatch({ placement: event.target.value === "in_chat" ? { type: "in_chat", depth: 0, order: block.order } : { type: "ordered" } })}
                className={FIELD_CLASS}
              >
                <option value="ordered">{t("prompt_composer.ordered")}</option>
                <option value="in_chat">{t("prompt_composer.in_chat")}</option>
              </select>
            </Field>
            <Field label={t("prompt_composer.depth")}>
              <input
                type="number"
                min={0}
                disabled={block.placement.type !== "in_chat"}
                value={block.placement.type === "in_chat" ? block.placement.depth : 0}
                onChange={(event) => onPatch({ placement: { type: "in_chat", depth: Math.max(0, Number(event.target.value) || 0), order: block.order } })}
                className={`${FIELD_CLASS} disabled:opacity-40`}
              />
            </Field>
          </div>
          {inChatPlacement && (
            <Field label={t("prompt_composer.target_history")}>
              <select
                value={inChatPlacement.historyBlockId ?? ""}
                onChange={(event) => onPatch({ placement: { ...inChatPlacement, historyBlockId: event.target.value || undefined } })}
                className={FIELD_CLASS}
              >
                <option value="">{t("prompt_composer.all_history_blocks")}</option>
                {historyBlocks.map((historyBlock) => <option key={historyBlock.id} value={historyBlock.id}>{historyBlock.name}</option>)}
              </select>
            </Field>
          )}
          <Field label={t("prompt_composer.template")}>
            <textarea value={block.template} onChange={(event) => onPatch({ template: event.target.value })} className="min-h-36 w-full resize-y rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed outline-none focus:border-primary" />
          </Field>
        </>
      )}

      <div className="grid grid-cols-3 gap-2 border-t border-border pt-3">
        <ActionButton label={t("prompt_composer.full_editor")} onClick={onOpenFullEditor}><Expand className="h-3.5 w-3.5" /></ActionButton>
        <ActionButton label={t("prompt_composer.duplicate_block")} onClick={onDuplicate}><Copy className="h-3.5 w-3.5" /></ActionButton>
        <ActionButton label={t("prompt_composer.delete_block")} onClick={onDelete} destructive><Trash2 className="h-3.5 w-3.5" /></ActionButton>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1 text-[10px] font-semibold text-muted-foreground"><span>{label}</span>{children}</label>;
}

function ActionButton({ label, onClick, destructive, children }: { label: string; onClick: () => void; destructive?: boolean; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={`flex min-h-10 items-center justify-center gap-1 rounded-lg border px-1 text-[9px] font-semibold ${destructive ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border"}`}>{children}{label}</button>;
}
