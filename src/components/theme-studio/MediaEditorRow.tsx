import { useTranslation } from "../../contexts/LanguageContext";
import type { LocalResourceMetadata } from "../../domain/resources/types";
import type { ThemeMediaDefinition } from "../../domain/themes/themeInteractionContract";
import { DraftNumberInput } from "./DraftNumberInput";
import { MediaManualPreview, resourceIdFromSrc } from "./MediaManualPreview";
import { useThemeStudioTypeLabels } from "./themeStudioTypeLabels";
import type { ThemeStudioResourcePort } from "./themeStudioResourcePort";

export function MediaEditorRow({
  mediaId,
  definition,
  resources,
  resourcePort,
  onChange,
  onDelete,
}: {
  mediaId: string;
  definition: ThemeMediaDefinition;
  resources: LocalResourceMetadata[];
  resourcePort?: ThemeStudioResourcePort;
  onChange: (definition: ThemeMediaDefinition) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const labels = useThemeStudioTypeLabels();
  const resourceId = resourceIdFromSrc(definition.src);
  const resource = resources.find(item => item.id === resourceId);
  const sameKindResources = resources.filter(item => item.kind === definition.type);

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-[11px] font-semibold text-foreground">{mediaId}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {definition.type === "audio" ? t("theme_studio.media.kind_audio") : t("theme_studio.media.kind_video")}
            {" · "}
            {resource?.name ?? t("theme_studio.media.unknown_resource")}
          </p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="shrink-0 rounded-md border border-destructive/40 px-2 py-1 text-[10px] font-semibold text-destructive"
        >
          {t("theme_studio.media.delete")}
        </button>
      </div>

      {!resource && (
        <p className="text-[10px] text-amber-700 dark:text-amber-300">
          {t("theme_studio.media.missing_resource")}
        </p>
      )}

      <label className="block text-[10px] font-semibold text-muted-foreground">
        {t("theme_studio.media.resource")}
        <select
          value={sameKindResources.some(item => item.id === resourceId) ? resourceId : ""}
          onChange={event => {
            const next = sameKindResources.find(item => item.id === event.target.value);
            if (!next || !resourcePort) return;
            onChange({ ...definition, src: resourcePort.getResourceReference(next.id) });
          }}
          className="mt-1 h-8 w-full rounded-lg border border-border bg-input px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">{t("theme_studio.media.choose_resource")}</option>
          {sameKindResources.map(item => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            checked={definition.loop}
            onChange={event => onChange({ ...definition, loop: event.target.checked })}
          />
          {t("theme_studio.media.loop")}
        </label>
        <label className="text-[10px] text-muted-foreground">
          {t("theme_studio.media.preload")}
          <select
            value={definition.preload}
            onChange={event => onChange({
              ...definition,
              preload: event.target.value as ThemeMediaDefinition["preload"],
            })}
            className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
          >
            <option value="none">{labels.preload("none")}</option>
            <option value="metadata">{labels.preload("metadata")}</option>
            <option value="auto">{labels.preload("auto")}</option>
          </select>
        </label>
        <label className="text-[10px] text-muted-foreground">
          {t("theme_studio.media.volume")}
          <DraftNumberInput
            value={definition.volume}
            min={0}
            max={1}
            step={0.05}
            onCommit={value => onChange({ ...definition, volume: value })}
            className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
            ariaLabel={t("theme_studio.media.volume")}
          />
        </label>
        {definition.type === "video" ? (
          <>
            <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <input
                type="checkbox"
                checked={definition.muted}
                onChange={event => onChange({ ...definition, muted: event.target.checked })}
              />
              {t("theme_studio.media.muted")}
            </label>
            <label className="text-[10px] text-muted-foreground">
              {t("theme_studio.media.fit")}
              <select
                value={definition.fit}
                onChange={event => onChange({
                  ...definition,
                  fit: event.target.value as "cover" | "contain" | "fill",
                })}
                className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
              >
                <option value="cover">{labels.fit("cover")}</option>
                <option value="contain">{labels.fit("contain")}</option>
                <option value="fill">{labels.fit("fill")}</option>
              </select>
            </label>
          </>
        ) : null}
      </div>

      <MediaManualPreview definition={definition} resourcePort={resourcePort} />
    </div>
  );
}
