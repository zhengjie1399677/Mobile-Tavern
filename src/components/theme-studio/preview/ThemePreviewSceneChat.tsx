import { AlertTriangle, Settings2, UserRound } from "lucide-react";

/** 聊天场景：固定演示数据，覆盖气泡、菜单、危险操作与输入框。 */
export function ThemePreviewSceneChat() {
  return (
    <div className="space-y-3 p-3">
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

      <button
        type="button"
        data-ui="preview-settings"
        className="flex size-8 items-center justify-center rounded-lg border border-border bg-secondary text-secondary-foreground"
        aria-label="预览设置按钮"
      >
        <Settings2 className="size-3.5" />
      </button>
    </div>
  );
}
