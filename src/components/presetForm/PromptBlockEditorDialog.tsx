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
import {
  PromptComposerButton,
  PromptComposerInput,
  PromptComposerSelect,
  PromptComposerSwitch,
  PromptComposerTextarea,
} from "./PromptComposerControls";

interface PromptBlockEditorDialogProps {
  block?: PromptBlock;
  historyBlocks: PromptBlock[];
  onClose: () => void;
  onPatch: (patch: Partial<PromptBlock>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

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
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 p-3 text-xs font-semibold">
            {t("prompt_composer.block_enabled")}
            <PromptComposerSwitch
              checked={block.enabled}
              onCheckedChange={(checked) => onPatch({ enabled: checked })}
              aria-label={t("prompt_composer.block_enabled")}
            />
          </div>

          <Field label={t("prompt_composer.block_name")}>
            <PromptComposerInput
              value={block.name}
              onChange={(event) => onPatch({ name: event.target.value })}
              aria-label={t("prompt_composer.block_name")}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("prompt_composer.source")}>
              <PromptComposerSelect
                value={block.source.type}
                onValueChange={(value) => onPatch({
                  source: value === "chat_history"
                    ? { type: "chat_history", selection: { mode: "all" } }
                    : { type: "template" },
                  placement: value === "chat_history" ? { type: "ordered" } : block.placement,
                })}
                ariaLabel={t("prompt_composer.source")}
                options={[
                  { value: "template", label: t("prompt_composer.template_source") },
                  { value: "chat_history", label: t("prompt_composer.history_source") },
                ]}
              />
            </Field>
            <Field label={t("prompt_composer.role")}>
              <PromptComposerSelect
                value={block.role}
                disabled={block.source.type === "chat_history"}
                onValueChange={(value) => onPatch({ role: value as PromptMessageRole })}
                ariaLabel={t("prompt_composer.role")}
                options={["system", "user", "assistant"].map((value) => ({ value, label: value }))}
              />
            </Field>
          </div>

          {block.source.type === "chat_history" ? (
            <section className="space-y-3 rounded-xl border border-border bg-muted/20 p-3">
              <Field label={t("prompt_composer.history_selection")}>
                <PromptComposerSelect
                  value={block.source.selection?.mode ?? "all"}
                  onValueChange={(value) => onPatch({
                    source: value === "recent"
                      ? { type: "chat_history", selection: { mode: "recent", count: 6, preserveFirstAssistant: false } }
                      : { type: "chat_history", selection: { mode: "all" } },
                  })}
                  ariaLabel={t("prompt_composer.history_selection")}
                  options={[
                    { value: "all", label: t("prompt_composer.all_messages") },
                    { value: "recent", label: t("prompt_composer.recent_messages") },
                  ]}
                />
              </Field>
              {recentSelection && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("prompt_composer.message_count")}>
                    <PromptComposerInput
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
                      aria-label={t("prompt_composer.message_count")}
                    />
                  </Field>
                  <div className="mt-5 flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/70 px-2.5 text-[11px] text-muted-foreground">
                    {t("prompt_composer.preserve_greeting")}
                    <PromptComposerSwitch
                      checked={recentSelection.preserveFirstAssistant}
                      onCheckedChange={(checked) => onPatch({
                        source: {
                          type: "chat_history",
                          selection: { ...recentSelection, preserveFirstAssistant: checked },
                        },
                      })}
                      aria-label={t("prompt_composer.preserve_greeting")}
                    />
                  </div>
                </div>
              )}
            </section>
          ) : (
            <>
              <section className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("prompt_composer.placement")}>
                    <PromptComposerSelect
                      value={block.placement.type}
                      onValueChange={(value) => onPatch({
                        placement: value === "in_chat"
                          ? { type: "in_chat", depth: 0, order: block.order }
                          : { type: "ordered" },
                      })}
                      ariaLabel={t("prompt_composer.placement")}
                      options={[
                        { value: "ordered", label: t("prompt_composer.ordered") },
                        { value: "in_chat", label: t("prompt_composer.in_chat") },
                      ]}
                    />
                  </Field>
                  <Field label={t("prompt_composer.depth")}>
                    <PromptComposerInput
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
                      aria-label={t("prompt_composer.depth")}
                    />
                  </Field>
                </div>
                {block.placement.type === "in_chat" && (
                  <Field label={t("prompt_composer.target_history")}>
                    <PromptComposerSelect
                      value={block.placement.historyBlockId ?? ""}
                      onValueChange={(value) => onPatch({
                        placement: {
                          type: "in_chat",
                          depth: block.placement.type === "in_chat" ? block.placement.depth : 0,
                          order: block.placement.type === "in_chat" ? block.placement.order : block.order,
                          historyBlockId: value || undefined,
                        },
                      })}
                      ariaLabel={t("prompt_composer.target_history")}
                      options={[
                        { value: "", label: t("prompt_composer.all_history_blocks") },
                        ...historyBlocks.map((historyBlock) => ({ value: historyBlock.id, label: historyBlock.name })),
                      ]}
                    />
                  </Field>
                )}
              </section>

              <Field label={t("prompt_composer.template")}>
                <PromptComposerTextarea
                  ref={textareaRef}
                  value={block.template}
                  onChange={(event) => onPatch({ template: event.target.value })}
                  aria-label={t("prompt_composer.template")}
                  className="min-h-[180px] resize-y font-mono leading-relaxed"
                />
              </Field>

              <section className="rounded-xl border border-border bg-muted/20 p-3">
                <PromptComposerButton
                  type="button"
                  aria-label={t("prompt_composer.insert_source")}
                  onClick={() => setShowSources((current) => !current)}
                  variant="ghost"
                  className="flex w-full items-center justify-between px-1 text-xs font-bold text-primary shadow-none"
                >
                  <span className="flex items-center gap-2"><Database className="h-4 w-4" />{t("prompt_composer.insert_source")}</span>
                  <span>{showSources ? "−" : "+"}</span>
                </PromptComposerButton>
                {showSources && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 shadow-sm focus-within:border-primary/70 focus-within:ring-2 focus-within:ring-primary/20">
                      <Search className="h-3.5 w-3.5 text-muted-foreground" />
                      <PromptComposerInput
                        value={sourceQuery}
                        onChange={(event) => setSourceQuery(event.target.value)}
                        placeholder={t("prompt_composer.search_sources")}
                        aria-label={t("prompt_composer.search_sources")}
                        className="min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                      />
                    </div>
                    <div className="max-h-56 space-y-1 overflow-y-auto">
                      {filteredSources.map(([key, labelKey, groupKey]) => (
                        <PromptComposerButton
                          type="button"
                          key={key}
                          onClick={() => insertMacro(key)}
                          variant="ghost"
                          className="flex h-auto min-h-10 w-full items-center justify-start gap-2 rounded-lg border border-transparent px-2 py-2 text-left shadow-none hover:border-primary/20 hover:bg-primary/5"
                          aria-label={`${t(labelKey)} {{${key}}}`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-semibold">{t(labelKey)}</span>
                            <code className="block truncate text-[9px] text-muted-foreground">{`{{${key}}}`}</code>
                          </span>
                          <span className="text-[9px] text-muted-foreground">{t(groupKey)}</span>
                        </PromptComposerButton>
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
            <PromptComposerButton onClick={onDuplicate} className="min-h-10 gap-2">
              <Copy className="h-4 w-4" />{t("prompt_composer.duplicate_block")}
            </PromptComposerButton>
            <PromptComposerButton onClick={onDelete} variant="destructive" className="min-h-10 gap-2">
              <Trash2 className="h-4 w-4" />{t("prompt_composer.delete_block")}
            </PromptComposerButton>
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
        <div className="flex items-center justify-between text-[11px] font-semibold">
          {t("prompt_composer.condition")}
          <PromptComposerSwitch
            checked={Boolean(block.condition)}
            onCheckedChange={(checked) => onPatch({
              condition: checked
                ? { dataKey: "worldbook.triggered", operator: "not_empty" }
                : undefined,
            })}
            aria-label={t("prompt_composer.condition")}
          />
        </div>
        {block.condition && (
          <div className="grid grid-cols-2 gap-2">
            <PromptComposerInput
              value={block.condition.dataKey}
              onChange={(event) => onPatch({ condition: { ...block.condition!, dataKey: event.target.value } })}
              aria-label={t("prompt_composer.condition_key")}
            />
            <PromptComposerSelect
              value={block.condition.operator}
              onValueChange={(value) => onPatch({
                condition: {
                  ...block.condition!,
                  operator: value as NonNullable<PromptBlock["condition"]>["operator"],
                },
              })}
              ariaLabel={t("prompt_composer.condition_operator")}
              options={["not_empty", "empty", "equals", "not_equals"].map((value) => ({ value, label: value }))}
            />
            {(block.condition.operator === "equals" || block.condition.operator === "not_equals") && (
              <PromptComposerInput
                value={block.condition.value ?? ""}
                onChange={(event) => onPatch({ condition: { ...block.condition!, value: event.target.value } })}
                aria-label={t("prompt_composer.condition_value")}
                className="col-span-2"
              />
            )}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-3 text-[11px] font-semibold">
          {t("prompt_composer.token_policy")}
          <PromptComposerSwitch
            checked={Boolean(block.tokenPolicy)}
            onCheckedChange={(checked) => onPatch({
              tokenPolicy: checked ? { priority: 50, overflow: "keep" } : undefined,
            })}
            aria-label={t("prompt_composer.token_policy")}
          />
        </div>
        {block.tokenPolicy && (
          <div className="grid grid-cols-2 gap-2">
            <PromptComposerInput
              type="number"
              value={block.tokenPolicy.priority}
              onChange={(event) => onPatch({ tokenPolicy: { ...block.tokenPolicy!, priority: Number(event.target.value) || 0 } })}
              aria-label={t("prompt_composer.priority")}
            />
            <PromptComposerSelect
              value={block.tokenPolicy.overflow}
              onValueChange={(value) => onPatch({
                tokenPolicy: { ...block.tokenPolicy!, overflow: value as "keep" | "drop" },
              })}
              ariaLabel={t("prompt_composer.overflow")}
              options={["keep", "drop"].map((value) => ({ value, label: value }))}
            />
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
    <div className="block space-y-1.5 text-[10px] font-semibold text-muted-foreground">
      <span>{label}</span>
      {children}
    </div>
  );
}
