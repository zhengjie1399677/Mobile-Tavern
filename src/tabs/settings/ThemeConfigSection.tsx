import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "../../../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { compressImage } from "../../utils/imageCompressor";
import type { UnifiedAppContextProps } from "../../UnifiedAppContext";

export type ThemeConfigSectionProps = Pick<UnifiedAppContextProps,
  "settings" | "updateSettings" | "currentTheme" | "handleThemeChange" | "showCustomAlert"
>;

export default function ThemeConfigSection({
  settings,
  updateSettings,
  currentTheme,
  handleThemeChange,
  showCustomAlert,
}: ThemeConfigSectionProps) {
  return (
    <Card className="glass-panel shadow-sm">
      <CardHeader className="pb-1 pt-2.5 px-3">
        <CardTitle className="text-[12px] flex items-center gap-2 font-bold text-foreground">
          <span>阅读主题与色彩基调</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-1 px-3 pb-3">
        <Select
          value={currentTheme}
          onValueChange={(val: any) => handleThemeChange(val)}
        >
          <SelectTrigger aria-label="阅读主题与色彩基调" className="w-full text-xs h-9 bg-input/50 font-medium">
            <SelectValue placeholder="选择主题">
              {currentTheme === "snow"
                ? "极简纯白"
                : currentTheme === "sand"
                  ? "浅沙暮色"
                  : currentTheme === "ocean"
                    ? "荧光深海"
                    : currentTheme === "obsidian"
                      ? "黑曜石暗黑"
                      : "选择主题"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="snow" label="极简纯白" className="text-xs">
              极简纯白
            </SelectItem>
            <SelectItem value="sand" label="浅沙暮色" className="text-xs">
              浅沙暮色
            </SelectItem>
            <SelectItem value="ocean" label="荧光深海" className="text-xs">
              荧光深海
            </SelectItem>
            <SelectItem value="obsidian" label="黑曜石暗黑" className="text-xs">
              黑曜石暗黑
            </SelectItem>
          </SelectContent>
        </Select>

        {/* 聊天字体大小调节 */}
        <div className="mt-2.5 pt-2.5 border-t border-border/30 space-y-1">
          <label className="text-[11px] font-semibold text-muted-foreground block">
            聊天字体大小调节
          </label>
          <div className="flex items-center justify-between bg-muted/20 border border-border/40 rounded-lg p-2">
            <span className="text-xs text-muted-foreground pl-1 select-none font-semibold">
              当前字号: <span className="text-primary font-bold">{settings.chatFontSize ?? 14}px</span>
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  const currentSize = settings.chatFontSize ?? 14;
                  const newSize = Math.max(12, currentSize - 1);
                  updateSettings((prev) => ({ ...prev, chatFontSize: newSize }));
                }}
                className="bg-muted hover:bg-primary/10 border border-border hover:border-primary/20 text-muted-foreground hover:text-primary w-8 h-8 rounded-md flex items-center justify-center text-xs transition tap-scale font-bold"
                title="减小字号"
              >
                A-
              </button>
              <button
                type="button"
                onClick={() => {
                  const currentSize = settings.chatFontSize ?? 14;
                  const newSize = Math.min(24, currentSize + 1);
                  updateSettings((prev) => ({ ...prev, chatFontSize: newSize }));
                }}
                className="bg-muted hover:bg-primary/10 border border-border hover:border-primary/20 text-muted-foreground hover:text-primary w-8 h-8 rounded-md flex items-center justify-center text-xs transition tap-scale font-bold"
                title="增大字号"
              >
                A+
              </button>
            </div>
          </div>
        </div>

        {/* 聊天行距调节 */}
        <div className="mt-2 space-y-1">
          <label className="text-[11px] font-semibold text-muted-foreground block">
            聊天行距调节
          </label>
          <div className="flex items-center justify-between bg-muted/20 border border-border/40 rounded-lg p-2">
            <span className="text-xs text-muted-foreground pl-1 select-none font-semibold">
              当前行距: <span className="text-primary font-bold">{(settings.chatLineHeight ?? 1.5).toFixed(1)}</span>
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  const currentLH = settings.chatLineHeight ?? 1.5;
                  const newLH = Number(Math.max(1.0, currentLH - 0.1).toFixed(1));
                  updateSettings((prev) => ({ ...prev, chatLineHeight: newLH }));
                }}
                className="bg-muted hover:bg-primary/10 border border-border hover:border-primary/20 text-muted-foreground hover:text-primary w-8 h-8 rounded-md flex items-center justify-center text-xs transition tap-scale font-bold"
                title="减小行距"
              >
                L-
              </button>
              <button
                type="button"
                onClick={() => {
                  const currentLH = settings.chatLineHeight ?? 1.5;
                  const newLH = Number(Math.min(2.5, currentLH + 0.1).toFixed(1));
                  updateSettings((prev) => ({ ...prev, chatLineHeight: newLH }));
                }}
                className="bg-muted hover:bg-primary/10 border border-border hover:border-primary/20 text-muted-foreground hover:text-primary w-8 h-8 rounded-md flex items-center justify-center text-xs transition tap-scale font-bold"
                title="增大行距"
              >
                L+
              </button>
            </div>
          </div>
        </div>

        <div className="mt-2.5 pt-2.5 border-t border-border/30 space-y-1">
          <label className="text-[11px] font-semibold text-muted-foreground block">
            全局默认聊天背景图片 (当角色未设置专属背景时生效)
          </label>
          <div className="flex items-center justify-between bg-muted/20 border border-border/40 rounded-lg p-2">
            <span className="text-xs text-muted-foreground truncate max-w-[200px] pl-1 select-none">
              {settings.globalChatBg
                ? "✨ 已启用自定义背景图片"
                : "未设置（使用默认主题底色）"}
            </span>
            <div className="flex gap-2 shrink-0">
              <label className="bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-xs px-3 py-1.5 rounded-md flex items-center justify-center cursor-pointer select-none transition tap-scale font-semibold">
                上传
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                     const file = e.target.files?.[0];
                     if (file) {
                       if (file.size > 5 * 1024 * 1024) {
                         showCustomAlert("⚠️ 上传失败：背景图片大小不能超过 5MB！");
                         return;
                       }
                       compressImage(file, 1080, 1920, 0.75, "image/jpeg")
                         .then((base64) => {
                           updateSettings({ ...settings, globalChatBg: base64 });
                         })
                         .catch((err) => {
                           showCustomAlert("⚠️ 图片压缩失败：" + err.message);
                         });
                     }
                  }}
                />
              </label>
              {settings.globalChatBg && (
                <button
                  type="button"
                  onClick={() => updateSettings({ ...settings, globalChatBg: "" })}
                  className="bg-muted hover:bg-destructive/10 border border-border hover:border-destructive/20 text-muted-foreground hover:text-destructive px-3 py-1.5 rounded-md text-xs transition tap-scale font-semibold"
                >
                  清除
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 背景参数自定义选项与动效控制 */}
        <div className="mt-2.5 pt-2.5 border-t border-border/30 space-y-2.5">
          {/* 变暗与模糊融合度调节（合并为单一选项，三档调节） */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground block">
              聊天背景融合效果
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "清晰 (原图)", blur: 0, dim: 0, key: "clear" },
                { label: "适中 (融合)", blur: 0, dim: 45, key: "medium" },
                { label: "深色 (磨砂)", blur: 20, dim: 80, key: "dark" },
              ].map((opt) => {
                const currentDim = settings.chatBackgroundDim ?? 50;
                const active =
                  opt.key === "clear"
                    ? currentDim <= 20
                    : opt.key === "medium"
                      ? currentDim > 20 && currentDim <= 65
                      : currentDim > 65;

                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() =>
                      updateSettings((prev) => ({
                        ...prev,
                        chatBackgroundBlur: opt.blur,
                        chatBackgroundDim: opt.dim,
                      }))
                    }
                    className={`py-2 px-0.5 rounded text-[10px] border text-center transition-all ${active
                        ? "bg-primary/20 border-primary text-primary font-semibold"
                        : "bg-muted/40 border-border/45 text-muted-foreground hover:bg-muted/65"
                      }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 慢速位移动画开关 */}
          <div className="flex items-center justify-between pt-1">
            <label className="text-[11px] font-semibold text-muted-foreground">
              启用背景慢速呼吸动效 (肯斯伯恩效果)
            </label>
            <label className="checkBox-container">
              <input
                type="checkbox"
                checked={settings.enableChatBgAnimation ?? false}
                onChange={(e) =>
                  updateSettings((prev) => ({
                    ...prev,
                    enableChatBgAnimation: e.target.checked,
                  }))
                }
              />
              <div className="checkBox-transition" />
            </label>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
