import React from "react";
import { Popover } from "@base-ui/react/popover";
import {
  SlidersHorizontal,
  Check,
  X,
  Search,
  Sparkles,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { useMobileBackHandler } from "../../../hooks/useMobileBackHandler";
import { useTranslation } from "../../../contexts/LanguageContext";
import { useUnifiedApp } from "../../../UnifiedAppContext";
import { resolveActivePresetBundle } from "../../../application/useCases/presetBundleLifecycle";
import { isSameSourcePromptBlock } from "../../../domain/prompts/promptSourceBlocks";
import { Switch } from "@/src/components/ui/switch";
import { cn } from "@/src/lib/utils";

interface PresetQuickPopoverProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly disabled?: boolean;
}

interface QuickPromptItem {
  id: string;
  name: string;
  role: "system" | "user" | "assistant";
  enabled: boolean;
  type: "main" | "jailbreak" | "custom";
}

export function PresetQuickPopover({
  open,
  onOpenChange,
  disabled = false,
}: PresetQuickPopoverProps): React.JSX.Element {
  const { t } = useTranslation();
  const {
    settings,
    updateSettings,
    handleLoadPresetBundle,
    handleToggleCustomPrompt,
  } = useUnifiedApp((state) => ({
    settings: state.settings,
    updateSettings: state.updateSettings,
    handleLoadPresetBundle: state.handleLoadPresetBundle,
    handleToggleCustomPrompt: state.handleToggleCustomPrompt,
  }));

  const [searchQuery, setSearchQuery] = React.useState("");

  useMobileBackHandler(open, () => {
    onOpenChange(false);
    return true;
  }, 870);

  const activeBundle = React.useMemo(
    () => resolveActivePresetBundle(settings.savedPresets, settings.preset),
    [settings.savedPresets, settings.preset],
  );

  const rawActiveName = activeBundle?.sampler.name || settings.preset?.name || "";
  // 严格遵守：只叫预设，不叫基本预设
  const activeDisplayName =
    !rawActiveName || rawActiveName === "基本预设" || rawActiveName === "Default"
      ? (t("quick_actions.preset_btn") || "预设")
      : rawActiveName;

  const handleSwitchPreset = async (bundleId: string) => {
    await handleLoadPresetBundle(bundleId);
  };

  // 整理当前预设下的提示词条目（与设置中的 PromptsConfigSection 严格保持同源）
  const promptItems = React.useMemo<QuickPromptItem[]>(() => {
    const list: QuickPromptItem[] = [];
    const cfg = settings.promptConfig;
    if (!cfg) return list;

    // 1. 系统提示词
    const hasMainContent = Boolean(cfg.mainPrompt && cfg.mainPrompt.trim().length > 0);
    if (cfg.useMainPrompt === true || (cfg.useMainPrompt !== false && hasMainContent)) {
      list.push({
        id: "built-in-main-prompt",
        name: cfg.mainPromptName?.trim() || t("prompts.system_prompt") || "系统提示词",
        role: "system",
        enabled: cfg.useMainPrompt ?? hasMainContent,
        type: "main",
      });
    }

    // 2. 规则提示词
    const hasJailbreakContent = Boolean(cfg.jailbreakPrompt && cfg.jailbreakPrompt.trim().length > 0);
    if (cfg.useJailbreak === true || (cfg.useJailbreak !== false && hasJailbreakContent)) {
      list.push({
        id: "built-in-jailbreak-prompt",
        name: cfg.jailbreakPromptName?.trim() || t("prompts.jailbreak") || "规则提示词",
        role: "system",
        enabled: cfg.useJailbreak ?? hasJailbreakContent,
        type: "jailbreak",
      });
    }

    // 3. 自定义提示词模块（过滤 marker 占位符锚点和同源系统项）
    const customs = cfg.customPrompts || [];
    for (let i = 0; i < customs.length; i++) {
      const c = customs[i];
      if (c.marker) continue;
      if (
        isSameSourcePromptBlock(c, "main", cfg.mainPrompt) ||
        isSameSourcePromptBlock(c, "jailbreak", cfg.jailbreakPrompt)
      ) {
        continue;
      }
      list.push({
        id: c.id || c.identifier || `prompt_${i + 1}`,
        name: c.name || `模组 ${i + 1}`,
        role: c.role || "system",
        enabled: Boolean(c.enabled),
        type: "custom",
      });
    }

    return list;
  }, [settings.promptConfig, t]);

  const filteredPrompts = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return promptItems;
    return promptItems.filter((p) => p.name.toLowerCase().includes(q));
  }, [promptItems, searchQuery]);

  const activeCount = promptItems.filter((p) => p.enabled).length;

  const handleToggle = (item: QuickPromptItem, checked: boolean) => {
    if (item.type === "main") {
      updateSettings((prev) => ({
        ...prev,
        promptConfig: {
          ...prev.promptConfig,
          useMainPrompt: checked,
        },
      }));
      return;
    }
    if (item.type === "jailbreak") {
      updateSettings((prev) => ({
        ...prev,
        promptConfig: {
          ...prev.promptConfig,
          useJailbreak: checked,
        },
      }));
      return;
    }
    handleToggleCustomPrompt(item.id, checked);
  };

  const handleToggleAll = (targetState: boolean) => {
    updateSettings((prev) => {
      const customs = (prev.promptConfig.customPrompts || []).map((p) =>
        p.marker ? p : { ...p, enabled: targetState },
      );
      return {
        ...prev,
        promptConfig: {
          ...prev.promptConfig,
          useMainPrompt: targetState,
          useJailbreak: targetState,
          customPrompts: customs,
        },
      };
    });
  };

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        aria-label={t("quick_actions.preset_title") || "预设"}
        title={t("quick_actions.preset_title") || "预设"}
        disabled={disabled}
        className={`flex h-8 flex-1 min-w-0 items-center justify-center gap-1.5 rounded-lg px-1.5 transition-colors disabled:opacity-40 ${
          open
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:bg-muted/60 hover:text-primary"
        }`}
      >
        <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate text-xs font-medium">
          {activeDisplayName}
        </span>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={10}
          className="z-[1300]"
        >
          <Popover.Popup
            className="flex max-h-[76vh] w-[330px] max-w-[94vw] flex-col overflow-hidden rounded-2xl border border-border/80 bg-popover text-popover-foreground shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
          >
            {/* 顶部标题区 */}
            <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-3.5 py-2.5 select-none">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                <span className="text-xs font-bold text-foreground">
                  {t("quick_actions.preset_title") || "预设"}
                </span>
                <span className="rounded-full bg-primary/10 px-1.5 py-0.2 text-[10px] font-semibold text-primary border border-primary/20">
                  {activeCount} / {promptItems.length} 已开
                </span>
              </div>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => onOpenChange(false)}
                className="flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground active:scale-95"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* 预设方案横向切换区（根据选择的预设去换） */}
            {Array.isArray(settings.savedPresets) && settings.savedPresets.length > 0 && (
              <div className="border-b border-border/50 bg-background/40 px-3 py-2 space-y-1">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground font-medium">
                  <span>预设方案</span>
                  <span className="text-[10px] text-primary">{activeDisplayName}</span>
                </div>
                <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar">
                  {settings.savedPresets.map((bundle) => {
                    const isCurrent = bundle.id === activeBundle?.id;
                    const bundleName =
                      bundle.sampler.name === "基本预设" ? "默认预设" : (bundle.sampler.name || bundle.id);
                    return (
                      <button
                        key={bundle.id}
                        type="button"
                        onClick={() => void handleSwitchPreset(bundle.id)}
                        className={`flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                          isCurrent
                            ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                            : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        {isCurrent && <Check className="h-3 w-3" />}
                        <span className="truncate max-w-[120px]">{bundleName}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 提示词模块搜索区 */}
            {promptItems.length > 5 && (
              <div className="p-2.5 pb-0">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索提示词名称..."
                    className="w-full rounded-lg border border-border/60 bg-background/60 py-1 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 提示词模块列表区（只能开关） */}
            <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5 max-h-[46vh]">
              {filteredPrompts.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-6 text-center text-xs text-muted-foreground">
                  <Sparkles className="mb-1 h-4 w-4 opacity-40 text-primary" />
                  <span>{searchQuery ? "未找到匹配的提示词模块" : "暂无可配置的预设提示词模块"}</span>
                </div>
              ) : (
                filteredPrompts.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between gap-2.5 rounded-xl border p-2 transition-colors ${
                      p.enabled
                        ? "border-primary/30 bg-primary/5"
                        : "border-border/50 bg-background/40 opacity-75"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {/* 角色类型徽章 */}
                      <span
                        className={cn(
                          "px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase shrink-0 border",
                          p.role === "system"
                            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                            : p.role === "user"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                              : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                        )}
                      >
                        {p.role}
                      </span>
                      <span className="truncate text-xs font-medium text-foreground select-none">
                        {p.name}
                      </span>
                    </div>

                    <div className="shrink-0">
                      <Switch
                        size="sm"
                        aria-label={p.name}
                        checked={p.enabled}
                        onCheckedChange={(checked) => handleToggle(p, checked)}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* 底部快捷控制栏 */}
            <div className="flex items-center justify-between border-t border-border/60 bg-muted/30 px-3 py-2 text-xs">
              <span className="text-[11px] text-muted-foreground font-mono">
                {activeCount} 个模块生效中
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleToggleAll(false)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground active:scale-95"
                >
                  <ToggleLeft className="h-3 w-3" />
                  <span>全关</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleAll(true)}
                  className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 active:scale-95"
                >
                  <ToggleRight className="h-3 w-3" />
                  <span>全开</span>
                </button>
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

