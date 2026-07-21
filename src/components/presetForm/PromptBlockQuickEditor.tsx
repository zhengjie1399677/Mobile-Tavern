import { Copy, Expand, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "../../contexts/LanguageContext";
import type { PromptBlock, PromptMessageRole } from "../../domain/prompt-composition";
import {
  PromptComposerButton,
  PromptComposerInput,
  PromptComposerSelect,
  PromptComposerSwitch,
  PromptComposerTextarea,
} from "./PromptComposerControls";

interface PromptBlockQuickEditorProps {
  block: PromptBlock;
  historyBlocks: PromptBlock[];
  onPatch: (patch: Partial<PromptBlock>) => void;
  onClose: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onOpenFullEditor: () => void;
}

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
        <PromptComposerButton onClick={onClose} aria-label={t("prompt_composer.close_editor")} variant="ghost" size="icon-lg" className="text-muted-foreground shadow-none">
          <X className="h-4 w-4" />
        </PromptComposerButton>
      </header>

      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 p-2.5 text-xs font-semibold">
        {t("prompt_composer.block_enabled")}
        <PromptComposerSwitch checked={block.enabled} onCheckedChange={(checked) => onPatch({ enabled: checked })} aria-label={t("prompt_composer.block_enabled")} />
      </div>

      <Field label={t("prompt_composer.block_name")}>
        <PromptComposerInput aria-label={t("prompt_composer.block_name")} value={block.name} onChange={(event) => onPatch({ name: event.target.value })} />
      </Field>

      <div className="grid grid-cols-2 gap-2">
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
        <div className="space-y-2">
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
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("prompt_composer.message_count")}>
                <PromptComposerInput
                  type="number"
                  min={0}
                  value={recentSelection.count}
                  onChange={(event) => onPatch({ source: { type: "chat_history", selection: { ...recentSelection, count: Math.max(0, Number(event.target.value) || 0) } } })}
                  aria-label={t("prompt_composer.message_count")}
                />
              </Field>
              <div className="mt-5 flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/70 px-2.5 text-[10px] text-muted-foreground">
                {t("prompt_composer.preserve_greeting")}
                <PromptComposerSwitch
                  checked={recentSelection.preserveFirstAssistant}
                  onCheckedChange={(checked) => onPatch({ source: { type: "chat_history", selection: { ...recentSelection, preserveFirstAssistant: checked } } })}
                  aria-label={t("prompt_composer.preserve_greeting")}
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("prompt_composer.placement")}>
              <PromptComposerSelect
                value={block.placement.type}
                onValueChange={(value) => onPatch({ placement: value === "in_chat" ? { type: "in_chat", depth: 0, order: block.order } : { type: "ordered" } })}
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
                onChange={(event) => onPatch({ placement: { type: "in_chat", depth: Math.max(0, Number(event.target.value) || 0), order: block.order } })}
                aria-label={t("prompt_composer.depth")}
              />
            </Field>
          </div>
          {inChatPlacement && (
            <Field label={t("prompt_composer.target_history")}>
              <PromptComposerSelect
                value={inChatPlacement.historyBlockId ?? ""}
                onValueChange={(value) => onPatch({ placement: { ...inChatPlacement, historyBlockId: value || undefined } })}
                ariaLabel={t("prompt_composer.target_history")}
                options={[
                  { value: "", label: t("prompt_composer.all_history_blocks") },
                  ...historyBlocks.map((historyBlock) => ({ value: historyBlock.id, label: historyBlock.name })),
                ]}
              />
            </Field>
          )}
          <Field label={t("prompt_composer.template")}>
            <PromptComposerTextarea aria-label={t("prompt_composer.template")} value={block.template} onChange={(event) => onPatch({ template: event.target.value })} className="min-h-36 resize-y font-mono leading-relaxed" />
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
  return <div className="block space-y-1 text-[10px] font-semibold text-muted-foreground"><span>{label}</span>{children}</div>;
}

function ActionButton({ label, onClick, destructive, children }: { label: string; onClick: () => void; destructive?: boolean; children: ReactNode }) {
  return <PromptComposerButton onClick={onClick} variant={destructive ? "destructive" : "outline"} className="min-h-10 px-1 text-[9px]">{children}{label}</PromptComposerButton>;
}
