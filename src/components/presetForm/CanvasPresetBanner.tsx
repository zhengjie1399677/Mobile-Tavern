import { useState } from "react";
import { AlertCircle, Bookmark, Copy, HardDriveDownload, Save, Sparkles, Zap } from "lucide-react";
import type { PresetBundleV2 } from "../../domain/presets/contracts";
import { PromptComposerButton, PromptComposerSelect } from "./PromptComposerControls";

export interface CanvasPresetBannerProps {
  savedPresets?: PresetBundleV2[];
  activeBundleId?: string;
  isActivePresetDirty?: boolean;
  frozenPresetName?: string;
  freeMode: boolean;
  onSetMode: (enabled: boolean) => void;
  onLoadPreset?: (bundleId: string) => Promise<void> | void;
  onSaveCurrentPreset?: () => Promise<void> | void;
  onSaveNewPreset?: () => Promise<void> | void;
  t: (key: string, params?: Record<string, string>) => string;
}

export default function CanvasPresetBanner({
  savedPresets = [],
  activeBundleId,
  isActivePresetDirty = false,
  frozenPresetName,
  freeMode,
  onSetMode,
  onLoadPreset,
  onSaveCurrentPreset,
  onSaveNewPreset,
  t,
}: CanvasPresetBannerProps) {
  const [isSaving, setIsSaving] = useState(false);

  const activePreset = savedPresets.find((b) => b.id === activeBundleId);
  const activePresetName = activePreset?.sampler.name ?? "当前预设";
  const isBuiltin = activePreset?.isBuiltin === true;

  const presetOptions = savedPresets.map((bundle) => ({
    value: bundle.id,
    label: `${bundle.sampler.name}${bundle.isBuiltin ? "（出厂）" : ""}`,
  }));

  const handleSave = async () => {
    if (!onSaveCurrentPreset || isSaving) return;
    setIsSaving(true);
    try {
      await onSaveCurrentPreset();
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAs = async () => {
    if (!onSaveNewPreset || isSaving) return;
    setIsSaving(true);
    try {
      await onSaveNewPreset();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-2xl border border-border/80 bg-muted/30 p-2.5 backdrop-blur-xs shadow-xs">
      {/* 预设信息与操作栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Bookmark className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-xs font-bold text-muted-foreground shrink-0">当前预设:</span>
          {savedPresets.length > 0 && onLoadPreset ? (
            <div className="min-w-0 max-w-[200px] flex-1">
              <PromptComposerSelect
                value={activeBundleId || ""}
                onValueChange={(id) => id && void onLoadPreset(id)}
                options={presetOptions}
                ariaLabel="切换预设"
                className="h-7 text-xs font-bold"
              />
            </div>
          ) : (
            <span className="text-xs font-bold text-foreground truncate">{activePresetName}</span>
          )}

          {isActivePresetDirty && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300 shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
              <span>画布已修改</span>
            </span>
          )}
        </div>

        {/* 保存到预设 / 另存为按钮组 */}
        <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
          {onSaveCurrentPreset && (
            <PromptComposerButton
              type="button"
              disabled={isSaving}
              onClick={handleSave}
              className={`h-7 gap-1 px-2.5 text-xs font-bold shadow-xs ${
                isActivePresetDirty
                  ? "border-primary/40 bg-primary/20 text-primary hover:bg-primary/30 ring-1 ring-primary/30"
                  : "border-border/80 bg-background/80 text-muted-foreground hover:text-foreground"
              }`}
            >
              <Save className="h-3.5 w-3.5" />
              <span>{isBuiltin ? "另存修改" : "保存到预设"}</span>
            </PromptComposerButton>
          )}

          {onSaveNewPreset && (
            <PromptComposerButton
              type="button"
              disabled={isSaving}
              onClick={handleSaveAs}
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-background/80 shadow-none"
            >
              <Copy className="h-3 w-3" />
              <span>另存为副本</span>
            </PromptComposerButton>
          )}
        </div>
      </div>

      {/* 会话冻结提示 */}
      {frozenPresetName && (
        <div className="flex items-center gap-1.5 rounded-xl border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[11px] text-sky-700 dark:text-sky-300">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>当前会话已冻结行为预设「{frozenPresetName}」，此处对预设的修改将在新建会话时生效。</span>
        </div>
      )}

      {/* 传统模式一键升级为工作流画布 */}
      {!freeMode && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <Zap className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <div className="text-xs font-bold text-foreground">传统模式执行中</div>
              <div className="text-[10px] text-muted-foreground leading-tight">
                系统已将传统系统词与破限词映射为工作流节点，开启自由编排可解锁顺序拖拽、深度插入与条件分支。
              </div>
            </div>
          </div>
          <PromptComposerButton
            type="button"
            onClick={() => onSetMode(true)}
            className="h-7.5 shrink-0 gap-1 border-primary/40 bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary/90 shadow-sm"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>升级为自由编排</span>
          </PromptComposerButton>
        </div>
      )}
    </div>
  );
}
