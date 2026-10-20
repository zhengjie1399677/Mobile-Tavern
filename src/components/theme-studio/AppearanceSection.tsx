import { Button } from "@/src/components/ui/button";
import type { CustomThemePackage } from "../../utils/themePackage";
import { StudioField } from "./StudioField";

const RADIUS_PRESETS = [
  { label: "直角", value: "0rem" },
  { label: "轻微", value: "0.35rem" },
  { label: "标准", value: "0.6rem" },
  { label: "柔和", value: "1rem" },
];

export function AppearanceSection({
  theme,
  updateTheme,
  updateVariable,
}: {
  theme: CustomThemePackage;
  updateTheme: (updater: (theme: CustomThemePackage) => CustomThemePackage) => void;
  updateVariable: (key: string, value: string) => void;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <StudioField label="主题名称" required>
        <input
          value={theme.name}
          maxLength={40}
          onChange={event => updateTheme(current => ({ ...current, name: event.target.value }))}
          className="h-8.5 w-full rounded-lg border border-border bg-input px-2.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
        />
      </StudioField>
      <StudioField label="主题说明">
        <textarea
          value={theme.description ?? ""}
          rows={2}
          onChange={event => updateTheme(current => ({ ...current, description: event.target.value }))}
          className="min-h-16 w-full resize-y rounded-lg border border-border bg-input p-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
        />
      </StudioField>
      <div className="flex min-h-12 items-center justify-between gap-3 border-y border-border py-2">
        <div>
          <p className="text-xs font-bold">基础模式</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">同步浏览器配色和原生状态栏图标明暗。</p>
        </div>
        <div className="flex rounded-lg border border-border bg-muted p-0.5">
          {[false, true].map(isDark => (
            <Button
              key={String(isDark)}
              type="button"
              size="sm"
              className="h-7 px-2.5 text-xs"
              variant={theme.isDark === isDark ? "default" : "ghost"}
              onClick={() => updateTheme(current => ({ ...current, isDark }))}
            >
              {isDark ? "深色" : "浅色"}
            </Button>
          ))}
        </div>
      </div>
      <StudioField label="圆角">
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {RADIUS_PRESETS.map(preset => (
            <Button
              key={preset.value}
              type="button"
              size="sm"
              className="h-7.5 text-xs"
              variant={theme.variables["--radius"] === preset.value ? "default" : "outline"}
              onClick={() => updateVariable("--radius", preset.value)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <input
          aria-label="高级圆角值"
          value={theme.variables["--radius"] ?? ""}
          onChange={event => updateVariable("--radius", event.target.value)}
          placeholder="高级值，例如 0.75rem"
          className="mt-2 h-8 w-full rounded-lg border border-border bg-input px-2.5 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
        />
      </StudioField>
      <details className="rounded-xl border border-border bg-card p-3">
        <summary className="cursor-pointer text-xs font-bold">高级信息</summary>
        <div className="mt-3">
          <StudioField label="主题包版本">
            <input
              value={theme.version}
              onChange={event => updateTheme(current => ({ ...current, version: event.target.value }))}
              className="h-8 w-full rounded-lg border border-border bg-input px-2.5 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </StudioField>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">Schema 会根据是否使用交互与媒体自动选择 1.0 或 1.1。</p>
      </details>
    </div>
  );
}
