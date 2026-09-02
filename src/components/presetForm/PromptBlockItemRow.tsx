import { memo } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { CheckSquare2, GripVertical, Square } from "lucide-react";
import type { PromptBlock } from "../../domain/prompt-composition";
import { PromptComposerButton, PromptComposerSwitch } from "./PromptComposerControls";

export interface PromptBlockItemRowProps {
  block: PromptBlock;
  index: number;
  estimatedTokens: number;
  diagnosticCount: number;
  selected: boolean;
  isDragging: boolean;
  isDragTarget: boolean;
  isOrderSort: boolean;
  targetPlacementName?: string;
  onToggleSelect: (id: string) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onEdit: (id: string) => void;
  onDragStart: (event: ReactPointerEvent<HTMLButtonElement>, id: string) => void;
  onDragMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDragEnd: (pointerId: number) => void;
  onDragCancel: (pointerId: number) => void;
  t: (key: string, params?: Record<string, string>) => string;
}

export function RoleBadge({ role }: { role: string }) {
  const classes = role === "system"
    ? "border-violet-500/30 bg-violet-500/15 text-violet-600 dark:text-violet-300"
    : role === "assistant"
      ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
      : role === "history"
        ? "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300"
        : "border-sky-500/30 bg-sky-500/15 text-sky-600 dark:text-sky-300";
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-bold tracking-wide shadow-xs ${classes}`}>
      {role.toUpperCase()}
    </span>
  );
}

export function describeSource(block: PromptBlock, t: (key: string, params?: Record<string, string>) => string): string {
  if (block.source.type === "template") return t("prompt_composer.template_source");
  if (block.source.selection?.mode === "recent") {
    return t("prompt_composer.recent_count", { count: String(block.source.selection.count) });
  }
  return t("prompt_composer.all_messages");
}

export const PromptBlockItemRow = memo(function PromptBlockItemRow({
  block,
  index,
  estimatedTokens,
  diagnosticCount,
  selected,
  isDragging,
  isDragTarget,
  isOrderSort,
  targetPlacementName,
  onToggleSelect,
  onToggleEnabled,
  onEdit,
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
      className={`group relative grid min-h-[58px] grid-cols-[36px_32px_minmax(0,1fr)_40px] overflow-hidden rounded-2xl border bg-card/60 backdrop-blur-xs transition-all duration-150 ${
        selected
          ? "border-primary/80 bg-primary/5 shadow-xs ring-1 ring-primary/30"
          : isDragTarget && !isDragging
            ? "border-primary ring-2 ring-primary/30 before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-primary"
            : diagnosticCount > 0
              ? "border-destructive/60 bg-destructive/5"
              : "border-border/70 hover:border-border hover:bg-card/90"
      } ${isDragging ? "scale-[0.985] opacity-60 shadow-lg ring-2 ring-primary/40" : block.enabled ? "" : "opacity-55"}`}
    >
      {/* 拖拽手柄 */}
      <PromptComposerButton
        type="button"
        aria-label={t("prompt_composer.drag_block", { name: block.name })}
        onPointerDown={(event) => isOrderSort && onDragStart(event, block.id)}
        onPointerMove={onDragMove}
        onPointerUp={(event) => onDragEnd(event.pointerId)}
        onPointerCancel={(event) => onDragCancel(event.pointerId)}
        variant="ghost"
        disabled={!isOrderSort}
        className="h-full min-h-0 w-9 touch-none rounded-none border-0 border-r border-border/60 px-0 text-muted-foreground shadow-none hover:text-foreground active:bg-muted/80"
      >
        <GripVertical className="h-4 w-4" />
      </PromptComposerButton>

      {/* 多选框 */}
      <PromptComposerButton
        type="button"
        variant="ghost"
        onClick={() => onToggleSelect(block.id)}
        aria-label={t(selected ? "prompt_composer.unselect_block" : "prompt_composer.select_block", { name: block.name })}
        className="h-full min-h-0 w-8 rounded-none border-0 border-r border-border/60 px-0 text-muted-foreground shadow-none hover:text-foreground active:scale-95"
      >
        {selected ? <CheckSquare2 className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
      </PromptComposerButton>

      {/* 主信息区（点击编辑） */}
      <PromptComposerButton
        type="button"
        aria-label={t("prompt_composer.edit_block", { name: block.name })}
        onClick={() => onEdit(block.id)}
        variant="ghost"
        className="h-full min-h-0 min-w-0 w-full justify-start overflow-hidden rounded-none border-0 p-2.5 text-left shadow-none hover:bg-muted/20 active:scale-100"
      >
        <div className="min-w-0 w-full overflow-hidden">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="flex h-4 w-5 shrink-0 items-center justify-center rounded bg-muted/60 font-mono text-[10px] font-bold text-muted-foreground">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-bold text-foreground group-hover:text-primary transition-colors">
              {block.name}
            </span>
            <RoleBadge role={block.source.type === "chat_history" ? "history" : block.role} />
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 overflow-hidden pl-6 text-[9px] text-muted-foreground">
            <span className="max-w-[48%] min-w-0 truncate rounded bg-muted/60 px-1.5 py-0.5">
              {describeSource(block, t)}
            </span>
            <span className="max-w-[48%] min-w-0 truncate rounded bg-muted/60 px-1.5 py-0.5">
              {placementText}
            </span>
            {(block.condition || block.tokenPolicy) && (
              <span className="rounded border border-amber-500/20 bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-700 dark:text-amber-300">
                {t("prompt_composer.advanced_active")}
              </span>
            )}
            {block.compatibility && (
              <span className="rounded border border-sky-500/20 bg-sky-500/15 px-1.5 py-0.5 font-medium text-sky-700 dark:text-sky-300">
                {block.compatibility.source}
              </span>
            )}
            <span className="rounded border border-violet-500/20 bg-violet-500/15 px-1.5 py-0.5 font-mono font-bold text-violet-700 dark:text-violet-300">
              {estimatedTokens} T
            </span>
            {diagnosticCount > 0 && (
              <span className="rounded border border-destructive/20 bg-destructive/15 px-1.5 py-0.5 font-bold text-destructive">
                {t("prompt_composer.validation_badge", { count: String(diagnosticCount) })}
              </span>
            )}
          </div>
        </div>
      </PromptComposerButton>

      {/* 启用/停用开关 */}
      <div className="flex w-10.5 shrink-0 items-center justify-center border-l border-border/60">
        <PromptComposerSwitch
          checked={block.enabled}
          onCheckedChange={(checked) => onToggleEnabled(block.id, checked)}
          aria-label={`${t("prompt_composer.block_enabled")}：${block.name}`}
        />
      </div>
    </article>
  );
});

export default PromptBlockItemRow;
