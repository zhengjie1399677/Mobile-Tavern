import type React from "react";
import { Plus, Save, Trash2, Download, Upload, Package, FileText } from "lucide-react";
import { useTranslation } from "../../contexts/LanguageContext";
import { Card } from "../../../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import type { UserSettings } from "../../types";

interface PresetSelectorSectionProps {
  settings: UserSettings;
  activeBundleId: string;
  isActivePresetDirty: boolean;
  handleImportPresetJSON: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleExportPresetJSON: () => void;
  handleSaveNewPresetBundle: () => Promise<void>;
  handleSaveCurrentPresetBundle: () => Promise<void>;
  handleLoadPresetBundle: (bundleId: string) => Promise<void>;
  handleDeletePresetBundle: (bundleId: string) => Promise<void>;
}

/** 1. 预设选择与管理 */
export default function PresetSelectorSection({
  settings,
  activeBundleId,
  isActivePresetDirty,
  handleImportPresetJSON,
  handleExportPresetJSON,
  handleSaveNewPresetBundle,
  handleSaveCurrentPresetBundle,
  handleLoadPresetBundle,
  handleDeletePresetBundle,
}: PresetSelectorSectionProps) {
  const { t } = useTranslation();
  const activeBundle = (settings.savedPresets || []).find(
    (p) => p.preset.id === settings.preset.id,
  );
  const isActiveBuiltin = !!activeBundle?.isBuiltin ||
    settings.preset.id === "preset_mobile_tavern_basic";
  const currentBundleName = activeBundle?.preset.name || settings.preset.name || "Default";

  return (
    <Card className="rounded-2xl border border-border/70 bg-card/75 backdrop-blur-xl shadow-sm p-3.5 space-y-2.5">
      <div className="flex flex-col gap-2.5">
        <div className="flex gap-2 items-center">
          <div className="flex-1 min-w-0">
            <Select
              value={activeBundleId || ""}
              onValueChange={(val) => {
                if (val) void handleLoadPresetBundle(val);
              }}
            >
              <SelectTrigger
                aria-label={t("preset_selector.active_preset", { name: "" })}
                className="w-full bg-background/90 border-border/70 text-xs font-semibold rounded-xl px-3 h-9.5 shadow-2xs focus:ring-1 focus:ring-primary truncate"
              >
                <SelectValue placeholder={t("preset_selector.active_preset", { name: currentBundleName })}>
                  <span className="flex items-center gap-2 truncate">
                    {isActiveBuiltin ? (
                      <Package className="w-4 h-4 text-sky-400 shrink-0" />
                    ) : (
                      <FileText className="w-4 h-4 text-primary shrink-0" />
                    )}
                    <span className="truncate">{currentBundleName}</span>
                    {isActivePresetDirty && (
                      <span className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[9.5px] font-semibold text-amber-500">
                        {t("preset_selector.unsaved_badge")}
                      </span>
                    )}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-60 rounded-xl border border-border/80 bg-card/95 backdrop-blur-xl shadow-2xl">
                {(settings.savedPresets || []).map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs py-2 font-medium cursor-pointer">
                    <span className="flex items-start gap-2 w-full min-w-0">
                      {p.isBuiltin ? (
                        <Package className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
                      ) : (
                        <FileText className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                      )}
                      <span className="line-clamp-2 break-all font-semibold text-foreground flex-1 min-w-0 leading-snug">
                        {p.preset.name}
                      </span>
                      <span className={`shrink-0 ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full font-mono self-start ${
                        p.isBuiltin
                          ? "bg-sky-500/10 text-sky-500 border border-sky-500/20"
                          : "bg-primary/10 text-primary border border-primary/20"
                      }`}>
                        {p.isBuiltin ? t("preset_selector.builtin_badge") : t("preset_selector.custom_badge")}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              aria-label={t("preset_selector.save_current")}
              onClick={() => void handleSaveCurrentPresetBundle()}
              // 内置预设不可覆盖，但仍允许点击以说明"请另存为副本"，避免禁用按钮吞掉原因。
              disabled={!activeBundleId || !isActivePresetDirty}
              title={isActiveBuiltin
                ? t("preset_selector.save_current_builtin_hint")
                : t("preset_selector.save_current")}
              className={`h-9.5 w-9.5 rounded-xl border transition-all active:scale-90 flex items-center justify-center shadow-2xs ${
                isActivePresetDirty
                  ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 hover:border-emerald-500/50 animate-pulse"
                  : "bg-muted/30 border-border/40 text-muted-foreground/30 pointer-events-none"
              }`}
            >
              <Save className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label={t("preset_selector.save_copy")}
              onClick={handleSaveNewPresetBundle}
              title={t("preset_selector.save_copy")}
              className="h-9.5 w-9.5 bg-primary/10 hover:bg-primary/20 border border-primary/25 hover:border-primary/45 text-primary rounded-xl transition-all active:scale-90 flex items-center justify-center shadow-2xs"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label={t("preset_selector.delete_custom")}
              onClick={() =>
                void handleDeletePresetBundle(activeBundleId)
              }
              disabled={
                (settings.savedPresets || []).length === 0 ||
                !activeBundleId ||
                isActiveBuiltin
              }
              title={t("preset_selector.delete_custom")}
              className="h-9.5 w-9.5 bg-muted/30 hover:bg-rose-500/15 border border-border/40 hover:border-rose-500/30 text-muted-foreground hover:text-rose-400 disabled:opacity-30 disabled:pointer-events-none rounded-xl transition-all active:scale-90 flex items-center justify-center shadow-2xs"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {currentBundleName.length > 14 && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-background/50 border border-border/50 text-[10.5px] text-muted-foreground break-all leading-relaxed">
            <span className="shrink-0 text-primary font-bold">全名:</span>
            <span className="line-clamp-2 text-foreground/90 font-medium">{currentBundleName}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/40">
          <label className="h-9 bg-background/50 hover:bg-primary/10 text-foreground/85 hover:text-primary border border-border/60 hover:border-primary/30 rounded-xl transition flex justify-center items-center gap-1.5 cursor-pointer active:scale-95 text-xs font-semibold shadow-2xs">
            <Download className="w-3.5 h-3.5 text-primary" />
            <span>{t("preset_selector.import")}</span>
            <input
              type="file"
              onChange={handleImportPresetJSON}
              accept=".json,.txt,.bin,application/json,text/plain"
              className="hidden"
            />
          </label>
          <button
            type="button"
            onClick={handleExportPresetJSON}
            className="h-9 bg-background/50 hover:bg-primary/10 text-foreground/85 hover:text-primary border border-border/60 hover:border-primary/30 rounded-xl transition flex justify-center items-center gap-1.5 active:scale-95 text-xs font-semibold shadow-2xs"
          >
            <Upload className="w-3.5 h-3.5 text-sky-400" />
            <span>{t("preset_selector.export")}</span>
          </button>
        </div>
      </div>
    </Card>
  );
}
