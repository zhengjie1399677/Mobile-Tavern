import { useTranslation } from "../../../contexts/LanguageContext";
import type { ThemeStudioPreviewScene } from "../themeStudioTypes";

const SCENES: ReadonlyArray<{ id: ThemeStudioPreviewScene; labelKey: string }> = [
  { id: "chat", labelKey: "theme_studio.preview.scene_chat" },
  { id: "characters", labelKey: "theme_studio.preview.scene_characters" },
  { id: "settings", labelKey: "theme_studio.preview.scene_settings" },
];

export function ThemePreviewSceneSwitcher({
  scene,
  onChange,
}: {
  scene: ThemeStudioPreviewScene;
  onChange: (scene: ThemeStudioPreviewScene) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="tablist"
      aria-label={t("theme_studio.preview.scene_label")}
      className="flex shrink-0 rounded-lg border border-border bg-muted p-0.5"
    >
      {SCENES.map(item => {
        const active = item.id === scene;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={`min-h-7 flex-1 rounded-md px-2 text-[10px] font-semibold transition-colors ${
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(item.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
