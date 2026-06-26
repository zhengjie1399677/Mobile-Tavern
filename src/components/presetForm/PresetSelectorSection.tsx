import type React from "react";
import { Plus, Trash2, Download, Upload } from "lucide-react";
import { Card } from "../../../components/ui/card";
import { DEFAULT_PRESETS } from "../../App";
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
  return (
    <Card className="glass-panel shadow-sm p-3">
      <div className="flex flex-col gap-2">
        <div className="flex gap-2 relative">
          <select
            className="flex-1 bg-muted/40 border border-border text-xs text-foreground rounded-md px-3 font-semibold h-9 outline-none focus:ring-1 focus:ring-primary appearance-none cursor-pointer"
            value={activeBundleId}
            onChange={(e) => handleLoadPresetBundle(e.target.value)}
          >
            <option value="" disabled>
              当前预设: {settings.preset.name}
            </option>
            {(settings.savedPresets || []).map((p) => (
              <option key={p.id} value={p.id}>
                📄 {p.preset.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleSaveNewPresetBundle}
            title="另存为新预设副本"
            className="shrink-0 bg-primary/10 border border-primary/20 hover:border-primary/30 text-primary p-2 rounded-md transition tap-scale flex items-center justify-center"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={() =>
              handleDeletePresetBundle(settings.preset.id)
            }
            disabled={
              (settings.savedPresets || []).length === 0 ||
              !settings.preset.id ||
              settings.preset.id === "default" ||
              Object.keys(DEFAULT_PRESETS).includes(settings.preset.id)
            }
            title="删除当前自定义预设"
            className="shrink-0 bg-muted hover:bg-destructive/10 border border-border hover:border-destructive/20 text-muted-foreground hover:text-destructive disabled:opacity-20 disabled:bg-muted/30 disabled:border-transparent p-2 rounded-md transition tap-scale flex items-center justify-center"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs font-bold pt-1">
          <label className="bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 hover:border-primary/30 py-2 rounded-md text-center transition flex justify-center items-center gap-1 cursor-pointer tap-scale shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            <Download className="w-3.5 h-3.5" /> 导入配置
            <input
              type="file"
              onChange={handleImportPresetJSON}
              accept=".json"
              className="hidden"
            />
          </label>
          <button
            onClick={handleExportPresetJSON}
            className="bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 hover:border-primary/30 py-2 rounded-md transition flex justify-center items-center gap-1 tap-scale shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
          >
            <Upload className="w-3.5 h-3.5" /> 导出配置
          </button>
        </div>
      </div>
    </Card>
  );
}
