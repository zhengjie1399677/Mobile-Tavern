import React from "react";
import { AlertTriangle, Check, MessageCircle, Settings2, UserRound } from "lucide-react";
import { buildThemeCss, type CustomThemePackage } from "../../utils/themePackage";

const PREVIEW_THEME_ID = "custom_theme_studio_preview";

interface ThemeDraftPreviewProps {
  theme: CustomThemePackage;
}

export default function ThemeDraftPreview({ theme }: ThemeDraftPreviewProps) {
  const previewTheme = React.useMemo<CustomThemePackage>(() => ({
    ...theme,
    id: PREVIEW_THEME_ID,
  }), [theme]);

  return (
    <section
      data-theme={PREVIEW_THEME_ID}
      data-ui="theme-studio-preview"
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
          <Settings2 className="size-3.5" />
        </button>
      </header>

      <div data-ui="main-tab-content" data-active-tab="chat" className="flex-1 space-y-3 overflow-y-auto p-3">
        <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-2.5 text-card-foreground">
          <div className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <UserRound className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold">旅伴</p>
            <p className="truncate text-[10px] text-muted-foreground">正在与你整理今晚的行程。</p>
          </div>
        </div>

        <div className="space-y-2.5">
          <div className="mr-8 rounded-2xl rounded-tl-md border border-border bg-card p-2.5 text-card-foreground">
            <p className="text-xs leading-relaxed" style={{ color: "var(--dialogue-color)" }}>
              我们先去旧城区看看，然后在钟楼下会合。
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: "var(--prose-color)" }}>
              雨点落在窗沿上，远处的灯光逐渐亮起。
            </p>
          </div>
          <div className="ml-8 rounded-2xl rounded-tr-md bg-primary p-2.5 text-primary-foreground">
            <p className="text-xs leading-relaxed">好，我会带上地图和那本旧笔记。</p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-popover p-2.5 text-popover-foreground">
          <p className="text-[11px] font-bold">菜单与状态</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-md bg-secondary px-2 py-1 text-[11px] text-secondary-foreground">次要操作</span>
            <span className="rounded-md bg-accent px-2 py-1 text-[11px] text-accent-foreground">强调状态</span>
            <span className="flex items-center gap-1 rounded-md bg-destructive px-2 py-1 text-[11px] text-destructive-foreground">
              <AlertTriangle className="size-3" />危险操作
            </span>
          </div>
        </div>

        <label className="block text-xs font-semibold">
          表单预览
          <input
            readOnly
            value="输入内容"
            className="mt-1.5 h-8.5 w-full rounded-lg border border-border bg-input px-2.5 text-xs text-foreground outline-none ring-ring focus:ring-2"
          />
        </label>
      </div>

      <nav data-ui="main-tab-bar" aria-label="预览底栏" className="grid grid-cols-3 border-t border-border bg-card px-2 pb-1.5 pt-1">
        {[
          { id: "characters", label: "角色", icon: UserRound },
          { id: "chat", label: "聊天", icon: MessageCircle },
          { id: "settings", label: "设置", icon: Check },
        ].map(item => {
          const Icon = item.icon;
          const selected = item.id === "chat";
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
