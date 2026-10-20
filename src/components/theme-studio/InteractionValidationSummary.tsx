import { useTranslation } from "../../contexts/LanguageContext";
import type { ThemeInteractionIssue } from "../../domain/themes/themeInteractionContract";

export function InteractionValidationSummary({
  schemaVersion,
  issues,
  mediaPermissionEnabled,
}: {
  schemaVersion: "1.0" | "1.1";
  issues: ThemeInteractionIssue[];
  mediaPermissionEnabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
          {t("theme_studio.interactions.schema_badge", { version: schemaVersion })}
        </span>
        {issues.length === 0 ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {t("theme_studio.validation.ok")}
          </span>
        ) : (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
            {t("theme_studio.validation.errors", { count: issues.length })}
          </span>
        )}
      </div>
      {!mediaPermissionEnabled && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
          {t("theme_studio.validation.media_permission")}
        </p>
      )}
      {issues.length > 0 && (
        <ul className="space-y-0.5 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-1.5">
          {issues.slice(0, 5).map((issue, index) => (
            <li key={`${issue.path.join(".")}-${index}`} className="text-[10px] leading-relaxed text-destructive">
              <span className="font-mono">{issue.path.join(".") || "(root)"}</span>：{issue.message}
            </li>
          ))}
          {issues.length > 5 && (
            <li className="text-[10px] text-muted-foreground">
              {t("theme_studio.validation.more", { count: issues.length - 5 })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
