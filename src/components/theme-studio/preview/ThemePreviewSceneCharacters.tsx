import { Search, UserRound } from "lucide-react";

/** 角色场景：搜索框、角色卡、标签与当前角色态。 */
export function ThemePreviewSceneCharacters() {
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-input px-2.5 py-2">
        <Search className="size-3.5 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">搜索角色</span>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs font-bold">全部角色</p>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">3</span>
      </div>

      <div className="space-y-2">
        {[
          { name: "旅伴", desc: "熟悉旧城区的向导", tag: "冒险" },
          { name: "钟楼守夜人", desc: "知道很多旧故事", tag: "悬疑" },
          { name: "雨中的信使", desc: "总在傍晚出现", tag: "日常" },
        ].map(item => (
          <div key={item.name} className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-2.5 text-card-foreground">
            <div className="flex size-10 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
              <UserRound className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-xs font-bold">{item.name}</p>
                <span className="rounded bg-accent px-1.5 py-0.5 text-[9px] text-accent-foreground">{item.tag}</span>
              </div>
              <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{item.desc}</p>
            </div>
            <span className="rounded-md bg-primary px-2 py-1 text-[10px] font-semibold text-primary-foreground">聊天</span>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-2.5">
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          角色卡演示数据固定，不读取真实角色库。
        </p>
      </div>
    </div>
  );
}
