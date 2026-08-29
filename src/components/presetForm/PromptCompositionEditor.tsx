import {
  ArrowDown,
  ArrowUp,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  CloudAlert,
  Eye,
  GitBranch,
  GripVertical,
  History,
  HelpCircle,
  Lightbulb,
  LoaderCircle,
  MessageSquarePlus,
  CheckSquare2,
  Settings2,
  Sparkles,
  Square,
  RotateCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import PromptSceneProfileManager from "./PromptSceneProfileManager";
import PromptBlockListToolbar from "./PromptBlockListToolbar";
import {
  buildPromptBlockListGroups,
  estimatePromptBlockTokens,
  patchSelectedBlockStates,
  removePromptBlocks,
  type PromptBlockGroupMode,
  type PromptBlockSortMode,
} from "./promptBlockListTools";
import { usePromptWorkbenchFocus } from "../../contexts/PromptWorkbenchFocusContext";
import { PromptComposerButton, PromptComposerInput } from "./PromptComposerControls";
import { useUnifiedApp } from "../../UnifiedAppContext";
import { useMobileBackHandler } from "../../hooks/useMobileBackHandler";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";

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
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [dragTargetId, setDragTargetId] = useState<string>();
  const [draggingId, setDraggingId] = useState<string>();
  const [dragAnnouncement, setDragAnnouncement] = useState("");
  const [blockQuery, setBlockQuery] = useState("");
  const [blockGroupMode, setBlockGroupMode] = useState<PromptBlockGroupMode>("none");
  const [blockSortMode, setBlockSortMode] = useState<PromptBlockSortMode>("order");
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(() => new Set());
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
  } | null>(null);
  const editingBlock = composition.blocks.find((block) => block.id === editingBlockId);
  const historyBlocks = composition.blocks.filter((block) => block.source.type === "chat_history");
  const freeMode = settings.promptConfig.usePromptComposition === true;
  const validationDiagnostics = useMemo(
    () => validatePromptComposition(composition, { availableDataKeys: PROMPT_DATA_SOURCE_KEYS }),
    [composition]
  );
  const diagnosticCountsByBlockId = useMemo(() => {
    const map = new Map<string, number>();
    for (const diagnostic of validationDiagnostics) {
      if (diagnostic.blockId) {
        map.set(diagnostic.blockId, (map.get(diagnostic.blockId) || 0) + 1);
      }
    }
    return map;
  }, [validationDiagnostics]);
  const blockNamesById = useMemo(() => {
    return new Map(composition.blocks.map((b) => [b.id, b.name]));
  }, [composition.blocks]);
  const tokenByBlockId = useMemo(
    () => {
      const traced = new Map((preview?.traces ?? []).map((trace) => [trace.blockId, trace.estimatedTokens]));
      return new Map(composition.blocks.map((block) => [
        block.id,
        traced.get(block.id) ?? estimatePromptBlockTokens(block),
      ]));
    },
    [composition.blocks, preview?.traces],
  );
  const blockGroups = useMemo(() => buildPromptBlockListGroups({
    blocks: composition.blocks,
    query: blockQuery,
    groupMode: blockGroupMode,
    sortMode: blockSortMode,
    tokenByBlockId,
  }), [blockGroupMode, blockQuery, blockSortMode, composition.blocks, tokenByBlockId]);
  const visibleBlockItems = blockGroups.flatMap((group) => group.items);
  const visibleBlockIds = visibleBlockItems.map((item) => item.block.id);
  const visibleTokens = visibleBlockItems.reduce((total, item) => total + item.estimatedTokens, 0);

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

  const batchSetEnabled = (enabled: boolean) => {
    updateComposition(patchSelectedBlockStates(composition, selectedBlockIds, enabled), `batch:${enabled ? "enable" : "disable"}`);
  };

  const batchDelete = async () => {
    if (selectedBlockIds.size === 0 || !await showCustomConfirm(t("prompt_composer.batch_delete_confirm", { count: String(selectedBlockIds.size) }))) return;
    updateComposition(removePromptBlocks(composition, selectedBlockIds), "batch:delete");
    setSelectedBlockIds(new Set());
    if (editingBlockId && selectedBlockIds.has(editingBlockId)) setEditingBlockId(undefined);
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

  const moveBlock = useCallback((index: number, offset: -1 | 1) => {
    const target = composition.blocks[index + offset];
    const source = composition.blocks[index];
    if (source && target) reorder(source.id, target.id);
  }, [composition.blocks, reorder]);

  const deleteBlock = useCallback(async (id: string) => {
    if (!await showCustomConfirm(t("prompt_composer.confirm_delete"))) return;
    updateComposition(removePromptBlocks(composition, new Set([id])));
    setSelectedBlockIds((previous) => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
    if (editingBlockId === id) setEditingBlockId(undefined);
  }, [composition, editingBlockId, showCustomConfirm, t, updateComposition]);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedBlockIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleEditBlock = useCallback((id: string) => {
    setEditingBlockId(id);
  }, []);

  useEffect(() => {
    const currentIds = new Set(composition.blocks.map((block) => block.id));
    setSelectedBlockIds((previous) => {
      const next = new Set([...previous].filter((id) => currentIds.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [composition.blocks]);

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

  const handleDragStart = useCallback((event: ReactPointerEvent<HTMLButtonElement>, blockId: string) => {
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
  }, [composition.blocks, t]);

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
    dragRef.current = null;
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
    <section className={`w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-primary/25 bg-primary/5 ${isWideWorkbench ? "space-y-2 p-2" : "space-y-2.5 p-2.5"}`}>
      {/* 顶部紧凑控制栏 */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 pb-2 border-b border-border/50">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <PromptComposerInput
            value={composition.name}
            onChange={(event) => updateComposition({ ...composition, name: event.target.value }, "composition-name")}
            aria-label={t("prompt_composer.composition_name")}
            className="h-8 text-xs font-bold min-w-[120px] max-w-[220px] flex-1"
          />
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <PromptComposerButton
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="h-8 gap-1 border-primary/25 bg-primary/10 px-2 text-xs text-primary font-bold hover:bg-primary/15"
          >
            <Eye className="h-3.5 w-3.5" />
            {t("prompt_composer.preview")}
          </PromptComposerButton>
          <PromptComposerButton
            type="button"
            onClick={() => setTutorialOpen(true)}
            className="h-8 gap-1 border-border bg-background/80 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            {t("prompt_composer.tutorial")}
          </PromptComposerButton>
          {!isWideWorkbench && (
            <PromptComposerButton
              type="button"
              aria-expanded={showAdvancedOptions}
              onClick={() => setShowAdvancedOptions((prev) => !prev)}
              className={`h-8 gap-1 px-2 text-xs transition ${showAdvancedOptions ? "bg-primary/20 text-primary border-primary/30" : "text-muted-foreground border-border"}`}
            >
              <Settings2 className="h-3.5 w-3.5" />
              <span>{t("prompt_composer.advanced_toggle")}</span>
              <ChevronDown className={`h-3 w-3 transition-transform ${showAdvancedOptions ? "rotate-180" : ""}`} />
            </PromptComposerButton>
          )}
        </div>
      </div>

      {/* 极简状态行 */}
      <div className="flex items-center justify-between gap-2 px-1 text-[10px] text-muted-foreground font-mono">
        <SaveStatus state={saveState} lastSavedAt={lastSavedAt} t={t} />
        {compatibilityCount > 0 && (
          <span className="rounded bg-sky-500/10 px-2 py-0.5 text-sky-700 dark:text-sky-300 font-sans">
            {t("prompt_composer.st_compat_badge", { count: String(compatibilityCount) })}
          </span>
        )}
      </div>

      {/* 全宽模式切换 */}
      {!promptFocus.active && (
        <div className="grid grid-cols-2 rounded-xl border border-border bg-muted/50 p-1 w-full" role="group" aria-label={t("prompt_composer.mode")}>
          <ModeButton active={!freeMode} onClick={() => setMode(false)}>{t("prompt_composer.legacy_mode")}</ModeButton>
          <ModeButton active={freeMode} onClick={() => setMode(true)}>{t("prompt_composer.free_mode")}</ModeButton>
        </div>
      )}

      {!freeMode && !promptFocus.active && <TraditionalPromptFlow />}

      {(freeMode || promptFocus.active) && (
        <>
          {(showAdvancedOptions || isWideWorkbench) && (
            <div className="space-y-2 rounded-xl border border-border/80 bg-muted/20 p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px] font-bold text-foreground">
                <span className="flex items-center gap-1.5">
                  <Settings2 className="h-3.5 w-3.5 text-primary" />
                  <span>{t("prompt_composer.advanced_tools_title")}</span>
                </span>
                <div className="flex items-center gap-1.5">
                  {orientationControl.available && (
                    <PromptComposerButton
                      type="button"
                      aria-pressed={orientationControl.forcedLandscape}
                      onClick={orientationControl.toggleOrientation}
                      className="h-6 gap-1 px-1.5 text-[9px] text-primary"
                    >
                      <RotateCw className="h-3 w-3" />
                      {t(orientationControl.forcedLandscape
                        ? "prompt_composer.restore_auto_rotation"
                        : "prompt_composer.enter_landscape")}
                    </PromptComposerButton>
                  )}
                  {!isWideWorkbench && (
                    <PromptComposerButton
                      type="button"
                      onClick={() => { setWorkbenchView("graph"); setWorkbenchOpen(true); }}
                      className="h-6 gap-1 px-1.5 text-[9px]"
                    >
                      <GitBranch className="h-3 w-3" />
                      {t("prompt_composer.graph")}
                    </PromptComposerButton>
                  )}
                </div>
              </div>

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
                onLoadScene={(preset, localizedName) => {
                  updateComposition({ ...structuredClone(preset.composition), name: localizedName });
                  setEditingBlockId(undefined);
                }}
              />

              <PromptCompositionBudgetSettings
                composition={composition}
                preview={preview}
                onChange={(next) => updateComposition(next, "token-budget")}
              />

              <PromptSceneProfileManager
                composition={composition}
                onChange={(next) => updateComposition(next, "scene-profiles")}
              />
            </div>
          )}

          {/* 主工作区 */}
          <div className={isWideWorkbench ? "grid grid-cols-[minmax(300px,0.85fr)_minmax(400px,1.15fr)] items-start gap-2 min-[1100px]:grid-cols-[minmax(300px,0.72fr)_minmax(340px,0.82fr)_minmax(420px,1fr)]" : "space-y-2"}>
            <div className="space-y-2">
              <PromptBlockListToolbar
                query={blockQuery}
                onQueryChange={setBlockQuery}
                groupMode={blockGroupMode}
                onGroupModeChange={setBlockGroupMode}
                sortMode={blockSortMode}
                onSortModeChange={setBlockSortMode}
                visibleCount={visibleBlockItems.length}
                totalCount={composition.blocks.length}
                visibleTokens={visibleTokens}
                selectedCount={selectedBlockIds.size}
                onSelectVisible={() => setSelectedBlockIds(new Set(visibleBlockIds))}
                onClearSelection={() => setSelectedBlockIds(new Set())}
                onSetEnabled={batchSetEnabled}
                onDelete={() => void batchDelete()}
              />

              {validationDiagnostics.length > 0 && (
                <section className="space-y-1.5 rounded-xl border border-destructive/30 bg-destructive/5 p-2.5 min-w-0 max-w-full overflow-hidden" aria-live="polite">
                  <div className="flex items-center gap-2 text-xs font-bold text-destructive min-w-0 truncate">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{t("prompt_composer.validation_title", { count: String(validationDiagnostics.length) })}</span>
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-1 pr-1 min-w-0 max-w-full">
                    {validationDiagnostics.map((diagnostic, index) => (
                      <PromptComposerButton
                        type="button"
                        key={`${diagnostic.code}-${diagnostic.blockId ?? "root"}-${index}`}
                        onClick={() => diagnostic.blockId && setEditingBlockId(diagnostic.blockId)}
                        variant="ghost"
                        className="flex h-auto min-h-6 w-full min-w-0 max-w-full justify-start rounded-md px-1.5 py-0.5 text-left text-[10px] leading-relaxed text-destructive/90 shadow-none hover:bg-destructive/10 break-all"
                      >
                        <code className="mr-1 font-bold font-mono shrink-0">{diagnostic.code}</code>
                        <span className="min-w-0 break-all">{diagnostic.message}</span>
                      </PromptComposerButton>
                    ))}
                  </div>
                </section>
              )}

              {composition.blocks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-destructive/35 bg-destructive/5 p-5 text-center text-xs text-destructive">
                  {t("prompt_composer.empty_send_warning")}
                </div>
              ) : (
                <div ref={blockListRef} className="space-y-1.5">
                  {visibleBlockItems.length === 0 && (
                    <div className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
                      {t("prompt_composer.list_empty")}
                    </div>
                  )}
                  {blockGroups.map((group) => (
                    <section key={group.key} className="space-y-1.5">
                      {blockGroupMode !== "none" && (
                        <header className="flex items-center gap-2 px-1 text-[10px] font-bold text-muted-foreground">
                          <span>{describeBlockGroup(group.key, t)}</span>
                          <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[9px]">{group.items.length}</span>
                        </header>
                      )}
                      {group.items.map(({ block, index, estimatedTokens }) => (
                        <PromptBlockItemRow
                          key={block.id}
                          block={block}
                          index={index}
                          totalBlocks={composition.blocks.length}
                          estimatedTokens={estimatedTokens}
                          diagnosticCount={diagnosticCountsByBlockId.get(block.id) || 0}
                          selected={selectedBlockIds.has(block.id)}
                          isDragging={draggingId === block.id}
                          isDragTarget={dragTargetId === block.id}
                          isOrderSort={blockSortMode === "order"}
                          targetPlacementName={block.placement.type === "ordered" ? undefined : blockNamesById.get(block.placement.historyBlockId || "")}
                          onToggleSelect={handleToggleSelect}
                          onEdit={handleEditBlock}
                          onMove={moveBlock}
                          onDelete={deleteBlock}
                          onDragStart={handleDragStart}
                          onDragMove={(e) => updateDragTarget(e.pointerId, e.clientY)}
                          onDragEnd={(pointerId) => finishDrag(pointerId, true)}
                          onDragCancel={(pointerId) => finishDrag(pointerId, false)}
                          t={t}
                        />
                      ))}
                    </section>
                  ))}
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
      <PromptCompositionTutorial open={tutorialOpen} onOpenChange={setTutorialOpen} />
    </section>
  );
}

function TraditionalPromptFlow() {
  const { t } = useTranslation();
  const steps = t("prompt_composer.legacy_flow_steps").split("|");
  return (
    <section className="rounded-xl border border-border bg-background/70 p-3" aria-label={t("prompt_composer.legacy_flow_title")}>
      <div className="text-xs font-bold text-foreground">{t("prompt_composer.legacy_flow_title")}</div>
      <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">{t("prompt_composer.legacy_flow_description")}</p>
      <div className="mt-3 flex flex-col items-center gap-1.5">
        {steps.map((step, index) => (
          <div key={`${step}-${index}`} className="contents">
            <div className="w-full rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-center text-[10px] font-semibold text-foreground">
              {step}
            </div>
            {index < steps.length - 1 && <ArrowDown className="h-3.5 w-3.5 text-primary/70" aria-hidden="true" />}
          </div>
        ))}
      </div>
    </section>
  );
}

function PromptCompositionTutorial({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const steps = t("prompt_composer.tutorial_steps").split("|");
  useMobileBackHandler(open, () => {
    onOpenChange(false);
    return true;
  }, 850);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-auto bottom-0 left-1/2 max-h-[88dvh] w-full max-w-xl -translate-x-1/2 translate-y-0 overflow-y-auto rounded-b-none p-0">
        <DialogHeader className="border-b border-border px-4 pb-3 pt-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <BookOpen className="h-4.5 w-4.5 text-primary" />
            {t("prompt_composer.tutorial_title")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
            {t("prompt_composer.tutorial_intro")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 p-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] text-xs text-foreground">
          {/* 四大核心步骤 */}
          <div className="space-y-2">
            <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span>{t("prompt_composer.tutorial_core_title")}</span>
            </div>
            {steps.map((step, index) => (
              <div key={`${step}-${index}`} className="flex gap-2.5 rounded-xl border border-border/70 bg-card/60 p-3 items-start">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary mt-0.5">
                  {index + 1}
                </span>
                <p className="text-[11px] leading-relaxed text-foreground/90">{step}</p>
              </div>
            ))}
          </div>

          {/* 常用宏变量速查 */}
          <div className="space-y-2 rounded-xl border border-border/80 bg-muted/20 p-3">
            <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
              <span>{t("prompt_composer.tutorial_macros_title")}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg border border-border/50 bg-background/80 p-2">
                <code className="text-primary font-bold">{"{{char}}"}</code>
                <p className="text-[10px] text-muted-foreground mt-0.5">{t("prompt_composer.macro_char_desc")}</p>
              </div>
              <div className="rounded-lg border border-border/50 bg-background/80 p-2">
                <code className="text-primary font-bold">{"{{user}}"}</code>
                <p className="text-[10px] text-muted-foreground mt-0.5">{t("prompt_composer.macro_user_desc")}</p>
              </div>
              <div className="rounded-lg border border-border/50 bg-background/80 p-2">
                <code className="text-primary font-bold">{"{{description}}"}</code>
                <p className="text-[10px] text-muted-foreground mt-0.5">{t("prompt_composer.macro_description_desc")}</p>
              </div>
              <div className="rounded-lg border border-border/50 bg-background/80 p-2">
                <code className="text-primary font-bold">{"{{personality}}"}</code>
                <p className="text-[10px] text-muted-foreground mt-0.5">{t("prompt_composer.macro_personality_desc")}</p>
              </div>
            </div>
          </div>

          {/* 传统模式流程对比 */}
          <TraditionalPromptFlow />
        </div>
      </DialogContent>
    </Dialog>
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
    <div role="status" aria-live="polite" className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] ${isError ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-border/60 bg-background/80 text-muted-foreground"}`}>
      <Icon className={`h-3 w-3 shrink-0 ${isBusy ? "animate-spin text-primary" : isError ? "text-destructive" : "text-emerald-500"}`} />
      <span className="truncate">{label}</span>
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

function describeBlockGroup(key: string, t: (key: string, params?: Record<string, string>) => string): string {
  const translationKey = {
    system: "prompt_composer.group_label_system",
    user: "prompt_composer.group_label_user",
    assistant: "prompt_composer.group_label_assistant",
    history: "prompt_composer.group_label_history",
    template: "prompt_composer.group_label_template",
    chat_history: "prompt_composer.group_label_history",
    ordered: "prompt_composer.group_label_ordered",
    in_chat: "prompt_composer.group_label_in_chat",
  }[key];
  return translationKey ? t(translationKey) : key;
}

function describeSource(block: PromptBlock, t: (key: string, params?: Record<string, string>) => string): string {
  if (block.source.type === "template") return t("prompt_composer.template_source");
  if (block.source.selection?.mode === "recent") {
    return t("prompt_composer.recent_count", { count: String(block.source.selection.count) });
  }
  return t("prompt_composer.all_messages");
}

interface PromptBlockItemRowProps {
  block: PromptBlock;
  index: number;
  totalBlocks: number;
  estimatedTokens: number;
  diagnosticCount: number;
  selected: boolean;
  isDragging: boolean;
  isDragTarget: boolean;
  isOrderSort: boolean;
  targetPlacementName?: string;
  onToggleSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onMove: (index: number, offset: -1 | 1) => void;
  onDelete: (id: string) => void;
  onDragStart: (event: ReactPointerEvent<HTMLButtonElement>, id: string) => void;
  onDragMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDragEnd: (pointerId: number) => void;
  onDragCancel: (pointerId: number) => void;
  t: (key: string, params?: Record<string, string>) => string;
}

const PromptBlockItemRow = memo(function PromptBlockItemRow({
  block,
  index,
  totalBlocks,
  estimatedTokens,
  diagnosticCount,
  selected,
  isDragging,
  isDragTarget,
  isOrderSort,
  targetPlacementName,
  onToggleSelect,
  onEdit,
  onMove,
  onDelete,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
  t,
}: PromptBlockItemRowProps) {
  const placementText = block.placement.type === "ordered"
    ? t("prompt_composer.ordered")
    : targetPlacementName
      ? t("prompt_composer.depth_target", { depth: String(block.placement.depth), target: targetPlacementName })
      : t("prompt_composer.depth_all", { depth: String(block.placement.depth) });

  return (
    <article
      data-prompt-block-id={block.id}
      className={`relative grid min-h-[58px] grid-cols-[36px_32px_minmax(0,1fr)_40px] overflow-hidden rounded-xl border bg-background transition duration-100 ${
        selected
          ? "border-primary/70 ring-1 ring-primary/20"
          : isDragTarget && !isDragging
            ? "border-primary ring-2 ring-primary/20 before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-primary"
            : diagnosticCount > 0
              ? "border-destructive/60"
              : "border-border"
      } ${isDragging ? "scale-[0.985] opacity-65 shadow-lg" : block.enabled ? "" : "opacity-50"}`}
    >
      <PromptComposerButton
        type="button"
        aria-label={t("prompt_composer.drag_block", { name: block.name })}
        onPointerDown={(event) => isOrderSort && onDragStart(event, block.id)}
        onPointerMove={onDragMove}
        onPointerUp={(event) => onDragEnd(event.pointerId)}
        onPointerCancel={(event) => onDragCancel(event.pointerId)}
        variant="ghost"
        disabled={!isOrderSort}
        className="h-full min-h-0 w-9 touch-none rounded-none border-0 border-r border-border px-0 text-muted-foreground shadow-none active:bg-muted"
      >
        <GripVertical className="h-4 w-4" />
      </PromptComposerButton>

      <PromptComposerButton
        type="button"
        variant="ghost"
        onClick={() => onToggleSelect(block.id)}
        aria-label={t(selected ? "prompt_composer.unselect_block" : "prompt_composer.select_block", { name: block.name })}
        className="h-full min-h-0 w-8 rounded-none border-0 border-r border-border px-0 text-muted-foreground shadow-none"
      >
        {selected ? <CheckSquare2 className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
      </PromptComposerButton>

      <PromptComposerButton
        type="button"
        aria-label={t("prompt_composer.edit_block", { name: block.name })}
        onClick={() => onEdit(block.id)}
        variant="ghost"
        className="h-full min-h-0 min-w-0 w-full justify-start overflow-hidden rounded-none border-0 p-2.5 text-left shadow-none hover:bg-muted/30 active:scale-100"
      >
        <div className="min-w-0 w-full overflow-hidden">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="w-5 shrink-0 font-mono text-[10px] text-muted-foreground">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-xs font-semibold">{block.name}</span>
            <RoleBadge role={block.source.type === "chat_history" ? "history" : block.role} />
          </div>
          <div className="mt-1 flex min-w-0 gap-1 overflow-hidden pl-6 text-[9px] text-muted-foreground">
            <span className="max-w-[48%] min-w-0 truncate rounded bg-muted px-1.5 py-0.5">{describeSource(block, t)}</span>
            <span className="max-w-[48%] min-w-0 truncate rounded bg-muted px-1.5 py-0.5">{placementText}</span>
            {(block.condition || block.tokenPolicy) && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">{t("prompt_composer.advanced_active")}</span>}
            {block.compatibility && <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-700 dark:text-sky-300">{block.compatibility.source}</span>}
            <span className="rounded bg-violet-500/15 px-1.5 py-0.5 font-mono text-violet-700 dark:text-violet-300">{estimatedTokens} T</span>
            {diagnosticCount > 0 && <span className="rounded bg-destructive/10 px-1.5 py-0.5 font-bold text-destructive">{t("prompt_composer.validation_badge", { count: String(diagnosticCount) })}</span>}
          </div>
        </div>
      </PromptComposerButton>

      <div className="flex w-9 shrink-0 flex-col border-l border-border">
        <PromptComposerButton variant="ghost" size="icon-xs" disabled={!isOrderSort || index === 0} onClick={() => onMove(index, -1)} aria-label={t("prompt_composer.move_up")} className="h-auto min-h-0 flex-1 rounded-none border-0 shadow-none disabled:opacity-20"><ArrowUp className="h-3 w-3" /></PromptComposerButton>
        <PromptComposerButton variant="ghost" size="icon-xs" disabled={!isOrderSort || index === totalBlocks - 1} onClick={() => onMove(index, 1)} aria-label={t("prompt_composer.move_down")} className="h-auto min-h-0 flex-1 rounded-none border-x-0 border-y border-border shadow-none disabled:opacity-20"><ArrowDown className="h-3 w-3" /></PromptComposerButton>
        <PromptComposerButton variant="ghost" size="icon-xs" onClick={() => onDelete(block.id)} aria-label={t("prompt_composer.delete_block")} className="h-auto min-h-0 flex-1 rounded-none border-0 text-destructive shadow-none hover:bg-destructive/10"><Trash2 className="h-3 w-3" /></PromptComposerButton>
      </div>
    </article>
  );
});
