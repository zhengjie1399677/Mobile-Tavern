import { ChevronRight, Moon, Palette, Shield, Trash2 } from "lucide-react";

/** 设置场景：分组卡片、开关行、危险操作与次级表面。 */
export function ThemePreviewSceneSettings() {
  return (
    <div className="space-y-3 p-3">
      <p className="text-xs font-bold">设置</p>

      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card text-card-foreground">
        {[
          { icon: Palette, title: "外观", desc: "主题、圆角与字体" },
          { icon: Moon, title: "显示", desc: "深色模式与过渡" },
          { icon: Shield, title: "隐私", desc: "本地存储与权限" },
        ].map(item => {
          const Icon = item.icon;
          return (
            <div key={item.title} className="flex min-h-11 items-center gap-2.5 px-3 py-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold">{item.title}</span>
                <span className="mt-0.5 block text-[10px] text-muted-foreground">{item.desc}</span>
              </span>
              <ChevronRight className="size-3.5 text-muted-foreground" />
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border bg-popover p-3 text-popover-foreground">
        <div>
          <p className="text-xs font-semibold">启动动画</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">减少动态效果时自动停用</p>
        </div>
        <span className="flex h-5 w-9 items-center rounded-full bg-primary p-0.5">
          <span className="ml-auto size-4 rounded-full bg-primary-foreground" />
        </span>
      </div>

      <button
        type="button"
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-[11px] font-semibold text-destructive"
      >
        <Trash2 className="size-3.5" />清除本地数据
      </button>
    </div>
  );
}
