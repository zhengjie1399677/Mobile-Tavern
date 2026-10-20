import { useTranslation } from "../../contexts/LanguageContext";
import type { ThemeInteractionConfig } from "../../domain/themes/themeInteractionContract";
import { getDefaultThemeStateTokens } from "../../domain/themes/themeInteractionDraft";
import { MediaManualPreview } from "./MediaManualPreview";
import type { ThemeStudioResourcePort } from "./themeStudioResourcePort";

export function InteractionStaticPreview({
  config,
  resourcePort,
  mediaPermissionEnabled,
}: {
  config: ThemeInteractionConfig;
  resourcePort?: ThemeStudioResourcePort;
  mediaPermissionEnabled: boolean;
}) {
  const { t } = useTranslation();
  const mediaEntries = Object.entries(config.media);
  const tokens = getDefaultThemeStateTokens(config);

  return (
    <section className="space-y-2 rounded-xl border border-border bg-card p-3">
      <div>
        <h3 className="text-xs font-bold">{t("theme_studio.static_preview.title")}</h3>
        <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
          {t("theme_studio.static_preview.hint")}
        </p>
      </div>

      {!mediaPermissionEnabled && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[10px] text-amber-700 dark:text-amber-300">
          {t("theme_studio.static_preview.media_permission")}
        </p>
      )}

      {mediaEntries.length === 0 && tokens.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-2.5 py-1.5 text-[10px] text-muted-foreground">
          {t("theme_studio.static_preview.empty")}
        </p>
      ) : (
        <div className="space-y-2">
          {mediaEntries.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground">
                {t("theme_studio.static_preview.media_title")}
              </p>
              {mediaEntries.map(([id, definition]) => (
                <div key={id} className="rounded-lg border border-border bg-muted/20 p-2">
                  <p className="font-mono text-[10px] font-semibold text-foreground">
                    {id} · {definition.type}
                  </p>
                  <div className="mt-1">
                    <MediaManualPreview definition={definition} resourcePort={resourcePort} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {tokens.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground">
                {t("theme_studio.static_preview.state_title")}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {tokens.map(token => (
                  <span key={token} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                    {token}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
