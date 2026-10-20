import { useMemo } from "react";
import { useTranslation } from "../../contexts/LanguageContext";
import { analyzeThemeContrast, type ThemeContrastCheck } from "../../domain/themes/themeContrast";

function statusClass(status: ThemeContrastCheck["status"]): string {
  if (status === "pass") return "text-muted-foreground";
  if (status === "fail") return "text-destructive";
  return "text-amber-600 dark:text-amber-400";
}

export function ContrastSummary({ variables }: { variables: Record<string, string> }) {
  const { t } = useTranslation();
  const checks = useMemo(() => analyzeThemeContrast(variables), [variables]);
  const failures = checks.filter(check => check.status === "fail").length;
  const unresolved = checks.filter(check => check.status === "unresolved").length;

  const summary = failures > 0
    ? t("theme_studio.contrast.summary_fail", { fail: failures, total: checks.length })
    : unresolved > 0
      ? t("theme_studio.contrast.summary_unresolved", { count: unresolved })
      : t("theme_studio.contrast.summary_pass", { total: checks.length });

  return (
    <section className="rounded-xl border border-border bg-card p-3" aria-label={t("theme_studio.contrast.title")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold">{t("theme_studio.contrast.title")}</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
            {t("theme_studio.contrast.hint")}
          </p>
        </div>
        <span className={`shrink-0 text-[10px] font-semibold ${failures > 0 ? "text-destructive" : statusClass(unresolved > 0 ? "unresolved" : "pass")}`}>
          {summary}
        </span>
      </div>

      <div className="mt-2 divide-y divide-border">
        {checks.map(check => {
          const statusLabel = check.status === "pass"
            ? t("theme_studio.contrast.status_pass")
            : check.status === "fail"
              ? t("theme_studio.contrast.status_fail")
              : t("theme_studio.contrast.status_unresolved");
          return (
            <div key={check.id} className="flex min-h-8 items-center justify-between gap-2 py-1">
              <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
                {check.foregroundVariable} / {check.backgroundVariable}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-3 rounded border border-border"
                  style={{ background: check.foregroundRgb ?? "var(--muted)" }}
                />
                <span
                  aria-hidden="true"
                  className="size-3 rounded border border-border"
                  style={{ background: check.backgroundRgb ?? "var(--muted)" }}
                />
                <span className="w-12 text-right font-mono text-[10px] text-foreground">
                  {check.ratio == null ? t("theme_studio.contrast.unresolved_value") : `${check.ratio.toFixed(2)}:1`}
                </span>
                <span className={`w-9 text-right text-[9px] font-semibold ${statusClass(check.status)}`}>
                  {statusLabel}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        {t("theme_studio.contrast.threshold_note")}
      </p>
    </section>
  );
}
