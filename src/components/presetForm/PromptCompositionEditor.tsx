import {
  AlertTriangle,
  ArrowDown,
  BookOpen,
  ChevronDown,
  GitBranch,
  History,
  Lightbulb,
  MessageSquarePlus,
  RotateCcw,
  RotateCw,
  Settings2,
  SlidersHorizontal,
  Sparkles,
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
import PromptSceneProfileManager from "./PromptSceneProfileManager";
import PromptBlockListToolbar from "./PromptBlockListToolbar";
import PromptBlockItemRow from "./PromptBlockItemRow";
import PromptCompositionHeader from "./PromptCompositionHeader";
import {
  buildPromptBlockListGroups,
  estimatePromptBlockTokens,
  patchSelectedBlockStates,
  removePromptBlocks,
  type PromptBlockGroupMode,
  type PromptBlockSortMode,
} from "./promptBlockListTools";
import { usePromptWorkbenchFocus } from "../../contexts/PromptWorkbenchFocusContext";
import { PromptComposerButton } from "./PromptComposerControls";
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
  const [manageOpen, setManageOpen] = useState(false);
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
    [composition],
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

  const tokenByBlockId = useMemo(() => {
    const traced = new Map((preview?.traces ?? []).map((trace) => [trace.blockId, trace.estimatedTokens]));
    return new Map(composition.blocks.map((block) => [
      block.id,
      traced.get(block.id) ?? estimatePromptBlockTokens(block),
    ]));
  }, [composition.blocks, preview?.traces]);

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

  const handleToggleEnabled = useCallback((id: string, enabled: boolean) => {
    updateComposition({
      ...composition,
      blocks: composition.blocks.map((block) => block.id === id ? { ...block, enabled } : block),
    }, `block:${id}`);
  }, [composition, updateComposition]);

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
    <section className={`w-full max-w-full min-w-0 overflow-hidden rounded-2xl border border-border/80 bg-card/40 backdrop-blur-sm shadow-sm ${isWideWorkbench ? "space-y-2 p-2.5" : "space-y-3 p-3"}`}>
      {/* 顶部现代化控制栏 */}
      <PromptCompositionHeader
        composition={composition}
        onUpdateName={(name) => updateComposition({ ...composition, name }, "composition-name")}
        saveState={saveState}
        lastSavedAt={lastSavedAt}
        compatibilityCount={compatibilityCount}
        freeMode={freeMode}
        onSetMode={setMode}
        isWideWorkbench={isWideWorkbench}
        promptFocusActive={promptFocus.active}
        showAdvancedOptions={showAdvancedOptions}
        onToggleAdvancedOptions={() => setShowAdvancedOptions((prev) => !prev)}
        onOpenPreview={() => setPreviewOpen(true)}
        onOpenTutorial={() => setTutorialOpen(true)}
      />

      {!freeMode && !promptFocus.active && <TraditionalPromptFlow />}

      {(freeMode || promptFocus.active) && (
        <>
          {(showAdvancedOptions || isWideWorkbench) && (
            <div className="space-y-2.5 rounded-2xl border border-border/70 bg-muted/20 p-3 backdrop-blur-xs shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-foreground">
                <span className="flex items-center gap-1.5">
                  <Settings2 className="h-4 w-4 text-primary" />
                  <span>{t("prompt_composer.advanced_tools_title")}</span>
                </span>
                <div className="flex items-center gap-1.5">
                  {orientationControl.available && (
                    <PromptComposerButton
                      type="button"
                      aria-pressed={orientationControl.forcedLandscape}
                      onClick={orientationControl.toggleOrientation}
                      className="h-7 gap-1 px-2 text-[10px] text-primary font-bold shadow-xs"
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
                      className="h-7 gap-1 px-2 text-[10px] font-bold shadow-xs"
                    >
                      <GitBranch className="h-3 w-3 text-primary" />
                      {t("prompt_composer.graph")}
                    </PromptComposerButton>
                  )}
                </div>
              </div>

              {/* 导入导出工具栏 */}
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

              {/* 模板管理中心 */}
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

              {/* Token 预算可视化配置 */}
              <PromptCompositionBudgetSettings
                composition={composition}
                preview={preview}
                onChange={(next) => updateComposition(next, "token-budget")}
              />

              {/* 场景预设配置 */}
              <PromptSceneProfileManager
                composition={composition}
                onChange={(next) => updateComposition(next, "scene-profiles")}
              />
            </div>
          )}

          {/* 主工作区画布 */}
          <div className={isWideWorkbench ? "grid grid-cols-[minmax(300px,0.85fr)_minmax(400px,1.15fr)] items-start gap-2.5 min-[1100px]:grid-cols-[minmax(300px,0.72fr)_minmax(340px,0.82fr)_minmax(420px,1fr)]" : "space-y-2.5"}>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 px-1">
                <span className="text-[10px] font-medium text-muted-foreground">
                  {t("prompt_composer.list_stats", {
                    visible: String(visibleBlockItems.length),
                    total: String(composition.blocks.length),
                    tokens: String(visibleTokens),
                  })}
                </span>
                <PromptComposerButton
                  type="button"
                  variant="ghost"
                  aria-expanded={manageOpen}
                  onClick={() => {
                    if (manageOpen) setSelectedBlockIds(new Set());
                    setManageOpen(!manageOpen);
                  }}
                  className="h-7 gap-1 px-2 text-[10px] text-muted-foreground shadow-none hover:text-foreground active:scale-95"
                >
                  <SlidersHorizontal className="h-3 w-3" />
                  <span>{t("prompt_composer.manage_toggle")}</span>
                  <ChevronDown className={`h-3 w-3 transition-transform duration-150 ${manageOpen ? "rotate-180" : ""}`} />
                </PromptComposerButton>
              </div>

              {manageOpen && (
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
              )}

              {validationDiagnostics.length > 0 && (
                <section className="space-y-1.5 rounded-2xl border border-destructive/40 bg-destructive/10 p-3 min-w-0 max-w-full overflow-hidden shadow-xs" aria-live="polite">
                  <div className="flex items-center gap-2 text-xs font-bold text-destructive min-w-0 truncate">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span className="truncate">{t("prompt_composer.validation_title", { count: String(validationDiagnostics.length) })}</span>
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-1 pr-1 min-w-0 max-w-full">
                    {validationDiagnostics.map((diagnostic, index) => (
                      <PromptComposerButton
                        type="button"
                        key={`${diagnostic.code}-${diagnostic.blockId ?? "root"}-${index}`}
                        onClick={() => diagnostic.blockId && setEditingBlockId(diagnostic.blockId)}
                        variant="ghost"
                        className="flex h-auto min-h-6 w-full min-w-0 max-w-full justify-start rounded-lg px-2 py-1 text-left text-[10px] leading-relaxed text-destructive shadow-none hover:bg-destructive/15 break-all"
                      >
                        <code className="mr-1.5 font-bold font-mono shrink-0">{diagnostic.code}</code>
                        <span className="min-w-0 break-all">{diagnostic.message}</span>
                      </PromptComposerButton>
                    ))}
                  </div>
                </section>
              )}

              {composition.blocks.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-destructive/40 bg-destructive/5 p-6 text-center text-xs font-semibold text-destructive shadow-xs">
                  {t("prompt_composer.empty_send_warning")}
                </div>
              ) : (
                <div ref={blockListRef} className="space-y-2">
                  {visibleBlockItems.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                      {t("prompt_composer.list_empty")}
                    </div>
                  )}
                  {blockGroups.map((group) => (
                    <section key={group.key} className="space-y-1.5">
                      {blockGroupMode !== "none" && (
                        <header className="flex items-center gap-2 px-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
                          <span>{describeBlockGroup(group.key, t)}</span>
                          <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[9px]">{group.items.length}</span>
                        </header>
                      )}
                      {group.items.map(({ block, index, estimatedTokens }) => (
                        <PromptBlockItemRow
                          key={block.id}
                          block={block}
                          index={index}
                          estimatedTokens={estimatedTokens}
                          diagnosticCount={diagnosticCountsByBlockId.get(block.id) || 0}
                          selected={selectedBlockIds.has(block.id)}
                          isDragging={draggingId === block.id}
                          isDragTarget={dragTargetId === block.id}
                          isOrderSort={blockSortMode === "order"}
                          targetPlacementName={block.placement.type === "ordered" ? undefined : blockNamesById.get(block.placement.historyBlockId || "")}
                          onToggleSelect={handleToggleSelect}
                          onToggleEnabled={handleToggleEnabled}
                          onEdit={handleEditBlock}
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

              {/* 底部新增与重置操作条 */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                <ToolbarButton onClick={() => addBlock("template")} icon={<MessageSquarePlus className="h-4 w-4 text-primary" />}>
                  {t("prompt_composer.add_message")}
                </ToolbarButton>
                <ToolbarButton onClick={() => addBlock("chat_history")} icon={<History className="h-4 w-4 text-amber-500" />}>
                  {t("prompt_composer.add_history")}
                </ToolbarButton>
                <ToolbarButton
                  onClick={async () => {
                    if (await showCustomConfirm(t("prompt_composer.confirm_reset"))) {
                      updateComposition(createBasicPromptComposition());
                    }
                  }}
                  icon={<RotateCcw className="h-4 w-4 text-muted-foreground" />}
                >
                  {t("prompt_composer.reset_example")}
                </ToolbarButton>
              </div>
            </div>

            {/* 宽屏工作台辅助面板 */}
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

      {/* 区块详细编辑弹窗 */}
      <PromptBlockEditorDialog
        block={!isWideWorkbench || fullEditorOpen ? editingBlock : undefined}
        historyBlocks={historyBlocks}
        onClose={() => { setFullEditorOpen(false); if (!isWideWorkbench) setEditingBlockId(undefined); }}
        onPatch={(patch) => editingBlock && updateBlock(editingBlock.id, patch)}
        onDelete={() => editingBlock && deleteBlock(editingBlock.id)}
        onDuplicate={() => editingBlock && duplicateBlock(editingBlock.id)}
      />

      {/* 预览模拟弹窗 */}
      <PromptCompositionPreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} preview={preview} />

      {/* 窄屏工作台弹窗 */}
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

      {/* 教程弹窗 */}
      <PromptCompositionTutorial open={tutorialOpen} onOpenChange={setTutorialOpen} />
    </section>
  );
}

export function TraditionalPromptFlow() {
  const { t } = useTranslation();
  const steps = t("prompt_composer.legacy_flow_steps").split("|");
  return (
    <section className="rounded-2xl border border-border/80 bg-card/60 p-3.5 backdrop-blur-xs shadow-xs" aria-label={t("prompt_composer.legacy_flow_title")}>
      <div className="text-xs font-bold text-foreground">{t("prompt_composer.legacy_flow_title")}</div>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{t("prompt_composer.legacy_flow_description")}</p>
      <div className="mt-3 flex flex-col items-center gap-1.5">
        {steps.map((step, index) => (
          <div key={`${step}-${index}`} className="contents">
            <div className="w-full rounded-xl border border-primary/25 bg-primary/10 px-3.5 py-2 text-center text-[11px] font-bold text-foreground shadow-xs">
              {step}
            </div>
            {index < steps.length - 1 && <ArrowDown className="h-3.5 w-3.5 text-primary/70 animate-bounce" aria-hidden="true" />}
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
      <DialogContent className="top-auto bottom-0 left-1/2 max-h-[88dvh] w-full max-w-xl -translate-x-1/2 translate-y-0 overflow-y-auto rounded-b-none border border-border/80 bg-background/95 p-0 backdrop-blur-md shadow-2xl">
        <DialogHeader className="border-b border-border/70 px-4 pb-3 pt-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-foreground">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-primary shadow-xs">
              <BookOpen className="h-4 w-4" />
            </span>
            <span>{t("prompt_composer.tutorial_title")}</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
            {t("prompt_composer.tutorial_intro")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 p-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] text-xs text-foreground">
          {/* 四大核心步骤 */}
          <div className="space-y-2.5">
            <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" />
              <span>{t("prompt_composer.tutorial_core_title")}</span>
            </div>
            {steps.map((step, index) => (
              <div
                key={`${step}-${index}`}
                className="flex gap-3 rounded-2xl border border-border/70 bg-card/60 p-3.5 items-start backdrop-blur-xs shadow-xs"
              >
                <span className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[11px] font-bold text-primary ring-2 ring-primary/20 mt-0.5">
                  {index + 1}
                </span>
                <p className="text-[11px] leading-relaxed text-foreground/90 font-medium">{step}</p>
              </div>
            ))}
          </div>

          {/* 常用宏变量速查 */}
          <div className="space-y-2.5 rounded-2xl border border-border/80 bg-muted/25 p-3.5 backdrop-blur-xs">
            <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              <span>{t("prompt_composer.tutorial_macros_title")}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-xl border border-border/60 bg-background/80 p-2.5 shadow-2xs">
                <code className="text-primary font-bold font-mono">{"{{char}}"}</code>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{t("prompt_composer.macro_char_desc")}</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/80 p-2.5 shadow-2xs">
                <code className="text-primary font-bold font-mono">{"{{user}}"}</code>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{t("prompt_composer.macro_user_desc")}</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/80 p-2.5 shadow-2xs">
                <code className="text-primary font-bold font-mono">{"{{description}}"}</code>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{t("prompt_composer.macro_description_desc")}</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/80 p-2.5 shadow-2xs">
                <code className="text-primary font-bold font-mono">{"{{personality}}"}</code>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{t("prompt_composer.macro_personality_desc")}</p>
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

function ToolbarButton({ onClick, icon, children }: { onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <PromptComposerButton
      onClick={onClick}
      className="min-h-11 gap-1.5 rounded-2xl px-2.5 text-[11px] font-bold shadow-xs hover:border-primary/40 hover:bg-muted/40 transition-all"
    >
      {icon}
      <span>{children}</span>
    </PromptComposerButton>
  );
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
