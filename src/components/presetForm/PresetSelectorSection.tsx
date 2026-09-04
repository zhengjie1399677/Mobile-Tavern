import type React from "react";
import { Plus, Trash2, Download, Upload, Package, FileText } from "lucide-react";
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
  handleImportPresetJSON: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleExportPresetJSON: () => void;
  handleSaveNewPresetBundle: () => Promise<void>;
  handleLoadPresetBundle: (bundleId: string) => void;
  handleDeletePresetBundle: (presetId: string) => Promise<void>;
}

/** 1. 预设选择与管理 */
export default function PresetSelectorSection({
  settings,
  activeBundleId,
  handleImportPresetJSON,
  handleExportPresetJSON,
  handleSaveNewPresetBundle,
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
    <Card className="rounded-2xl border border-border/70 bg-card/60 backdrop-blur-md shadow-xs p-3">
      <div className="flex flex-col gap-2">
        <div className="flex gap-2 items-center">
          <div className="flex-1 min-w-0">
            <Select
              value={activeBundleId || ""}
              onValueChange={(val) => {
                if (val) handleLoadPresetBundle(val);
              }}
            >
              <SelectTrigger
                aria-label={t("preset_selector.active_preset", { name: "" })}
                className="w-full bg-background/80 border-border/70 text-xs font-semibold rounded-xl px-3 h-9 shadow-2xs focus:ring-1 focus:ring-primary truncate"
              >
                <SelectValue placeholder={t("preset_selector.active_preset", { name: currentBundleName })}>
                  <span className="flex items-center gap-1.5 truncate">
                    {isActiveBuiltin ? (
                      <Package className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                    )}
                    <span className="truncate">{currentBundleName}</span>
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-60 rounded-xl border border-border/80 bg-card/95 backdrop-blur-xl shadow-2xl">
                {(settings.savedPresets || []).map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs py-2 font-medium cursor-pointer">
                    <span className="flex items-center gap-2">
                      {p.isBuiltin ? (
                        <Package className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      ) : (
                        <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                      )}
                      <span className="truncate font-semibold text-foreground">{p.preset.name}</span>
                      <span className={`ml-auto text-[9px] px-1.5 py-0.5 rounded-full font-mono ${
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

          <button
            type="button"
            aria-label={t("preset_selector.save_copy")}
            onClick={handleSaveNewPresetBundle}
            title={t("preset_selector.save_copy")}
            className="shrink-0 h-9 w-9 bg-primary/10 border border-primary/20 hover:border-primary/40 text-primary rounded-xl transition active:scale-95 flex items-center justify-center shadow-2xs"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label={t("preset_selector.delete_custom")}
            onClick={() =>
              handleDeletePresetBundle(settings.preset.id)
            }
            disabled={
              (settings.savedPresets || []).length === 0 ||
              !settings.preset.id ||
              isActiveBuiltin
            }
            title={t("preset_selector.delete_custom")}
            className="shrink-0 h-9 w-9 bg-muted/60 hover:bg-destructive/10 border border-border/70 hover:border-destructive/30 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:pointer-events-none rounded-xl transition active:scale-95 flex items-center justify-center shadow-2xs"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs font-bold pt-0.5">
          <label className="h-8.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 hover:border-primary/30 rounded-xl transition flex justify-center items-center gap-1.5 cursor-pointer active:scale-95 shadow-2xs">
            <Download className="w-3.5 h-3.5" />
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
            className="h-8.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 hover:border-primary/30 rounded-xl transition flex justify-center items-center gap-1.5 active:scale-95 shadow-2xs"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{t("preset_selector.export")}</span>
          </button>
        </div>
      </div>
    </Card>
  );
}
