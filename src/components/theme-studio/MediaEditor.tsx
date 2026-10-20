import { useState } from "react";
import { useTranslation } from "../../contexts/LanguageContext";
import type { LocalResourceMetadata } from "../../domain/resources/types";
import {
  isValidThemeMediaId,
  THEME_INTERACTION_LIMITS,
  type ThemeInteractionConfig,
  type ThemeMediaDefinition,
} from "../../domain/themes/themeInteractionContract";
import { createThemeMediaId } from "../../domain/themes/themeInteractionDraft";
import { MediaEditorRow } from "./MediaEditorRow";
import { ThemeStudioSelect } from "./ThemeStudioSelect";
import { useThemeStudioTypeLabels } from "./themeStudioTypeLabels";
import type { ThemeStudioResourcePort } from "./themeStudioResourcePort";

export function MediaEditor({
  config,
  resources,
  resourcePort,
  mediaPermissionEnabled,
  onChange,
  onImport,
}: {
  config: ThemeInteractionConfig;
  resources: LocalResourceMetadata[];
  resourcePort?: ThemeStudioResourcePort;
  mediaPermissionEnabled: boolean;
  onChange: (config: ThemeInteractionConfig) => void;
  onImport?: (file: File) => Promise<void>;
}) {
  const { t } = useTranslation();
  const labels = useThemeStudioTypeLabels();
  const [kind, setKind] = useState<"audio" | "video">("audio");
  const [resourceId, setResourceId] = useState("");
  const [mediaId, setMediaId] = useState(() => createThemeMediaId(config));
  const mediaCount = Object.keys(config.media).length;
  const availableResources = resources.filter(resource => resource.kind === kind);
  const canAdd = Boolean(
    resourcePort &&
    resourceId &&
    isValidThemeMediaId(mediaId) &&
    !config.media[mediaId] &&
    mediaCount < THEME_INTERACTION_LIMITS.maxMedia,
  );

  const addMedia = () => {
    if (!canAdd || !resourcePort) return;
    const definition: ThemeMediaDefinition = kind === "audio"
      ? {
          type: "audio",
          src: resourcePort.getResourceReference(resourceId),
          loop: false,
          volume: 0.5,
          preload: "metadata",
        }
      : {
          type: "video",
          src: resourcePort.getResourceReference(resourceId),
          loop: false,
          volume: 1,
          muted: true,
          fit: "cover",
          preload: "metadata",
        };
    const next: ThemeInteractionConfig = {
      ...config,
      media: { ...config.media, [mediaId]: definition },
    };
    onChange(next);
    setResourceId("");
    setMediaId(createThemeMediaId(next));
  };

  const updateMedia = (id: string, definition: ThemeMediaDefinition) => {
    onChange({ ...config, media: { ...config.media, [id]: definition } });
  };

  const removeMedia = (id: string) => {
    const nextMedia = { ...config.media };
    delete nextMedia[id];
    onChange({ ...config, media: nextMedia });
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold">{t("theme_studio.media.title")}</h3>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{t("theme_studio.media.hint")}</p>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          {mediaCount} / {THEME_INTERACTION_LIMITS.maxMedia}
        </span>
      </div>

      {!mediaPermissionEnabled && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
          {t("theme_studio.media.permission_hint")}
        </p>
      )}

      <div className="grid gap-2 rounded-lg border border-border bg-card p-2.5 sm:grid-cols-2">
        <label className="text-[10px] text-muted-foreground">
          {t("theme_studio.media.kind")}
          <ThemeStudioSelect
            value={kind}
            options={[
              { value: "audio", label: labels.mediaKind("audio") },
              { value: "video", label: labels.mediaKind("video") },
            ]}
            onValueChange={value => {
              setKind(value === "video" ? "video" : "audio");
              setResourceId("");
            }}
            className="mt-1 w-full border-border bg-input text-xs"
            ariaLabel={t("theme_studio.media.kind")}
            size="default"
          />
        </label>
        <label className="text-[10px] text-muted-foreground">
          {t("theme_studio.media.id")}
          <input
            value={mediaId}
            onChange={event => setMediaId(event.target.value)}
            className="mt-1 h-8 w-full rounded-lg border border-border bg-input px-2 font-mono text-xs text-foreground"
          />
        </label>
        <label className="text-[10px] text-muted-foreground sm:col-span-2">
          {t("theme_studio.media.resource")}
          <ThemeStudioSelect
            value={resourceId}
            options={availableResources.map(resource => ({
              value: resource.id,
              label: resource.name,
            }))}
            onValueChange={setResourceId}
            placeholder={t("theme_studio.media.choose_resource")}
            className="mt-1 w-full border-border bg-input text-xs"
            ariaLabel={t("theme_studio.media.resource")}
            size="default"
            disabled={availableResources.length === 0}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <button
            type="button"
            disabled={!canAdd}
            onClick={addMedia}
            className="rounded-md bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {t("theme_studio.media.add")}
          </button>
          {onImport && (
            <label className="cursor-pointer rounded-md border border-border px-2.5 py-1 text-[10px] font-semibold text-foreground">
              {t("theme_studio.media.import")}
              <input
                type="file"
                accept="audio/*,video/*"
                className="hidden"
                onChange={event => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void onImport(file);
                }}
              />
            </label>
          )}
          {!isValidThemeMediaId(mediaId) && (
            <span className="text-[10px] text-destructive">{t("theme_studio.media.id_invalid")}</span>
          )}
        </div>
      </div>

      {mediaCount === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[10px] text-muted-foreground">
          {t("theme_studio.media.empty")}
        </p>
      ) : (
        <div className="space-y-2">
          {Object.entries(config.media).map(([id, definition]) => (
            <MediaEditorRow
              key={id}
              mediaId={id}
              definition={definition}
              resources={resources}
              resourcePort={resourcePort}
              onChange={next => updateMedia(id, next)}
              onDelete={() => removeMedia(id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
