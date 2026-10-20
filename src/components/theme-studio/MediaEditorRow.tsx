import { useTranslation } from "../../contexts/LanguageContext";
import type { LocalResourceMetadata } from "../../domain/resources/types";
import type { ThemeMediaDefinition } from "../../domain/themes/themeInteractionContract";
import { DraftNumberInput } from "./DraftNumberInput";
import { MediaManualPreview, resourceIdFromSrc } from "./MediaManualPreview";
import { ThemeStudioSelect } from "./ThemeStudioSelect";
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
        <ThemeStudioSelect
          value={sameKindResources.some(item => item.id === resourceId) ? resourceId : ""}
          options={sameKindResources.map(item => ({ value: item.id, label: item.name }))}
          onValueChange={value => {
            const next = sameKindResources.find(item => item.id === value);
            if (!next || !resourcePort) return;
            onChange({ ...definition, src: resourcePort.getResourceReference(next.id) });
          }}
          placeholder={t("theme_studio.media.choose_resource")}
          className="mt-1 w-full border-border bg-input text-xs"
          ariaLabel={t("theme_studio.media.resource")}
          size="default"
          disabled={sameKindResources.length === 0}
        />
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
          <ThemeStudioSelect
            value={definition.preload}
            options={[
              { value: "none", label: labels.preload("none") },
              { value: "metadata", label: labels.preload("metadata") },
              { value: "auto", label: labels.preload("auto") },
            ]}
            onValueChange={value => onChange({
              ...definition,
              preload: value as ThemeMediaDefinition["preload"],
            })}
            className="mt-1 w-full border-border bg-input text-[10px]"
            ariaLabel={t("theme_studio.media.preload")}
            size="sm"
          />
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
              <ThemeStudioSelect
                value={definition.fit}
                options={[
                  { value: "cover", label: labels.fit("cover") },
                  { value: "contain", label: labels.fit("contain") },
                  { value: "fill", label: labels.fit("fill") },
                ]}
                onValueChange={value => onChange({
                  ...definition,
                  fit: value as "cover" | "contain" | "fill",
                })}
                className="mt-1 w-full border-border bg-input text-[10px]"
                ariaLabel={t("theme_studio.media.fit")}
                size="sm"
              />
            </label>
          </>
        ) : null}
      </div>

      <MediaManualPreview definition={definition} resourcePort={resourcePort} />
    </div>
  );
}
