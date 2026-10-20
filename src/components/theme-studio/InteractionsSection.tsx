import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "../../contexts/LanguageContext";
import {
  createEmptyThemeInteractionConfig,
  parseThemeInteractionConfigDetailed,
  type ThemeInteractionConfig,
} from "../../domain/themes/themeInteractionContract";
import {
  deriveThemeInteractionSchemaVersion,
  parseThemeInteractionSource,
  serializeThemeInteractionSource,
} from "../../domain/themes/themeInteractionDraft";
import { InteractionRawJsonEditor } from "./InteractionRawJsonEditor";
import { InteractionStaticPreview } from "./InteractionStaticPreview";
import { InteractionValidationSummary } from "./InteractionValidationSummary";
import { MediaEditor } from "./MediaEditor";
import { RulesEditor } from "./RulesEditor";
import { StateEditor } from "./StateEditor";
import { useThemeStudioResources } from "./useThemeStudioResources";
import type { ThemeStudioResourcePort } from "./themeStudioResourcePort";

type InteractionEditorMode = "visual" | "json";

function countObjectKeys(value: unknown): number {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).length
    : 0;
}

export function InteractionsSection({
  value,
  onChange,
  resourcePort,
  mediaPermissionEnabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  resourcePort?: ThemeStudioResourcePort;
  mediaPermissionEnabled?: boolean;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<InteractionEditorMode>("visual");
  const [visualConfig, setVisualConfig] = useState<ThemeInteractionConfig>(() => {
    const parsed = parseThemeInteractionSource(value);
    return parsed.config ?? createEmptyThemeInteractionConfig();
  });
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [lastEmittedSource, setLastEmittedSource] = useState<string | null>(null);
  const [hasUsableVisualConfig, setHasUsableVisualConfig] = useState(
    () => parseThemeInteractionSource(value).success,
  );

  const parsedValue = useMemo(() => parseThemeInteractionSource(value), [value]);
  const sourceFromVisual = lastEmittedSource === value;
  const rawJsonInvalid = !sourceFromVisual && !parsedValue.success;
  const rawErrors = sourceFromVisual ? [] : parsedValue.errors;

  useEffect(() => {
    if (value === lastEmittedSource) return;
    const parsed = parseThemeInteractionSource(value);
    if (parsed.success && parsed.config) {
      setVisualConfig(parsed.config);
      setHasUsableVisualConfig(true);
    }
  }, [value, lastEmittedSource]);

  const commitConfig = (next: ThemeInteractionConfig) => {
    const source = serializeThemeInteractionSource(next);
    setLastEmittedSource(source);
    setVisualConfig(next);
    setHasUsableVisualConfig(true);
    onChange(source);
  };

  const detailed = useMemo(() => parseThemeInteractionConfigDetailed(visualConfig), [visualConfig]);
  const resourcesState = useThemeStudioResources(resourcePort);

  const rawObject = useMemo<Record<string, unknown> | null>(() => {
    if (mode !== "json") return null;
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }, [mode, value]);
  const rawDetailed = useMemo(
    () => (rawObject ? parseThemeInteractionConfigDetailed(rawObject) : null),
    [rawObject],
  );
  const rawHasInteractions = countObjectKeys(rawObject?.media) > 0 ||
    countObjectKeys(rawObject?.state) > 0 ||
    (Array.isArray(rawObject?.interactions) && rawObject.interactions.length > 0);
  const summarySchemaVersion = mode === "json" && rawObject
    ? (rawHasInteractions ? "1.1" : "1.0")
    : deriveThemeInteractionSchemaVersion(visualConfig);
  const summaryIssues = mode === "json"
    ? (rawDetailed
      ? rawDetailed.issues
      : parsedValue.errors.map(message => ({ path: [], message })))
    : detailed.issues;

  const handleRawChange = (next: string) => {
    setLastEmittedSource(null);
    onChange(next);
  };

  const handleImport = async (file: File) => {
    setResourceError(null);
    try {
      await resourcesState.importResource(file);
    } catch (error: unknown) {
      setResourceError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div>
        <h2 className="text-sm font-bold">{t("theme_studio.interactions.title")}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {t("theme_studio.interactions.hint")}
        </p>
      </div>

      <InteractionValidationSummary
        schemaVersion={summarySchemaVersion}
        issues={summaryIssues}
        mediaPermissionEnabled={mediaPermissionEnabled}
      />

      <div role="tablist" aria-label={t("theme_studio.interactions.mode_label")} className="flex rounded-lg border border-border bg-muted p-0.5">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "visual"}
          onClick={() => setMode("visual")}
          className={`min-h-8 flex-1 rounded-md px-3 text-[11px] font-semibold ${
            mode === "visual" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
          }`}
        >
          {t("theme_studio.interactions.mode_visual")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "json"}
          onClick={() => setMode("json")}
          className={`min-h-8 flex-1 rounded-md px-3 text-[11px] font-semibold ${
            mode === "json" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
          }`}
        >
          {t("theme_studio.interactions.mode_json")}
        </button>
      </div>

      {mode === "visual" && rawJsonInvalid && (
        <div className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-[11px] font-semibold text-destructive">{t("theme_studio.interactions.raw_invalid")}</p>
          <ul className="space-y-0.5">
            {rawErrors.slice(0, 5).map((error, index) => (
              <li key={index} className="text-[10px] leading-relaxed text-destructive">{error}</li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            {hasUsableVisualConfig ? (
              <button
                type="button"
                onClick={() => {
                  commitConfig(visualConfig);
                  setMode("visual");
                }}
                className="rounded-md bg-destructive px-2.5 py-1 text-[10px] font-semibold text-destructive-foreground"
              >
                {t("theme_studio.interactions.discard_raw")}
              </button>
            ) : (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {t("theme_studio.interactions.raw_invalid_no_visual")}
              </p>
            )}
            <button
              type="button"
              onClick={() => setMode("json")}
              className="rounded-md border border-border px-2.5 py-1 text-[10px] font-semibold text-foreground"
            >
              {t("theme_studio.interactions.fix_json")}
            </button>
          </div>
        </div>
      )}

      {mode === "visual" && !rawJsonInvalid && (
        <div className="space-y-3">
          {resourcesState.error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[10px] text-destructive">
              {t("theme_studio.media.resource_load_failed", { message: resourcesState.error })}
            </p>
          )}
          {resourceError && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[10px] text-destructive">
              {t("theme_studio.media.resource_import_failed", { message: resourceError })}
            </p>
          )}

          <details open className="rounded-xl border border-border bg-card p-3">
            <summary className="cursor-pointer text-xs font-bold">{t("theme_studio.media.title")}</summary>
            <div className="mt-3">
              <MediaEditor
                config={visualConfig}
                resources={resourcesState.resources}
                resourcePort={resourcePort}
                mediaPermissionEnabled={mediaPermissionEnabled}
                onChange={commitConfig}
                onImport={resourcePort ? handleImport : undefined}
              />
            </div>
          </details>

          <details open className="rounded-xl border border-border bg-card p-3">
            <summary className="cursor-pointer text-xs font-bold">{t("theme_studio.state.title")}</summary>
            <div className="mt-3">
              <StateEditor config={visualConfig} onChange={commitConfig} />
            </div>
          </details>

          <details open className="rounded-xl border border-border bg-card p-3">
            <summary className="cursor-pointer text-xs font-bold">{t("theme_studio.rules.title")}</summary>
            <div className="mt-3">
              <RulesEditor config={visualConfig} issues={detailed.issues} onChange={commitConfig} />
            </div>
          </details>

          <InteractionStaticPreview
            config={visualConfig}
            resourcePort={resourcePort}
            mediaPermissionEnabled={mediaPermissionEnabled}
          />
        </div>
      )}

      {mode === "json" && (
        <InteractionRawJsonEditor value={value} onChange={handleRawChange} errors={rawErrors} />
      )}
    </div>
  );
}
