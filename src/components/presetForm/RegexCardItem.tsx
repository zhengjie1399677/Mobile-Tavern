import React from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Switch } from "@/src/components/ui/switch";
import { Checkbox } from "@/src/components/ui/checkbox";
import { cn } from "@/src/lib/utils";
import type { RegexScript } from "../../types";

export interface RegexCardItemProps {
  script: RegexScript;
  scope: "global" | "preset" | "character";
  scopeLabel?: string;
  isBatchDeleting?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (selected: boolean) => void;
  onToggleDisabled: (disabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  t: (key: string, params?: Record<string, unknown>) => string;
}

export function renderRuleBadges(r: RegexScript, t: (key: string, params?: Record<string, unknown>) => string) {
  const placement = r.placement;
  let placementText = t("regex.placement_output");
  if (placement && placement.length > 0) {
    const tags: string[] = [];
    if (placement.includes(1)) tags.push(t("regex.placement_input"));
    if (placement.includes(2)) tags.push(t("regex.placement_output"));
    if (placement.includes(6)) tags.push(t("regex.placement_chain"));
    if (placement.includes(5)) tags.push(t("regex.placement_worldbook"));
    if (placement.includes(3)) tags.push(t("regex.placement_command"));
    placementText = tags.join("·") || t("regex.placement_output");
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-semibold px-1.5 py-0.5 border border-border/80 rounded bg-background text-muted-foreground">
        {placementText}
      </span>
      {r.markdownOnly && (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 border border-primary/30 rounded bg-primary/10 text-primary">
          {t("regex.badge_markdown_only")}
        </span>
      )}
      {r.promptOnly && (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 border border-amber-500/30 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
          {t("regex.badge_prompt_only")}
        </span>
      )}
      {r.substituteRegex === 2 && (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 border border-emerald-500/30 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          {t("regex.badge_safe_escape")}
        </span>
      )}
      {((r.minDepth !== undefined && r.minDepth !== null) || (r.maxDepth !== undefined && r.maxDepth !== null)) && (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 border border-border rounded bg-muted/60 text-muted-foreground font-mono">
          {t("regex.badge_depth", { min: r.minDepth ?? 0, max: r.maxDepth ?? "∞" })}
        </span>
      )}
      {r.trimStrings && r.trimStrings.length > 0 && (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 border border-border rounded bg-muted/60 text-muted-foreground font-mono">
          {t("regex.badge_trim_count", { count: r.trimStrings.length })}
        </span>
      )}
    </div>
  );
}

export const RegexCardItem = React.memo(function RegexCardItem({
  script,
  scope,
  scopeLabel,
  isBatchDeleting = false,
  isSelected = false,
  onToggleSelect,
  onToggleDisabled,
  onEdit,
  onDelete,
  t,
}: RegexCardItemProps) {
  const isDisabled = Boolean(script.disabled);

  return (
    <div
      className={cn(
        "group relative flex flex-col gap-2.5 rounded-xl border border-border/50 bg-card/60 p-3 sm:p-3.5 transition-all duration-200 hover:border-primary/40 hover:bg-card/90 hover:shadow-xs",
        isDisabled && "opacity-60 bg-muted/20 border-border/30",
        isSelected && "border-primary/60 bg-primary/5",
      )}
    >
      {/* 顶部行：选择框/标题/徽章/启用开关 */}
      <div className="flex items-start justify-between gap-2.5 min-w-0">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          {isBatchDeleting && onToggleSelect && (
            <div className="pt-0.5 shrink-0">
              <Checkbox
                checked={isSelected}
                onCheckedChange={(checked) => onToggleSelect(Boolean(checked))}
                className="size-4"
              />
            </div>
          )}

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {scopeLabel && (
                <span
                  className={cn(
                    "text-[10px] font-bold px-1.5 py-0.2 rounded border shrink-0",
                    scope === "global" && "bg-sky-500/10 text-sky-500 border-sky-500/30",
                    scope === "preset" && "bg-violet-500/10 text-violet-500 border-violet-500/30",
                    scope === "character" && "bg-amber-500/10 text-amber-500 border-amber-500/30",
                  )}
                >
                  {scopeLabel}
                </span>
              )}
              <span
                className={cn(
                  "text-xs sm:text-[13px] font-bold text-foreground break-all",
                  isDisabled && "line-through text-muted-foreground",
                )}
              >
                {script.scriptName || "(未命名正则)"}
              </span>
            </div>

            {/* 规则特性徽章 */}
            {renderRuleBadges(script, t)}
          </div>
        </div>

        {/* 启用/停用开关 */}
        <div className="flex items-center gap-2 shrink-0 pt-0.5">
          <Switch
            aria-label={t(`regex.aria_toggle_${scope}`, { name: script.scriptName })}
            checked={!isDisabled}
            onCheckedChange={(checked) => onToggleDisabled(!checked)}
            className="data-[state=checked]:bg-primary h-5 w-9 [&_span]:h-4 [&_span]:w-4"
          />
        </div>
      </div>

      {/* 中部：代码规则预览（不截断，可完整阅读与长按复制） */}
      <div className="rounded-lg border border-border/40 bg-background/70 dark:bg-muted/40 p-2 font-mono text-[11px] sm:text-xs text-foreground/90 break-all select-text space-y-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[10px] font-semibold text-primary/80 uppercase shrink-0">Find:</span>
          <span className="text-foreground/95">{script.findRegex || "<空正则>"}</span>
        </div>
        <div className="flex items-baseline gap-1.5 border-t border-border/20 pt-1">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase shrink-0">Replace:</span>
          <span className="text-foreground/80">
            {script.replaceString === "" ? (
              <span className="italic text-muted-foreground text-[10.5px]">
                {t("regex.replace_empty_delete")}
              </span>
            ) : (
              script.replaceString
            )}
          </span>
        </div>
      </div>

      {/* 底部操作工具栏 */}
      <div className="flex items-center justify-between gap-2 pt-0.5 text-xs">
        <div className="text-[10px] text-muted-foreground font-mono">
          {script.runOnEdit === false && (
            <span className="text-amber-500/90 font-medium">编辑消息时不执行</span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted transition-colors border border-border/40 active:scale-95"
          >
            <Pencil className="size-3" />
            <span>{t("regex.edit")}</span>
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-rose-500/90 hover:text-rose-500 bg-rose-500/5 hover:bg-rose-500/15 transition-colors border border-rose-500/20 active:scale-95"
          >
            <Trash2 className="size-3" />
            <span>{t("regex.delete")}</span>
          </button>
        </div>
      </div>
    </div>
  );
});
