import { useState } from "react";
import { Button } from "@/src/components/ui/button";
import { useTranslation } from "../../contexts/LanguageContext";
import {
  createUniqueThemeCopyName,
  getBlankThemeTemplate,
  type ThemeStartPointKind,
} from "../../domain/themes/themeStartPoints";
import type { CustomThemePackage } from "../../utils/themePackage";
import { ThemeStudioSelect } from "./ThemeStudioSelect";

interface StartPointSectionProps {
  startPointKind: ThemeStartPointKind | null;
  customThemes: CustomThemePackage[];
  onSelectStartPoint: (
    kind: ThemeStartPointKind,
    template: CustomThemePackage,
    name: string,
  ) => Promise<void>;
}

function ThemeSwatch({ theme }: { theme: CustomThemePackage }) {
  return (
    <span className="flex overflow-hidden rounded-md border border-border" aria-hidden="true">
      <span className="size-5" style={{ background: theme.variables["--background"] ?? "transparent" }} />
      <span className="size-5" style={{ background: theme.variables["--primary"] ?? "transparent" }} />
      <span className="size-5" style={{ background: theme.variables["--foreground"] ?? "transparent" }} />
    </span>
  );
}

export function StartPointSection({
  startPointKind,
  customThemes,
  onSelectStartPoint,
}: StartPointSectionProps) {
  const { t } = useTranslation();
  const [selectedCloneId, setSelectedCloneId] = useState("");
  const existingNames = customThemes.map(theme => theme.name);
  const cloneableThemes = customThemes.filter(theme => theme.id);

  const chooseBlank = (kind: "blank-dark" | "blank-light") => {
    const template = getBlankThemeTemplate(kind);
    const name = createUniqueThemeCopyName(template.name, existingNames, "");
    void onSelectStartPoint(kind, template, name);
  };

  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-bold">{t("theme_studio.start.title")}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {t("theme_studio.start.hint")}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {([
          { kind: "blank-dark" as const, titleKey: "theme_studio.start.blank_dark", descriptionKey: "theme_studio.start.blank_dark_hint" },
          { kind: "blank-light" as const, titleKey: "theme_studio.start.blank_light", descriptionKey: "theme_studio.start.blank_light_hint" },
        ]).map(option => {
          const template = getBlankThemeTemplate(option.kind);
          const active = startPointKind === option.kind;
          return (
            <button
              key={option.kind}
              type="button"
              onClick={() => chooseBlank(option.kind)}
              aria-pressed={active}
              className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                active ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/50"
              }`}
            >
              <ThemeSwatch theme={template} />
              <span className="min-w-0">
                <span className="block text-xs font-bold">{t(option.titleKey)}</span>
                <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
                  {t(option.descriptionKey)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-border bg-card p-3">
        <p className="text-xs font-bold">{t("theme_studio.start.clone_title")}</p>
        <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
          {t("theme_studio.start.clone_hint")}
        </p>
        <ThemeStudioSelect
          value={selectedCloneId}
          options={cloneableThemes.map(theme => ({
            value: theme.id as string,
            label: theme.name,
          }))}
          onValueChange={id => {
            setSelectedCloneId("");
            const theme = cloneableThemes.find(item => item.id === id);
            if (!theme) return;
            const name = createUniqueThemeCopyName(theme.name, existingNames);
            void onSelectStartPoint("clone", theme, name);
          }}
          placeholder={t("theme_studio.start.clone_placeholder")}
          className="mt-2 w-full border-border bg-input text-xs"
          ariaLabel={t("theme_studio.start.clone_title")}
          size="default"
          disabled={cloneableThemes.length === 0}
        />
        {startPointKind === "clone" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2 h-7 px-2.5 text-[11px]"
            onClick={() => chooseBlank("blank-dark")}
          >
            {t("theme_studio.start.reset_blank")}
          </Button>
        )}
      </div>
    </section>
  );
}
