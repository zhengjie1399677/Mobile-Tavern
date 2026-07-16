import { useEffect, type ChangeEvent } from "react";
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
import { Upload, Download, Trash2, Check } from "lucide-react";
import {
  applyThemePackage,
  removeThemePackageStyle,
  parseThemePackage,
  serializeThemePackage,
  isCustomThemeId,
  type CustomThemePackage,
} from "../../utils/themePackage";

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
  const customThemes = settings.customThemes ?? [];

  // 挂载时与 customThemes 变化时，把所有自定义主题 CSS 注入 document.head
  // 这样切换主题时只需切换 data-theme 属性，CSS 选择器自动命中
  useEffect(() => {
    for (const theme of customThemes) {
      if (theme.id) {
        applyThemePackage(theme);
      }
    }
  }, [customThemes]);

  // ──────────────────────────────────────────────────────────────────────────
  // 主题包导入 / 导出 / 删除 / 应用
  // ──────────────────────────────────────────────────────────────────────────

  /** 导入主题包：读取 .tavern-theme.json，校验后写入 settings.customThemes */
  const handleImportTheme = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 重置 input value 允许重复导入同一文件
    e.target.value = "";

    try {
      const text = await file.text();
      const result = parseThemePackage(text);
      if (!result.valid || !result.sanitized) {
        await showCustomAlert(
          `主题包格式无效：\n${result.errors.join("\n")}`,
          "导入失败"
        );
        return;
      }

      const pkg = result.sanitized;
      // 同 id 主题覆盖（同名包幂等去重）
      const existingIdx = customThemes.findIndex(t => t.id === pkg.id);
      let nextThemes: CustomThemePackage[];
      if (existingIdx >= 0) {
        nextThemes = [...customThemes];
        nextThemes[existingIdx] = pkg;
      } else {
        nextThemes = [...customThemes, pkg];
      }
      updateSettings({ ...settings, customThemes: nextThemes });
      // 立即注入 CSS（useEffect 也会做，这里提前避免闪烁）
      applyThemePackage(pkg);
      await showCustomAlert(
        `主题「${pkg.name}」v${pkg.version} 导入成功！${existingIdx >= 0 ? "（已覆盖同名旧版本）" : ""}`,
        "导入成功"
      );
    } catch (err) {
      await showCustomAlert(
        `读取文件失败：${(err as Error).message}`,
        "导入失败"
      );
    }
  };

  /** 导出主题包为 .tavern-theme.json 文件 */
  const handleExportTheme = (theme: CustomThemePackage) => {
    const json = serializeThemePackage(theme);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // 文件名：主题名-sanitized_version.json
    const safeName = theme.name.replace(/[^\w\u4e00-\u9fa5]/g, "_").slice(0, 20) || "theme";
    a.download = `${safeName}_${theme.version}.tavern-theme.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /** 删除已导入的自定义主题 */
  const handleDeleteTheme = async (theme: CustomThemePackage) => {
    if (!theme.id) return;
    if (!window.confirm(`确认删除主题「${theme.name}」？此操作不可撤销。`)) return;

    const nextThemes = customThemes.filter(t => t.id !== theme.id);
    updateSettings({ ...settings, customThemes: nextThemes });
    removeThemePackageStyle(theme.id);

    // 如果当前正在使用该主题，切回默认 ocean
    if (currentTheme === theme.id) {
      handleThemeChange("ocean");
    }
  };

  /** 应用自定义主题：先写 isDark 标记供 AppContext 读取，再切换 */
  const handleApplyTheme = (theme: CustomThemePackage) => {
    if (!theme.id) return;
    localStorage.setItem("mobile_tavern_custom_is_dark", String(theme.isDark));
    handleThemeChange(theme.id);
  };

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
                      : isCustomThemeId(String(currentTheme))
                        ? (customThemes.find(t => t.id === currentTheme)?.name ?? "自定义主题")
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
            {customThemes.length > 0 && (
              <>
                <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  已导入的自定义主题
                </div>
                {customThemes.map(theme => (
                  <SelectItem
                    key={theme.id}
                    value={theme.id ?? ""}
                    label={theme.name}
                    className="text-xs"
                  >
                    {theme.name}
                    {theme.isDark ? " · 暗色" : " · 亮色"}
                  </SelectItem>
                ))}
              </>
            )}
          </SelectContent>
        </Select>

        {/* 主题包导入导出 */}
        <div className="mt-2.5 pt-2.5 border-t border-border/30 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold text-muted-foreground block">
              主题包管理
            </label>
            <label className="bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-[11px] px-2.5 py-1.5 rounded-md flex items-center justify-center cursor-pointer select-none transition tap-scale font-semibold gap-1">
              <Upload className="w-3 h-3" />
              导入主题包
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportTheme}
              />
            </label>
          </div>

          {customThemes.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
              尚未导入自定义主题包。导入 <code className="font-mono bg-muted/40 px-1 rounded">.tavern-theme.json</code> 文件以扩展主题选择，支持完全自定义 CSS 变量与样式。
            </p>
          ) : (
            <div className="space-y-1.5">
              {customThemes.map(theme => {
                const isCurrent = currentTheme === theme.id;
                return (
                  <div
                    key={theme.id}
                    className={`flex items-center justify-between gap-2 p-2 rounded-lg border transition ${isCurrent
                      ? "bg-primary/10 border-primary/30"
                      : "bg-muted/20 border-border/40 hover:bg-muted/35"
                      }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-foreground truncate">{theme.name}</span>
                        <span className="text-[9px] font-mono px-1 py-0.5 border border-border/50 rounded bg-muted text-muted-foreground shrink-0">
                          v{theme.version}
                        </span>
                        <span className={`text-[9px] px-1 py-0.5 rounded shrink-0 ${theme.isDark
                          ? "bg-slate-700/50 text-slate-200"
                          : "bg-amber-100/60 text-amber-800"
                          }`}>
                          {theme.isDark ? "暗色" : "亮色"}
                        </span>
                      </div>
                      {theme.description && (
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">{theme.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleApplyTheme(theme)}
                        disabled={isCurrent}
                        className={`p-1.5 rounded-md border transition ${isCurrent
                          ? "bg-primary/15 border-primary/30 text-primary cursor-default"
                          : "bg-muted hover:bg-primary/10 hover:text-primary hover:border-primary/20 text-muted-foreground"
                          }`}
                        title={isCurrent ? "当前已应用" : "应用此主题"}
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportTheme(theme)}
                        className="p-1.5 rounded-md border border-border bg-muted hover:bg-primary/10 hover:text-primary hover:border-primary/20 text-muted-foreground transition"
                        title="导出为 .tavern-theme.json"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTheme(theme)}
                        className="p-1.5 rounded-md border border-destructive/20 bg-destructive/10 hover:bg-destructive/20 text-destructive transition"
                        title="删除此主题"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

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
                { label: "适中 (融合)", blur: 4, dim: 40, key: "medium" },
                { label: "深色 (磨砂)", blur: 12, dim: 75, key: "dark" },
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
