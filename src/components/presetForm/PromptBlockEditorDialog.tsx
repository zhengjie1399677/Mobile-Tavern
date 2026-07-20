import { Copy, Database, Search, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { useTranslation } from "../../contexts/LanguageContext";
import type {
  PromptBlock,
  PromptMessageRole,
} from "../../domain/prompt-composition";
import { PROMPT_DATA_SOURCE_OPTIONS } from "./promptDataSources";

interface PromptBlockEditorDialogProps {
  block?: PromptBlock;
  historyBlocks: PromptBlock[];
  onClose: () => void;
  onPatch: (patch: Partial<PromptBlock>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

const FIELD_CLASS = "w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary";

export default function PromptBlockEditorDialog({
  block,
  historyBlocks,
  onClose,
  onPatch,
  onDelete,
  onDuplicate,
}: PromptBlockEditorDialogProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showSources, setShowSources] = useState(false);
  const [sourceQuery, setSourceQuery] = useState("");

  const filteredSources = useMemo(() => {
    const query = sourceQuery.trim().toLocaleLowerCase();
    return PROMPT_DATA_SOURCE_OPTIONS.filter(([key, labelKey]) =>
      !query || key.toLocaleLowerCase().includes(query) || t(labelKey).toLocaleLowerCase().includes(query)
    );
  }, [sourceQuery, t]);

  if (!block) return null;

  const insertMacro = (key: string) => {
    const macro = `{{${key}}}`;
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? block.template.length;
    const end = textarea?.selectionEnd ?? start;
    const next = `${block.template.slice(0, start)}${macro}${block.template.slice(end)}`;
    onPatch({ template: next });
    setTimeout(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + macro.length, start + macro.length);
    }, 0);
  };

  const recentSelection = block.source.type === "chat_history" && block.source.selection?.mode === "recent"
    ? block.source.selection
    : undefined;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="top-auto bottom-0 left-1/2 max-h-[92dvh] w-full max-w-2xl -translate-x-1/2 translate-y-0 overflow-hidden rounded-b-none p-0">
        <DialogHeader className="border-b border-border px-4 pb-3 pt-4 pr-12">
          <DialogTitle>{t("prompt_composer.edit_block_title")}</DialogTitle>
          <DialogDescription>{t("prompt_composer.edit_block_description")}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(92dvh-76px)] space-y-4 overflow-y-auto overscroll-contain p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <label className="flex items-center justify-between rounded-lg border border-border bg-muted/20 p-3 text-xs font-semibold">
            {t("prompt_composer.block_enabled")}
            <input
              type="checkbox"
              checked={block.enabled}
              onChange={(event) => onPatch({ enabled: event.target.checked })}
              className="h-4 w-4 accent-primary"
            />
          </label>

          <Field label={t("prompt_composer.block_name")}>
            <input
              value={block.name}
              onChange={(event) => onPatch({ name: event.target.value })}
              className={FIELD_CLASS}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
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
            <section className="space-y-3 rounded-xl border border-border bg-muted/20 p-3">
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
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("prompt_composer.message_count")}>
                    <input
                      type="number"
                      min={0}
                      value={recentSelection.count}
                      onChange={(event) => onPatch({
                        source: {
                          type: "chat_history",
                          selection: {
                            ...recentSelection,
                            count: Math.max(0, Number(event.target.value) || 0),
                          },
                        },
                      })}
                      className={FIELD_CLASS}
                    />
                  </Field>
                  <label className="mt-5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={recentSelection.preserveFirstAssistant}
                      onChange={(event) => onPatch({
                        source: {
                          type: "chat_history",
                          selection: { ...recentSelection, preserveFirstAssistant: event.target.checked },
                        },
                      })}
                    />
                    {t("prompt_composer.preserve_greeting")}
                  </label>
                </div>
              )}
            </section>
          ) : (
            <>
              <section className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("prompt_composer.placement")}>
                    <select
                      value={block.placement.type}
                      onChange={(event) => onPatch({
                        placement: event.target.value === "in_chat"
                          ? { type: "in_chat", depth: 0, order: block.order }
                          : { type: "ordered" },
                      })}
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
                      onChange={(event) => onPatch({
                        placement: {
                          type: "in_chat",
                          depth: Math.max(0, Number(event.target.value) || 0),
                          order: block.order,
                          historyBlockId: block.placement.type === "in_chat" ? block.placement.historyBlockId : undefined,
                        },
                      })}
                      className={`${FIELD_CLASS} disabled:opacity-40`}
                    />
                  </Field>
                </div>
                {block.placement.type === "in_chat" && (
                  <Field label={t("prompt_composer.target_history")}>
                    <select
                      value={block.placement.historyBlockId ?? ""}
                      onChange={(event) => onPatch({
                        placement: {
                          type: "in_chat",
                          depth: block.placement.type === "in_chat" ? block.placement.depth : 0,
                          order: block.placement.type === "in_chat" ? block.placement.order : block.order,
                          historyBlockId: event.target.value || undefined,
                        },
                      })}
                      className={FIELD_CLASS}
                    >
                      <option value="">{t("prompt_composer.all_history_blocks")}</option>
                      {historyBlocks.map((historyBlock) => (
                        <option key={historyBlock.id} value={historyBlock.id}>{historyBlock.name}</option>
                      ))}
                    </select>
                  </Field>
                )}
              </section>

              <Field label={t("prompt_composer.template")}>
                <textarea
                  ref={textareaRef}
                  value={block.template}
                  onChange={(event) => onPatch({ template: event.target.value })}
                  className="min-h-[180px] w-full resize-y rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed outline-none focus:border-primary"
                />
              </Field>

              <section className="rounded-xl border border-border bg-muted/20 p-3">
                <button
                  type="button"
                  aria-label={t("prompt_composer.insert_source")}
                  onClick={() => setShowSources((current) => !current)}
                  className="flex w-full items-center justify-between text-xs font-bold text-primary"
                >
                  <span className="flex items-center gap-2"><Database className="h-4 w-4" />{t("prompt_composer.insert_source")}</span>
                  <span>{showSources ? "−" : "+"}</span>
                </button>
                {showSources && (
                  <div className="mt-3 space-y-2">
                    <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-3">
                      <Search className="h-3.5 w-3.5 text-muted-foreground" />
                      <input
                        value={sourceQuery}
                        onChange={(event) => setSourceQuery(event.target.value)}
                        placeholder={t("prompt_composer.search_sources")}
                        className="min-w-0 flex-1 bg-transparent py-2 text-xs outline-none"
                      />
                    </label>
                    <div className="max-h-56 space-y-1 overflow-y-auto">
                      {filteredSources.map(([key, labelKey, groupKey]) => (
                        <button
                          type="button"
                          key={key}
                          onClick={() => insertMacro(key)}
                          className="flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-2 text-left hover:border-primary/20 hover:bg-primary/5"
                          aria-label={`${t(labelKey)} {{${key}}}`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-semibold">{t(labelKey)}</span>
                            <code className="block truncate text-[9px] text-muted-foreground">{`{{${key}}}`}</code>
                          </span>
                          <span className="text-[9px] text-muted-foreground">{t(groupKey)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </>
          )}

          <div key={block.id}>
            <AdvancedFields block={block} onPatch={onPatch} />
          </div>

          {block.compatibility && (
            <div className="rounded-lg border border-sky-500/25 bg-sky-500/10 p-3 text-[10px] text-sky-700 dark:text-sky-300">
              {t("prompt_composer.compatibility_metadata", { source: block.compatibility.source })}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
            <button type="button" onClick={onDuplicate} className="flex items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-xs font-semibold">
              <Copy className="h-4 w-4" />{t("prompt_composer.duplicate_block")}
            </button>
            <button type="button" onClick={onDelete} className="flex items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 py-2.5 text-xs font-semibold text-destructive">
              <Trash2 className="h-4 w-4" />{t("prompt_composer.delete_block")}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AdvancedFields({
  block,
  onPatch,
}: {
  block: PromptBlock;
  onPatch: (patch: Partial<PromptBlock>) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(Boolean(block.condition || block.tokenPolicy));
  return (
    <details
      className="rounded-xl border border-border bg-muted/20 p-3"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-xs font-bold">
        {t("prompt_composer.advanced_fields")}
        {(block.condition || block.tokenPolicy) && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-amber-700 dark:text-amber-300">{t("prompt_composer.active")}</span>}
      </summary>
      <div className="mt-3 space-y-4">
        <label className="flex items-center justify-between text-[11px] font-semibold">
          {t("prompt_composer.condition")}
          <input
            type="checkbox"
            checked={Boolean(block.condition)}
            onChange={(event) => onPatch({
              condition: event.target.checked
                ? { dataKey: "worldbook.triggered", operator: "not_empty" }
                : undefined,
            })}
          />
        </label>
        {block.condition && (
          <div className="grid grid-cols-2 gap-2">
            <input
              value={block.condition.dataKey}
              onChange={(event) => onPatch({ condition: { ...block.condition!, dataKey: event.target.value } })}
              aria-label={t("prompt_composer.condition_key")}
              className={FIELD_CLASS}
            />
            <select
              value={block.condition.operator}
              onChange={(event) => onPatch({
                condition: {
                  ...block.condition!,
                  operator: event.target.value as NonNullable<PromptBlock["condition"]>["operator"],
                },
              })}
              aria-label={t("prompt_composer.condition_operator")}
              className={FIELD_CLASS}
            >
              <option value="not_empty">not_empty</option>
              <option value="empty">empty</option>
              <option value="equals">equals</option>
              <option value="not_equals">not_equals</option>
            </select>
            {(block.condition.operator === "equals" || block.condition.operator === "not_equals") && (
              <input
                value={block.condition.value ?? ""}
                onChange={(event) => onPatch({ condition: { ...block.condition!, value: event.target.value } })}
                aria-label={t("prompt_composer.condition_value")}
                className={`${FIELD_CLASS} col-span-2`}
              />
            )}
          </div>
        )}

        <label className="flex items-center justify-between border-t border-border pt-3 text-[11px] font-semibold">
          {t("prompt_composer.token_policy")}
          <input
            type="checkbox"
            checked={Boolean(block.tokenPolicy)}
            onChange={(event) => onPatch({
              tokenPolicy: event.target.checked ? { priority: 50, overflow: "keep" } : undefined,
            })}
          />
        </label>
        {block.tokenPolicy && (
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              value={block.tokenPolicy.priority}
              onChange={(event) => onPatch({ tokenPolicy: { ...block.tokenPolicy!, priority: Number(event.target.value) || 0 } })}
              aria-label={t("prompt_composer.priority")}
              className={FIELD_CLASS}
            />
            <select
              value={block.tokenPolicy.overflow}
              onChange={(event) => onPatch({
                tokenPolicy: { ...block.tokenPolicy!, overflow: event.target.value as "keep" | "drop" },
              })}
              aria-label={t("prompt_composer.overflow")}
              className={FIELD_CLASS}
            >
              <option value="keep">keep</option>
              <option value="drop">drop</option>
            </select>
            <p className="col-span-2 text-[10px] leading-relaxed text-muted-foreground">
              {t("prompt_composer.token_policy_compat_note")}
            </p>
          </div>
        )}
      </div>
    </details>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5 text-[10px] font-semibold text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}
