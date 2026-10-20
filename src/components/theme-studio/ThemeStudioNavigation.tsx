import { Code, LayoutDashboard, Palette, SlidersHorizontal, Workflow } from "lucide-react";
import { Button } from "../../../components/ui/button";
import type { StudioSection, StudioSectionItem } from "./themeStudioTypes";

export const SECTION_ITEMS: StudioSectionItem[] = [
  { id: "appearance", title: "外观", description: "明暗、圆角与主题信息", icon: SlidersHorizontal },
  { id: "colors", title: "颜色", description: "核心颜色与完整语义变量", icon: Palette },
  { id: "css", title: "自定义 CSS", description: "作用于现有 UI 的受控样式", icon: Code },
  { id: "interactions", title: "交互与媒体", description: "Theme 1.1 声明式配置", icon: Workflow },
];

export function ThemeStudioNavigation({
  section,
  onSelect,
}: {
  section: StudioSection;
  onSelect: (section: StudioSection) => void;
}) {
  const items = [
    { id: "overview" as const, title: "工作室首页", icon: LayoutDashboard },
    ...SECTION_ITEMS.map(item => ({ id: item.id, title: item.title, icon: item.icon })),
  ];
  return (
    <nav aria-label="主题工作室分区" className="space-y-1">
      {items.map(item => {
        const Icon = item.icon;
        const active = item.id === section;
        return (
          <Button
            key={item.id}
            type="button"
            size="sm"
            variant={active ? "secondary" : "ghost"}
            className="h-8 w-full justify-start text-xs"
            aria-current={active ? "page" : undefined}
            onClick={() => onSelect(item.id)}
          >
            <Icon className="size-3.5" />
            {item.title}
          </Button>
        );
      })}
    </nav>
  );
}
