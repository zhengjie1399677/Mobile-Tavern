import React from "react";
import { MessageCircle, Settings, UserRound } from "lucide-react";
import { buildThemeCss, type CustomThemePackage } from "../../utils/themePackage";
import type { ThemeStudioPreviewScene } from "./themeStudioTypes";
import { ThemePreviewSceneCharacters } from "./preview/ThemePreviewSceneCharacters";
import { ThemePreviewSceneChat } from "./preview/ThemePreviewSceneChat";
import { ThemePreviewSceneSettings } from "./preview/ThemePreviewSceneSettings";

const PREVIEW_THEME_ID = "custom_theme_studio_preview";

interface ThemeDraftPreviewProps {
  theme: CustomThemePackage;
  scene?: ThemeStudioPreviewScene;
  /** 静态状态预览 token；只写在本预览根节点，不影响正式应用。 */
  stateTokens?: string[];
}

export default function ThemeDraftPreview({
  theme,
  scene = "chat",
  stateTokens,
}: ThemeDraftPreviewProps) {
  const previewTheme = React.useMemo<CustomThemePackage>(() => ({
    ...theme,
    id: PREVIEW_THEME_ID,
  }), [theme]);

  const stateAttribute = stateTokens && stateTokens.length > 0
    ? stateTokens.join(" ")
    : undefined;

  return (
    <section
      data-theme={PREVIEW_THEME_ID}
      data-ui="theme-studio-preview"
      data-preview-scene={scene}
      data-theme-state={stateAttribute}
      aria-label="主题草稿预览"
      className={`relative flex h-full min-h-[26rem] flex-col overflow-hidden rounded-2xl border border-border bg-background text-foreground ${theme.isDark ? "dark" : ""}`}
      style={{ colorScheme: theme.isDark ? "dark" : "light" }}
    >
      <style>{buildThemeCss(previewTheme)}</style>

      <header className="flex min-h-11 items-center justify-between border-b border-border bg-card px-3">
        <div>
          <p className="text-xs font-bold">远行者酒馆</p>
          <p className="text-[10px] text-muted-foreground">固定演示数据 · 不读取真实会话</p>
        </div>
        <button
          type="button"
          data-ui="preview-settings"
          className="flex size-8 items-center justify-center rounded-lg border border-border bg-secondary text-secondary-foreground"
          aria-label="预览设置按钮"
        >
          <Settings className="size-3.5" />
        </button>
      </header>

      <div
        data-ui="main-tab-content"
        data-active-tab={scene}
        className="flex-1 overflow-y-auto custom-scrollbar"
      >
        {scene === "chat" && <ThemePreviewSceneChat />}
        {scene === "characters" && <ThemePreviewSceneCharacters />}
        {scene === "settings" && <ThemePreviewSceneSettings />}
      </div>

      <nav
        data-ui="main-tab-bar"
        aria-label="预览底栏"
        className="grid grid-cols-3 border-t border-border bg-card px-2 pb-1.5 pt-1"
      >
        {[
          { id: "characters" as const, label: "角色", icon: UserRound },
          { id: "chat" as const, label: "聊天", icon: MessageCircle },
          { id: "settings" as const, label: "设置", icon: Settings },
        ].map(item => {
          const Icon = item.icon;
          const selected = item.id === scene;
          return (
            <button
              type="button"
              key={item.id}
              data-ui="main-tab"
              data-tab-id={item.id}
              aria-selected={selected}
              className={`flex min-h-9 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] ${selected ? "text-primary font-medium" : "text-muted-foreground"}`}
            >
              <Icon className="size-3.5" />
              {item.label}
            </button>
          );
        })}
      </nav>
    </section>
  );
}
