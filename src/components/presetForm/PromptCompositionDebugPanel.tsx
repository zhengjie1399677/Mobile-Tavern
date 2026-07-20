import { AlertTriangle, CheckCircle2, CircleOff, Database, Scissors } from "lucide-react";
import { useTranslation } from "../../contexts/LanguageContext";
import type { PromptCompositionPreviewData } from "./promptCompositionEditorTypes";

export default function PromptCompositionDebugPanel({ preview }: { preview?: PromptCompositionPreviewData }) {
  const { t } = useTranslation();
  const traces = preview?.traces ?? [];

  if (!preview?.contextAvailable) {
    return (
      <div className="m-3 flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
        <AlertTriangle className="h-4 w-4 shrink-0" />{t("prompt_composer.preview_requires_chat")}
      </div>
    );
  }

  return (
    <div className="max-h-[66dvh] space-y-3 overflow-y-auto p-3">
      {preview.budget && (
        <section className="rounded-xl border border-border bg-muted/20 p-3 text-[10px] text-muted-foreground">
          <div className="font-bold text-foreground">{t("prompt_composer.debug_budget")}</div>
          <div className="mt-1">{preview.budget.used} / {preview.budget.limit} Token · {t("prompt_composer.debug_original_tokens", { count: String(preview.budget.originalUsed) })}</div>
        </section>
      )}
      {traces.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">{t("prompt_composer.debug_empty")}</div>
      ) : traces.map((trace) => {
        const destinations = trace.messageIndexes.map((index) => {
          const message = preview.messages[index];
          return message ? `#${index + 1} ${message.role.toUpperCase()}` : `#${index + 1}`;
        });
        return (
          <article key={trace.blockId} className={`rounded-xl border p-3 ${trace.dropped ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-background"}`}>
            <header className="flex items-center gap-2">
              {trace.dropped ? <Scissors className="h-4 w-4 text-amber-500" /> : destinations.length > 0 ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <CircleOff className="h-4 w-4 text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate text-xs font-bold">{trace.blockName}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px]">{trace.estimatedTokens} T</span>
            </header>
            <div className="mt-2 text-[10px] text-muted-foreground">
              {trace.dropped
                ? t("prompt_composer.debug_dropped")
                : destinations.length > 0
                  ? t("prompt_composer.debug_destinations", { destinations: destinations.join(", ") })
                  : t("prompt_composer.debug_no_output")}
            </div>
            <div className="mt-2 space-y-1">
              {trace.dataKeys.length === 0 ? (
                <span className="text-[9px] text-muted-foreground">{t("prompt_composer.debug_static_text")}</span>
              ) : trace.dataKeys.map((key) => {
                const resolved = trace.resolvedDataKeys.includes(key);
                return (
                  <div key={key} className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-[9px]">
                    <Database className={`h-3 w-3 ${resolved ? "text-primary" : "text-destructive"}`} />
                    <span className="rounded bg-background px-1 py-0.5 uppercase text-muted-foreground">{sourceCategory(key)}</span>
                    <code className="min-w-0 flex-1 truncate">{key}</code>
                    <span className={resolved ? "text-emerald-600" : "text-destructive"}>{t(resolved ? "prompt_composer.debug_resolved" : "prompt_composer.debug_missing")}</span>
                  </div>
                );
              })}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function sourceCategory(key: string): string {
  if (key === "chat.history") return "history";
  const prefix = key.split(".")[0];
  if (["character", "persona", "worldbook", "memory", "prompt", "feature", "input"].includes(prefix)) return prefix;
  return "compat";
}
