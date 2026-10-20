import { SECTION_ITEMS } from "./ThemeStudioNavigation";
import { StartPointSection } from "./StartPointSection";
import type { StudioSection } from "./themeStudioTypes";
import type { ThemeStartPointKind } from "../../domain/themes/themeStartPoints";
import type { CustomThemePackage } from "../../utils/themePackage";

export function StudioOverviewSection({
  isNew,
  startPointKind,
  customThemes,
  onSelectStartPoint,
  onSelect,
}: {
  isNew: boolean;
  startPointKind: ThemeStartPointKind | null;
  customThemes: CustomThemePackage[];
  onSelectStartPoint: (
    kind: ThemeStartPointKind,
    template: CustomThemePackage,
    name: string,
  ) => Promise<void>;
  onSelect: (section: StudioSection) => void;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {isNew && (
        <StartPointSection
          startPointKind={startPointKind}
          customThemes={customThemes}
          onSelectStartPoint={onSelectStartPoint}
        />
      )}
      <div>
        <h2 className="text-sm font-bold">编辑主题草稿</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          草稿只影响预览区域。保存主题不会改变当前外观，只有“保存并应用”才会切换正式主题。
        </p>
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {SECTION_ITEMS.map(item => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className="flex min-h-12 w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/60"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-bold">{item.title}</span>
                <span className="mt-0.5 block text-[10px] text-muted-foreground">{item.description}</span>
              </span>
              <span aria-hidden="true" className="text-xs text-muted-foreground">›</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
