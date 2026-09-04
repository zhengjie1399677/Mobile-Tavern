import type { ReactNode } from "react";
import {
  CheckCircle2,
  ChevronDown,
  CloudAlert,
  Eye,
  HelpCircle,
  LoaderCircle,
  Settings2,
} from "lucide-react";
import type { PromptComposition } from "../../domain/prompt-composition";
import type { SettingsSaveState } from "../../hooks/settings/useSettingsPersistence";
import { useTranslation } from "../../contexts/LanguageContext";
import { PromptComposerButton, PromptComposerInput } from "./PromptComposerControls";

export interface PromptCompositionHeaderProps {
  composition: PromptComposition;
  onUpdateName: (name: string) => void;
  saveState: SettingsSaveState;
  lastSavedAt?: number;
  compatibilityCount: number;
  freeMode: boolean;
  onSetMode: (enabled: boolean) => void;
  isWideWorkbench: boolean;
  promptFocusActive: boolean;
  showAdvancedOptions: boolean;
  onToggleAdvancedOptions: () => void;
  onOpenPreview: () => void;
  onOpenTutorial: () => void;
}

export function SaveStatus({
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
    <div
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium backdrop-blur-xs transition-colors duration-150 ${
        isError
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : isBusy
            ? "border-primary/30 bg-primary/10 text-primary"
            : "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      }`}
    >
      <Icon className={`h-3 w-3 shrink-0 ${isBusy ? "animate-spin text-primary" : isError ? "text-destructive" : "text-emerald-500 dark:text-emerald-400"}`} />
      <span className="truncate">{label}</span>
    </div>
  );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <PromptComposerButton
      aria-pressed={active}
      onClick={onClick}
      variant="ghost"
      className={`flex-1 border-0 px-3 py-1.5 text-xs font-semibold shadow-none transition-all duration-150 ${
        active
          ? "rounded-lg bg-background text-primary shadow-xs ring-1 ring-border/80 font-bold"
          : "text-muted-foreground hover:bg-background/40 hover:text-foreground"
      }`}
    >
      {children}
    </PromptComposerButton>
  );
}

export function PromptCompositionHeader({
  composition,
  onUpdateName,
  saveState,
  lastSavedAt,
  compatibilityCount,
  freeMode,
  onSetMode,
  isWideWorkbench,
  promptFocusActive,
  showAdvancedOptions,
  onToggleAdvancedOptions,
  onOpenPreview,
  onOpenTutorial,
}: PromptCompositionHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="space-y-2 pb-2.5 border-b border-border/60">
      {/* 顶部标题与工具快捷栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto sm:flex-1 sm:max-w-xs">
          <PromptComposerInput
            value={composition.name}
            onChange={(event) => onUpdateName(event.target.value)}
            aria-label={t("prompt_composer.composition_name")}
            className="h-8.5 text-xs font-bold w-full bg-background/80 focus-visible:bg-background"
          />
        </div>

        <div className="flex items-center gap-1.5 shrink-0 w-full sm:w-auto">
          <PromptComposerButton
            type="button"
            onClick={onOpenPreview}
            className="h-8 flex-1 sm:flex-initial gap-1.5 border-primary/30 bg-primary/10 px-2.5 text-xs font-bold text-primary hover:bg-primary/20 hover:border-primary/40 shadow-xs justify-center"
          >
            <Eye className="h-3.5 w-3.5" />
            <span>{t("prompt_composer.preview")}</span>
          </PromptComposerButton>

          <PromptComposerButton
            type="button"
            onClick={onOpenTutorial}
            className="h-8 flex-1 sm:flex-initial gap-1.5 border-border/80 bg-background/80 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-background shadow-xs justify-center"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            <span>{t("prompt_composer.tutorial")}</span>
          </PromptComposerButton>

          {!isWideWorkbench && (
            <PromptComposerButton
              type="button"
              aria-expanded={showAdvancedOptions}
              onClick={onToggleAdvancedOptions}
              className={`h-8 flex-1 sm:flex-initial gap-1.5 px-2.5 text-xs font-medium transition-all shadow-xs justify-center ${
                showAdvancedOptions
                  ? "border-primary/40 bg-primary/15 text-primary font-bold shadow-xs ring-1 ring-primary/20"
                  : "border-border/80 bg-background/80 text-muted-foreground hover:text-foreground"
              }`}
            >
              <Settings2 className="h-3.5 w-3.5" />
              <span>{t("prompt_composer.advanced_toggle")}</span>
              <ChevronDown className={`h-3 w-3 transition-transform duration-150 ${showAdvancedOptions ? "rotate-180" : ""}`} />
            </PromptComposerButton>
          )}
        </div>
      </div>

      {/* 状态徽章与同步条 */}
      <div className="flex items-center justify-between gap-2 px-0.5 text-[10px] text-muted-foreground">
        <SaveStatus state={saveState} lastSavedAt={lastSavedAt} t={t} />

        {compatibilityCount > 0 && (
          <span className="inline-flex items-center rounded-full border border-sky-500/25 bg-sky-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300">
            {t("prompt_composer.st_compat_badge", { count: String(compatibilityCount) })}
          </span>
        )}
      </div>

      {/* 模式分段选择器（传统模式 vs 自由编排） */}
      {!promptFocusActive && (
        <div
          className="flex items-center rounded-xl border border-border/70 bg-muted/40 p-1 backdrop-blur-xs w-full"
          role="group"
          aria-label={t("prompt_composer.mode")}
        >
          <ModeButton active={!freeMode} onClick={() => onSetMode(false)}>
            {t("prompt_composer.legacy_mode")}
          </ModeButton>
          <ModeButton active={freeMode} onClick={() => onSetMode(true)}>
            {t("prompt_composer.free_mode")}
          </ModeButton>
        </div>
      )}
    </header>
  );
}

export default PromptCompositionHeader;
