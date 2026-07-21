import {
  ArrowDown,
  ArrowUp,
  AlertTriangle,
  CheckCircle2,
  CloudAlert,
  Eye,
  GitBranch,
  GripVertical,
  History,
  LoaderCircle,
  MessageSquarePlus,
  RotateCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { PromptBlock, PromptComposition } from "../../domain/prompt-composition";
import type { PromptCompositionTemplateRecord } from "../../domain/prompt-composition";
import {
  createBasicPromptComposition,
  createPromptCompositionTemplateRecord,
  validatePromptComposition,
} from "../../domain/prompt-composition";
import type { UserSettings } from "../../types";
import type { SettingsSaveState } from "../../hooks/settings/useSettingsPersistence";
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
import PromptCompositionBudgetSettings from "./PromptCompositionBudgetSettings";
import { PROMPT_DATA_SOURCE_KEYS } from "./promptDataSources";
import PromptCompositionTemplateManager from "./PromptCompositionTemplateManager";
import { usePromptWorkbenchFocus } from "../../contexts/PromptWorkbenchFocusContext";
import { PromptComposerButton, PromptComposerInput } from "./PromptComposerControls";
import { useUnifiedApp } from "../../UnifiedAppContext";

export type { PromptCompositionPreviewData } from "./promptCompositionEditorTypes";

interface PromptCompositionEditorProps {
  settings: UserSettings;
  updateSettings: (updater: UserSettings | ((previous: UserSettings) => UserSettings)) => void;
  preview?: PromptCompositionPreviewData;
  saveState?: SettingsSaveState;
  lastSavedAt?: number;
}

export default function PromptCompositionEditor({
  settings,
  updateSettings,
  preview,
  saveState = "idle",
  lastSavedAt,
}: PromptCompositionEditorProps) {
  const { t } = useTranslation();
  const showCustomConfirm = useUnifiedApp((state) => state.showCustomConfirm);
  const composition = settings.promptConfig.composition ?? createBasicPromptComposition();
  const [editingBlockId, setEditingBlockId] = useState<string>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [workbenchView, setWorkbenchView] = useState<PromptWorkbenchView>("graph");
  const [fullEditorOpen, setFullEditorOpen] = useState(false);
  const [dragTargetId, setDragTargetId] = useState<string>();
  const [draggingId, setDraggingId] = useState<string>();
  const [dragAnnouncement, setDragAnnouncement] = useState("");
  const isWideWorkbench = useWidePromptWorkbench();
  const promptFocus = usePromptWorkbenchFocus();
  const orientationControl = useAndroidOrientationControl({
    forcedLandscape: promptFocus.managed ? promptFocus.active : undefined,
    onOrientationChange: promptFocus.setActive,
  });
  const blockListRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    sourceId: string;
    targetId: string;
    pointerId: number;
    handle: HTMLButtonElement;
  }>();
  const editingBlock = composition.blocks.find((block) => block.id === editingBlockId);
  const historyBlocks = composition.blocks.filter((block) => block.source.type === "chat_history");
  const freeMode = settings.promptConfig.usePromptComposition === true;
  const validationDiagnostics = useMemo(
    () => validatePromptComposition(composition, { availableDataKeys: PROMPT_DATA_SOURCE_KEYS }),
    [composition]
  );

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

  const saveTemplate = (value: PromptComposition, source: "user" | "external" = "user") => {
    const record = createPromptCompositionTemplateRecord(value, source);
    updateSettings((previous) => ({
      ...previous,
      promptCompositionTemplates: [...(previous.promptCompositionTemplates || []), record],
    }));
  };

  const loadTemplate = (template: PromptCompositionTemplateRecord) => {
    updateComposition(structuredClone(template.composition));
    setEditingBlockId(undefined);
  };

  const deleteTemplate = async (template: PromptCompositionTemplateRecord) => {
    if (!await showCustomConfirm(t("prompt_composer.confirm_delete_template", { name: template.name }))) return;
    updateSettings((previous) => ({
      ...previous,
      promptCompositionTemplates: (previous.promptCompositionTemplates || []).filter((item) => item.id !== template.id),
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

  const reorder = useCallback((sourceId: string, targetId: string) => {
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
  }, [composition, updateComposition]);

  const moveBlock = (index: number, offset: -1 | 1) => {
    const target = composition.blocks[index + offset];
    const source = composition.blocks[index];
    if (source && target) reorder(source.id, target.id);
  };

  const deleteBlock = async (id: string) => {
    if (!await showCustomConfirm(t("prompt_composer.confirm_delete"))) return;
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
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      sourceId: blockId,
      targetId: blockId,
      pointerId: event.pointerId,
      handle: event.currentTarget,
    };
    setDraggingId(blockId);
    const source = composition.blocks.find((block) => block.id === blockId);
    setDragAnnouncement(t("prompt_composer.drag_started", { name: source?.name ?? blockId }));
    setDragTargetId(blockId);
  };

  const updateDragTarget = useCallback((pointerId: number, clientY: number) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    const candidates: HTMLElement[] = blockListRef.current
      ? Array.from(blockListRef.current.querySelectorAll<HTMLElement>("[data-prompt-block-id]"))
      : [];
    const target = candidates.reduce<HTMLElement | undefined>((closest, candidate) => {
      if (!closest) return candidate;
      const closestRect = closest.getBoundingClientRect();
      const candidateRect = candidate.getBoundingClientRect();
      const closestDistance = Math.abs(clientY - (closestRect.top + closestRect.bottom) / 2);
      const candidateDistance = Math.abs(clientY - (candidateRect.top + candidateRect.bottom) / 2);
      return candidateDistance < closestDistance ? candidate : closest;
    }, undefined);
    const targetId = target?.dataset.promptBlockId;
    if (!targetId || targetId === drag.targetId) return;
    drag.targetId = targetId;
    setDragTargetId(targetId);
    const targetBlock = composition.blocks.find((block) => block.id === targetId);
    if (targetBlock) setDragAnnouncement(t("prompt_composer.drag_over", { name: targetBlock.name }));
  }, [composition.blocks, t]);

  const finishDrag = useCallback((pointerId: number, commit: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    const targetBlock = composition.blocks.find((block) => block.id === drag.targetId);
    if (commit) {
      reorder(drag.sourceId, drag.targetId);
      if (targetBlock) setDragAnnouncement(t("prompt_composer.drag_completed", { name: targetBlock.name }));
    }
    if (drag.handle.hasPointerCapture?.(pointerId)) drag.handle.releasePointerCapture?.(pointerId);
    dragRef.current = undefined;
    setDragTargetId(undefined);
    setDraggingId(undefined);
  }, [composition.blocks, reorder, t]);

  useEffect(() => {
    if (!draggingId) return;
    const handlePointerMove = (event: PointerEvent) => {
      if (dragRef.current?.pointerId !== event.pointerId) return;
      event.preventDefault();
      updateDragTarget(event.pointerId, event.clientY);
    };
    const handlePointerUp = (event: PointerEvent) => finishDrag(event.pointerId, true);
    const handlePointerCancel = (event: PointerEvent) => finishDrag(event.pointerId, false);
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [draggingId, finishDrag, updateDragTarget]);

  const compatibilityCount = composition.blocks.filter((block) => block.compatibility).length +
    (composition.compatibility?.preservedRootFields ? Object.keys(composition.compatibility.preservedRootFields).length : 0);

  return (
    <section className={`rounded-xl border border-primary/25 bg-primary/5 ${isWideWorkbench ? "space-y-2 p-2" : "space-y-3 p-3"}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold">{t("prompt_composer.title")}</div>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{t("prompt_composer.description")}</p>
        </div>
        {(freeMode || promptFocus.active) && orientationControl.available && (
          <PromptComposerButton
            type="button"
            aria-pressed={orientationControl.forcedLandscape}
            onClick={orientationControl.toggleOrientation}
            className="shrink-0 border-primary/35 bg-primary/15 px-2.5 text-[10px] text-primary hover:bg-primary/20 active:bg-primary/25"
          >
            <RotateCw className="h-3.5 w-3.5" />
            {t(orientationControl.forcedLandscape
              ? "prompt_composer.restore_auto_rotation"
              : "prompt_composer.enter_landscape")}
          </PromptComposerButton>
        )}
      </div>

      {!promptFocus.active && (
        <div className="grid grid-cols-2 rounded-xl border border-border bg-muted/50 p-1" role="group" aria-label={t("prompt_composer.mode")}>
          <ModeButton active={!freeMode} onClick={() => setMode(false)}>{t("prompt_composer.legacy_mode")}</ModeButton>
          <ModeButton active={freeMode} onClick={() => setMode(true)}>{t("prompt_composer.free_mode")}</ModeButton>
        </div>
      )}

      {(freeMode || promptFocus.active) && (
        <>
          <div className={isWideWorkbench ? "grid grid-cols-[minmax(300px,0.85fr)_minmax(400px,1.15fr)] items-start gap-2 min-[1100px]:grid-cols-[minmax(300px,0.72fr)_minmax(340px,0.82fr)_minmax(420px,1fr)]" : "space-y-3"}>
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
                {t("prompt_composer.no_hidden_prompt")}
              </div>

              <SaveStatus state={saveState} lastSavedAt={lastSavedAt} t={t} />

              <PromptCompositionTransferToolbar
                composition={composition}
                canUndo={compositionHistory.canUndo}
                canRedo={compositionHistory.canRedo}
                onUndo={compositionHistory.undo}
                onRedo={compositionHistory.redo}
                onImport={(imported) => {
                  updateComposition(imported);
                  saveTemplate(imported, imported.compatibility?.source === "sillytavern" ? "external" : "user");
                  setEditingBlockId(undefined);
                }}
              />

              <PromptCompositionTemplateManager
                composition={composition}
                templates={settings.promptCompositionTemplates || []}
                onSave={() => saveTemplate(composition)}
                onLoad={loadTemplate}
                onDelete={deleteTemplate}
                onLoadBasic={() => updateComposition(createBasicPromptComposition())}
              />

              <div className="flex gap-2">
                <PromptComposerInput
                  value={composition.name}
                  onChange={(event) => updateComposition({ ...composition, name: event.target.value }, "composition-name")}
                  aria-label={t("prompt_composer.composition_name")}
                  className="min-w-0 flex-1"
                />
                {!isWideWorkbench && (
                  <>
                    <PromptComposerButton
                      type="button"
                      onClick={() => { setWorkbenchView("graph"); setWorkbenchOpen(true); }}
                      className="shrink-0 gap-1.5 px-2.5"
                    >
                      <GitBranch className="h-3.5 w-3.5" />{t("prompt_composer.graph")}
                    </PromptComposerButton>
                    <PromptComposerButton
                      type="button"
                      onClick={() => setPreviewOpen(true)}
                      className="shrink-0 gap-1.5 border-primary/25 bg-primary/10 px-2.5 text-primary hover:bg-primary/15"
                    >
                      <Eye className="h-3.5 w-3.5" />{t("prompt_composer.preview")}
                    </PromptComposerButton>
                  </>
                )}
              </div>

              {compatibilityCount > 0 && (
                <div className="rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-[10px] text-sky-700 dark:text-sky-300">
                  {t("prompt_composer.compatibility_summary", { count: String(compatibilityCount), source: composition.compatibility?.source ?? "external" })}
                </div>
              )}

              <PromptCompositionBudgetSettings
                composition={composition}
                preview={preview}
                onChange={(next) => updateComposition(next, "token-budget")}
              />

              {validationDiagnostics.length > 0 && (
                <section className="space-y-1.5 rounded-xl border border-destructive/30 bg-destructive/5 p-3" aria-live="polite">
                  <div className="flex items-center gap-2 text-xs font-bold text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    {t("prompt_composer.validation_title", { count: String(validationDiagnostics.length) })}
                  </div>
                  {validationDiagnostics.map((diagnostic, index) => (
                    <PromptComposerButton
                      type="button"
                      key={`${diagnostic.code}-${diagnostic.blockId ?? "root"}-${index}`}
                      onClick={() => diagnostic.blockId && setEditingBlockId(diagnostic.blockId)}
                      variant="ghost"
                      className="block h-auto min-h-7 w-full justify-start rounded-md px-1 py-0.5 text-left text-[10px] leading-relaxed text-destructive/90 shadow-none hover:bg-destructive/10"
                    >
                      <code className="mr-1 font-bold">{diagnostic.code}</code>{diagnostic.message}
                    </PromptComposerButton>
                  ))}
                </section>
              )}

              {composition.blocks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-destructive/35 bg-destructive/5 p-5 text-center text-xs text-destructive">
              {t("prompt_composer.empty_send_warning")}
            </div>
              ) : (
            <div ref={blockListRef} className="space-y-2">
              {composition.blocks.map((block, index) => {
                const blockDiagnosticCount = validationDiagnostics.filter((diagnostic) => diagnostic.blockId === block.id).length;
                return (
                <article
                  key={`${block.id}-${index}`}
                  data-prompt-block-id={block.id}
                  className={`relative flex items-stretch overflow-hidden rounded-xl border bg-background transition duration-150 ${dragTargetId === block.id && draggingId !== block.id ? "border-primary ring-2 ring-primary/20 before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-primary" : blockDiagnosticCount > 0 ? "border-destructive/60" : "border-border"} ${draggingId === block.id ? "scale-[0.985] opacity-65 shadow-lg" : block.enabled ? "" : "opacity-55"}`}
                >
                  <PromptComposerButton
                    type="button"
                    aria-label={t("prompt_composer.drag_block", { name: block.name })}
                    onPointerDown={(event) => handleDragStart(event, block.id)}
                    onPointerMove={(event) => updateDragTarget(event.pointerId, event.clientY)}
                    onPointerUp={(event) => finishDrag(event.pointerId, true)}
                    onPointerCancel={(event) => finishDrag(event.pointerId, false)}
                    variant="ghost"
                    className="h-auto min-h-full touch-none rounded-none border-0 border-r border-border px-2 text-muted-foreground shadow-none active:bg-muted"
                  >
                    <GripVertical className="h-4 w-4" />
                  </PromptComposerButton>

                  <PromptComposerButton
                    type="button"
                    aria-label={t("prompt_composer.edit_block", { name: block.name })}
                    onClick={() => setEditingBlockId(block.id)}
                    variant="ghost"
                    className="h-auto min-h-16 min-w-0 flex-1 justify-start rounded-none border-0 p-3 text-left shadow-none hover:bg-muted/30 active:scale-100"
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
                      {blockDiagnosticCount > 0 && <span className="rounded bg-destructive/10 px-1.5 py-0.5 font-bold text-destructive">{t("prompt_composer.validation_badge", { count: String(blockDiagnosticCount) })}</span>}
                    </div>
                  </PromptComposerButton>

                  <div className="flex w-9 shrink-0 flex-col border-l border-border">
                    <PromptComposerButton variant="ghost" size="icon-xs" disabled={index === 0} onClick={() => moveBlock(index, -1)} aria-label={t("prompt_composer.move_up")} className="h-auto min-h-0 flex-1 rounded-none border-0 shadow-none disabled:opacity-20"><ArrowUp className="h-3 w-3" /></PromptComposerButton>
                    <PromptComposerButton variant="ghost" size="icon-xs" disabled={index === composition.blocks.length - 1} onClick={() => moveBlock(index, 1)} aria-label={t("prompt_composer.move_down")} className="h-auto min-h-0 flex-1 rounded-none border-x-0 border-y border-border shadow-none disabled:opacity-20"><ArrowDown className="h-3 w-3" /></PromptComposerButton>
                    <PromptComposerButton variant="ghost" size="icon-xs" onClick={() => deleteBlock(block.id)} aria-label={t("prompt_composer.delete_block")} className="h-auto min-h-0 flex-1 rounded-none border-0 text-destructive shadow-none hover:bg-destructive/10"><Trash2 className="h-3 w-3" /></PromptComposerButton>
                  </div>
                </article>
                );
              })}
            </div>
              )}

              <p className="sr-only" role="status" aria-live="assertive">{dragAnnouncement}</p>

              <div className="grid grid-cols-3 gap-2">
                <ToolbarButton onClick={() => addBlock("template")} icon={<MessageSquarePlus className="h-4 w-4" />}>{t("prompt_composer.add_message")}</ToolbarButton>
                <ToolbarButton onClick={() => addBlock("chat_history")} icon={<History className="h-4 w-4" />}>{t("prompt_composer.add_history")}</ToolbarButton>
                <ToolbarButton
                  onClick={async () => {
                    if (await showCustomConfirm(t("prompt_composer.confirm_reset"))) {
                      updateComposition(createBasicPromptComposition());
                    }
                  }}
                  icon={<RotateCcw className="h-4 w-4" />}
                >{t("prompt_composer.reset_example")}</ToolbarButton>
              </div>

            </div>

            {isWideWorkbench && (
              <div className="sticky top-2 space-y-2 min-[1100px]:col-span-2 min-[1100px]:grid min-[1100px]:grid-cols-[minmax(340px,0.82fr)_minmax(420px,1fr)] min-[1100px]:items-start">
                {editingBlock && (
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

function SaveStatus({
  state,
  lastSavedAt,
  t,
}: {
  state: SettingsSaveState;
  lastSavedAt?: number;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const isBusy = state === "pending" || state === "saving";
  const isError = state === "error";
  const Icon = isError ? CloudAlert : isBusy ? LoaderCircle : CheckCircle2;
  const label = state === "pending"
    ? t("prompt_composer.save_pending")
    : state === "saving"
      ? t("prompt_composer.save_saving")
      : state === "error"
        ? t("prompt_composer.save_error")
        : state === "saved" && lastSavedAt
          ? t("prompt_composer.save_saved_at", { time: new Date(lastSavedAt).toLocaleTimeString() })
          : t("prompt_composer.save_ready");
  return (
    <div role="status" aria-live="polite" className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[10px] ${isError ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-border bg-background/70 text-muted-foreground"}`}>
      <Icon className={`h-3.5 w-3.5 ${isBusy ? "animate-spin text-primary" : ""}`} />{label}
    </div>
  );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <PromptComposerButton aria-pressed={active} onClick={onClick} variant="ghost" className={`border-0 px-3 shadow-none ${active ? "bg-background text-primary shadow-sm ring-1 ring-border hover:bg-background" : "text-muted-foreground"}`}>{children}</PromptComposerButton>;
}

function ToolbarButton({ onClick, icon, children }: { onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return <PromptComposerButton onClick={onClick} className="min-h-11 gap-1.5 rounded-xl px-2 text-[10px]">{icon}{children}</PromptComposerButton>;
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
