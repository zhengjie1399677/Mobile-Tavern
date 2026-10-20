import { useTranslation } from "../../contexts/LanguageContext";
import type { ThemeCssDiagnostic } from "../../domain/themes/themeCssDiagnostics";

const MAX_VISIBLE_DIAGNOSTICS = 50;

export function CssDiagnosticsPanel({
  css,
  diagnostics,
  onSelect,
}: {
  css: string;
  diagnostics: ThemeCssDiagnostic[];
  onSelect: (diagnostic: ThemeCssDiagnostic) => void;
}) {
  const { t } = useTranslation();
  if (diagnostics.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground">
        {t("theme_studio.css.diagnostics_ok")}
      </p>
    );
  }

  const visible = diagnostics.slice(0, MAX_VISIBLE_DIAGNOSTICS);
  return (
    <section className="rounded-xl border border-border bg-card" aria-label={t("theme_studio.css.diagnostics_title")}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="text-xs font-bold">{t("theme_studio.css.diagnostics_title")}</p>
        <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
          {diagnostics.length}
        </span>
      </div>
      <div className="divide-y divide-border">
        {visible.map((diagnostic, index) => (
          <button
            key={`${diagnostic.code}-${diagnostic.offset}-${index}`}
            type="button"
            onClick={() => onSelect(diagnostic)}
            className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/60"
          >
            <span className="mt-0.5 shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-[9px] font-semibold text-destructive">
              {t("theme_studio.css.severity_error")}
            </span>
            <span className="mt-0.5 shrink-0 font-mono text-[10px] text-muted-foreground">
              L{diagnostic.line}:{diagnostic.column}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] leading-relaxed text-foreground">{diagnostic.message}</span>
              <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                {css.slice(diagnostic.offset, diagnostic.offset + Math.min(Math.max(diagnostic.length, 1), 48))}
              </span>
            </span>
          </button>
        ))}
      </div>
      {diagnostics.length > visible.length && (
        <p className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
          {t("theme_studio.css.diagnostics_more", { count: diagnostics.length - visible.length })}
        </p>
      )}
    </section>
  );
}
