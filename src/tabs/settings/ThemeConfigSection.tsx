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
      <CardHeader className="pb-3 border-b border-border/50">
        <CardTitle className="text-sm flex items-center gap-2">
          <span>阅读主题与色彩基调</span>
        </CardTitle>
        <CardDescription className="text-[11px]">
          切换界面的高对比度和情绪感官
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <Select
          value={currentTheme}
          onValueChange={(val: any) => handleThemeChange(val)}
        >
          <SelectTrigger className="w-full text-xs h-9 bg-input/50 font-medium">
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

        <div className="mt-4 pt-4 border-t border-border/50 space-y-2">
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
        <div className="mt-4 pt-4 border-t border-border/50 space-y-4.5">
          {/* 变暗与模糊融合度调节（合并为单一选项，三档调节） */}
          <div className="space-y-2">
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
            <input
              type="checkbox"
              checked={settings.enableChatBgAnimation ?? false}
              onChange={(e) =>
                updateSettings((prev) => ({
                  ...prev,
                  enableChatBgAnimation: e.target.checked,
                }))
              }
              className="w-4 h-4 rounded border-border bg-input text-primary accent-primary cursor-pointer focus:ring-0"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
