import {
  ArrowDown,
  ArrowUp,
  Eye,
  GitBranch,
  GripVertical,
  History,
  MessageSquarePlus,
  RotateCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { PromptBlock, PromptComposition } from "../../domain/prompt-composition";
import { createBasicPromptComposition } from "../../domain/prompt-composition";
import type { UserSettings } from "../../types";
import { useTranslation } from "../../contexts/LanguageContext";
import PromptBlockEditorDialog from "./PromptBlockEditorDialog";
import PromptBlockQuickEditor from "./PromptBlockQuickEditor";
import PromptCompositionPreviewDialog from "./PromptCompositionPreviewDialog";
import PromptCompositionTransferToolbar from "./PromptCompositionTransferToolbar";
import PromptCompositionWorkbench from "./PromptCompositionWorkbench";
import type { PromptWorkbenchView } from "./PromptCompositionWorkbench";
import type { PromptCompositionPreviewData } from "./promptCompositionEditorTypes";
import { useWidePromptWorkbench } from "./useWidePromptWorkbench";
import { useAndroidOrientationControl } from "./useAndroidOrientationControl";
import { usePromptCompositionHistory } from "./usePromptCompositionHistory";

export type { PromptCompositionPreviewData } from "./promptCompositionEditorTypes";

interface PromptCompositionEditorProps {
  settings: UserSettings;
  updateSettings: (updater: UserSettings | ((previous: UserSettings) => UserSettings)) => void;
  preview?: PromptCompositionPreviewData;
}

export default function PromptCompositionEditor({
  settings,
  updateSettings,
  preview,
}: PromptCompositionEditorProps) {
  const { t } = useTranslation();
  const composition = settings.promptConfig.composition ?? createBasicPromptComposition();
  const [editingBlockId, setEditingBlockId] = useState<string>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [workbenchView, setWorkbenchView] = useState<PromptWorkbenchView>("graph");
  const [fullEditorOpen, setFullEditorOpen] = useState(false);
  const [dragTargetId, setDragTargetId] = useState<string>();
  const isWideWorkbench = useWidePromptWorkbench();
  const orientationControl = useAndroidOrientationControl();
  const dragRef = useRef<{ sourceId: string; targetId: string }>();
  const editingBlock = composition.blocks.find((block) => block.id === editingBlockId);
  const historyBlocks = composition.blocks.filter((block) => block.source.type === "chat_history");
  const freeMode = settings.promptConfig.usePromptComposition === true;

  const persistComposition = (next: PromptComposition) => {
    updateSettings((previous) => ({
      ...previous,
      promptConfig: { ...previous.promptConfig, composition: next },
    }));
  };
  const compositionHistory = usePromptCompositionHistory(composition, persistComposition);
  const updateComposition = compositionHistory.commit;

  const setMode = (enabled: boolean) => {
    updateSettings((previous) => ({
      ...previous,
      promptConfig: {
        ...previous.promptConfig,
        usePromptComposition: enabled,
        composition: previous.promptConfig.composition ?? createBasicPromptComposition(),
      },
    }));
  };

  const updateBlock = (id: string, patch: Partial<PromptBlock>) => {
    updateComposition({
      ...composition,
      blocks: composition.blocks.map((block) => block.id === id ? { ...block, ...patch } : block),
    }, `block:${id}`);
  };

  const addBlock = (sourceType: "template" | "chat_history") => {
    const order = composition.blocks.length === 0
      ? 100
      : Math.max(...composition.blocks.map((block) => block.order)) + 100;
    const id = `prompt_block_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const block: PromptBlock = {
      id,
      name: sourceType === "chat_history" ? t("prompt_composer.history_block") : t("prompt_composer.new_block"),
      enabled: true,
      role: "system",
      source: sourceType === "chat_history"
        ? { type: "chat_history", selection: { mode: "all" } }
        : { type: "template" },
      template: "",
      order,
      placement: { type: "ordered" },
    };
    updateComposition({ ...composition, blocks: [...composition.blocks, block] });
    setEditingBlockId(id);
  };

  const reorder = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const blocks = [...composition.blocks];
    const sourceIndex = blocks.findIndex((block) => block.id === sourceId);
    const targetIndex = blocks.findIndex((block) => block.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = blocks.splice(sourceIndex, 1);
    blocks.splice(targetIndex, 0, moved);
    updateComposition({
      ...composition,
      blocks: blocks.map((block, index) => ({ ...block, order: (index + 1) * 100 })),
    });
  };

  const moveBlock = (index: number, offset: -1 | 1) => {
    const target = composition.blocks[index + offset];
    const source = composition.blocks[index];
    if (source && target) reorder(source.id, target.id);
  };

  const deleteBlock = (id: string) => {
    if (!window.confirm(t("prompt_composer.confirm_delete"))) return;
    updateComposition({ ...composition, blocks: composition.blocks.filter((block) => block.id !== id) });
    if (editingBlockId === id) setEditingBlockId(undefined);
  };

  const duplicateBlock = (id: string) => {
    const sourceIndex = composition.blocks.findIndex((block) => block.id === id);
    if (sourceIndex < 0) return;
    const source = composition.blocks[sourceIndex];
    const duplicate: PromptBlock = {
      ...structuredClone(source),
      id: `prompt_block_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: `${source.name} ${t("prompt_composer.copy_suffix")}`,
    };
    const blocks = [...composition.blocks];
    blocks.splice(sourceIndex + 1, 0, duplicate);
    updateComposition({
      ...composition,
      blocks: blocks.map((block, index) => ({ ...block, order: (index + 1) * 100 })),
    });
    setEditingBlockId(duplicate.id);
  };

  const handleDragStart = (event: ReactPointerEvent<HTMLButtonElement>, blockId: string) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { sourceId: blockId, targetId: blockId };
    setDragTargetId(blockId);
  };

  const handleDragMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current || typeof document.elementFromPoint !== "function") return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-prompt-block-id]");
    const targetId = target?.dataset.promptBlockId;
    if (!targetId) return;
    dragRef.current.targetId = targetId;
    setDragTargetId(targetId);
  };

  const handleDragEnd = () => {
    if (dragRef.current) reorder(dragRef.current.sourceId, dragRef.current.targetId);
    dragRef.current = undefined;
    setDragTargetId(undefined);
  };

  const compatibilityCount = composition.blocks.filter((block) => block.compatibility).length +
    (composition.compatibility?.preservedRootFields ? Object.keys(composition.compatibility.preservedRootFields).length : 0);

  return (
    <section className="space-y-3 rounded-xl border border-primary/25 bg-primary/5 p-3">
      <div>
        <div className="text-xs font-bold">{t("prompt_composer.title")}</div>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{t("prompt_composer.description")}</p>
      </div>

      <div className="grid grid-cols-2 rounded-xl border border-border bg-muted/50 p-1" role="group" aria-label={t("prompt_composer.mode")}>
        <ModeButton active={!freeMode} onClick={() => setMode(false)}>{t("prompt_composer.legacy_mode")}</ModeButton>
        <ModeButton active={freeMode} onClick={() => setMode(true)}>{t("prompt_composer.free_mode")}</ModeButton>
      </div>

      {freeMode && (
        <>
          {orientationControl.available && (
            <button
              type="button"
              aria-pressed={orientationControl.forcedLandscape}
              onClick={orientationControl.toggleOrientation}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary/25 bg-primary/10 px-3 text-xs font-bold text-primary active:bg-primary/15"
            >
              <RotateCw className="h-4 w-4" />
              {t(orientationControl.forcedLandscape
                ? "prompt_composer.restore_auto_rotation"
                : "prompt_composer.enter_landscape")}
            </button>
          )}

          <div className={isWideWorkbench ? "grid grid-cols-[minmax(300px,0.9fr)_minmax(340px,1.1fr)] items-start gap-3" : "space-y-3"}>
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
                {t("prompt_composer.no_hidden_prompt")}
              </div>

              <PromptCompositionTransferToolbar
                composition={composition}
                canUndo={compositionHistory.canUndo}
                canRedo={compositionHistory.canRedo}
                onUndo={compositionHistory.undo}
                onRedo={compositionHistory.redo}
                onImport={(imported) => {
                  updateComposition(imported);
                  setEditingBlockId(undefined);
                }}
              />

              <div className="flex gap-2">
                <input
                  value={composition.name}
                  onChange={(event) => updateComposition({ ...composition, name: event.target.value }, "composition-name")}
                  aria-label={t("prompt_composer.composition_name")}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
                />
                {!isWideWorkbench && (
                  <>
                    <button
                      type="button"
                      onClick={() => { setWorkbenchView("graph"); setWorkbenchOpen(true); }}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-bold"
                    >
                      <GitBranch className="h-3.5 w-3.5" />{t("prompt_composer.graph")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewOpen(true)}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/10 px-2.5 text-xs font-bold text-primary"
                    >
                      <Eye className="h-3.5 w-3.5" />{t("prompt_composer.preview")}
                    </button>
                  </>
                )}
              </div>

              {compatibilityCount > 0 && (
                <div className="rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-[10px] text-sky-700 dark:text-sky-300">
                  {t("prompt_composer.compatibility_summary", { count: String(compatibilityCount), source: composition.compatibility?.source ?? "external" })}
                </div>
              )}

              {composition.blocks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-destructive/35 bg-destructive/5 p-5 text-center text-xs text-destructive">
              {t("prompt_composer.empty_send_warning")}
            </div>
              ) : (
            <div className="space-y-2">
              {composition.blocks.map((block, index) => (
                <article
                  key={block.id}
                  data-prompt-block-id={block.id}
                  className={`flex items-stretch overflow-hidden rounded-xl border bg-background transition ${dragTargetId === block.id ? "border-primary ring-2 ring-primary/15" : "border-border"} ${block.enabled ? "" : "opacity-55"}`}
                >
                  <button
                    type="button"
                    aria-label={t("prompt_composer.drag_block", { name: block.name })}
                    onPointerDown={(event) => handleDragStart(event, block.id)}
                    onPointerMove={handleDragMove}
                    onPointerUp={handleDragEnd}
                    onPointerCancel={handleDragEnd}
                    className="touch-none border-r border-border px-2 text-muted-foreground active:bg-muted"
                  >
                    <GripVertical className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    aria-label={t("prompt_composer.edit_block", { name: block.name })}
                    onClick={() => setEditingBlockId(block.id)}
                    className="min-w-0 flex-1 p-3 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-5 shrink-0 font-mono text-[10px] text-muted-foreground">{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold">{block.name}</span>
                      <RoleBadge role={block.source.type === "chat_history" ? "history" : block.role} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1 pl-7 text-[9px] text-muted-foreground">
                      <span className="rounded bg-muted px-1.5 py-0.5">{describeSource(block, t)}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5">{describePlacement(block, composition, t)}</span>
                      {(block.condition || block.tokenPolicy) && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">{t("prompt_composer.advanced_active")}</span>}
                      {block.compatibility && <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-700 dark:text-sky-300">{block.compatibility.source}</span>}
                    </div>
                  </button>

                  <div className="flex w-9 shrink-0 flex-col border-l border-border">
                    <button type="button" disabled={index === 0} onClick={() => moveBlock(index, -1)} aria-label={t("prompt_composer.move_up")} className="flex flex-1 items-center justify-center disabled:opacity-20"><ArrowUp className="h-3 w-3" /></button>
                    <button type="button" disabled={index === composition.blocks.length - 1} onClick={() => moveBlock(index, 1)} aria-label={t("prompt_composer.move_down")} className="flex flex-1 items-center justify-center border-y border-border disabled:opacity-20"><ArrowDown className="h-3 w-3" /></button>
                    <button type="button" onClick={() => deleteBlock(block.id)} aria-label={t("prompt_composer.delete_block")} className="flex flex-1 items-center justify-center text-destructive"><Trash2 className="h-3 w-3" /></button>
                  </div>
                </article>
              ))}
            </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <ToolbarButton onClick={() => addBlock("template")} icon={<MessageSquarePlus className="h-4 w-4" />}>{t("prompt_composer.add_message")}</ToolbarButton>
                <ToolbarButton onClick={() => addBlock("chat_history")} icon={<History className="h-4 w-4" />}>{t("prompt_composer.add_history")}</ToolbarButton>
                <ToolbarButton
                  onClick={() => { if (window.confirm(t("prompt_composer.confirm_reset"))) updateComposition(createBasicPromptComposition()); }}
                  icon={<RotateCcw className="h-4 w-4" />}
                >{t("prompt_composer.reset_example")}</ToolbarButton>
              </div>

              {isWideWorkbench && editingBlock && (
                <PromptBlockQuickEditor
                  block={editingBlock}
                  historyBlocks={historyBlocks}
                  onPatch={(patch) => updateBlock(editingBlock.id, patch)}
                  onClose={() => setEditingBlockId(undefined)}
                  onDelete={() => deleteBlock(editingBlock.id)}
                  onDuplicate={() => duplicateBlock(editingBlock.id)}
                  onOpenFullEditor={() => setFullEditorOpen(true)}
                />
              )}
            </div>

            {isWideWorkbench && (
              <div className="sticky top-3">
                <PromptCompositionWorkbench
                  embedded
                  composition={composition}
                  preview={preview}
                  selectedBlockId={editingBlockId}
                  view={workbenchView}
                  onViewChange={setWorkbenchView}
                  onSelectBlock={setEditingBlockId}
                />
              </div>
            )}
          </div>
        </>
      )}

      <PromptBlockEditorDialog
        block={!isWideWorkbench || fullEditorOpen ? editingBlock : undefined}
        historyBlocks={historyBlocks}
        onClose={() => { setFullEditorOpen(false); if (!isWideWorkbench) setEditingBlockId(undefined); }}
        onPatch={(patch) => editingBlock && updateBlock(editingBlock.id, patch)}
        onDelete={() => editingBlock && deleteBlock(editingBlock.id)}
        onDuplicate={() => editingBlock && duplicateBlock(editingBlock.id)}
      />
      <PromptCompositionPreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} preview={preview} />
      {!isWideWorkbench && (
        <PromptCompositionWorkbench
          composition={composition}
          preview={preview}
          selectedBlockId={editingBlockId}
          view={workbenchView}
          onViewChange={setWorkbenchView}
          onSelectBlock={(blockId) => { setWorkbenchOpen(false); setEditingBlockId(blockId); }}
          open={workbenchOpen}
          onOpenChange={setWorkbenchOpen}
        />
      )}
    </section>
  );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`rounded-lg px-3 py-2 text-xs font-bold transition ${active ? "bg-background text-primary shadow-sm ring-1 ring-border" : "text-muted-foreground"}`}>{children}</button>;
}

function ToolbarButton({ onClick, icon, children }: { onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return <button type="button" onClick={onClick} className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-2 text-[10px] font-bold active:bg-muted">{icon}{children}</button>;
}

function RoleBadge({ role }: { role: string }) {
  const classes = role === "system"
    ? "bg-violet-500/15 text-violet-600 dark:text-violet-300"
    : role === "assistant"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
      : role === "history"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
        : "bg-sky-500/15 text-sky-600 dark:text-sky-300";
  return <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold ${classes}`}>{role.toUpperCase()}</span>;
}

function describeSource(block: PromptBlock, t: (key: string, params?: Record<string, string>) => string): string {
  if (block.source.type === "template") return t("prompt_composer.template_source");
  if (block.source.selection?.mode === "recent") {
    return t("prompt_composer.recent_count", { count: String(block.source.selection.count) });
  }
  return t("prompt_composer.all_messages");
}

function describePlacement(block: PromptBlock, composition: PromptComposition, t: (key: string, params?: Record<string, string>) => string): string {
  if (block.placement.type === "ordered") return t("prompt_composer.ordered");
  const placement = block.placement;
  const target = composition.blocks.find((candidate) => candidate.id === placement.historyBlockId)?.name;
  return target
    ? t("prompt_composer.depth_target", { depth: String(placement.depth), target })
    : t("prompt_composer.depth_all", { depth: String(placement.depth) });
}
