import { useEffect, useState } from "react";
import { useTranslation } from "../../contexts/LanguageContext";
import type { ThemeMediaDefinition } from "../../domain/themes/themeInteractionContract";
import type { ThemeStudioResourcePort } from "./themeStudioResourcePort";

export function resourceIdFromSrc(src: string): string {
  const prefix = "tavern-resource://";
  return src.startsWith(prefix) ? src.slice(prefix.length) : src;
}

export function MediaManualPreview({
  definition,
  resourcePort,
}: {
  definition: ThemeMediaDefinition;
  resourcePort?: ThemeStudioResourcePort;
}) {
  const { t } = useTranslation();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setObjectUrl(null);
    setFailed(false);
  }, [definition.src]);

  const load = async () => {
    if (!resourcePort) return;
    setFailed(false);
    try {
      setObjectUrl(await resourcePort.getObjectUrl(resourceIdFromSrc(definition.src)));
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        disabled={!resourcePort}
        onClick={() => void load()}
        className="rounded-md border border-border bg-muted/40 px-2 py-1 text-[10px] font-semibold text-foreground disabled:opacity-50"
      >
        {t("theme_studio.media.load_preview")}
      </button>
      {failed && <p className="text-[10px] text-destructive">{t("theme_studio.media.preview_failed")}</p>}
      {!failed && objectUrl && definition.type === "audio" && (
        <audio controls src={objectUrl} className="h-8 w-full" />
      )}
      {!failed && objectUrl && definition.type === "video" && (
        <video
          controls
          src={objectUrl}
          className="max-h-32 w-full rounded-md border border-border"
        />
      )}
    </div>
  );
}
