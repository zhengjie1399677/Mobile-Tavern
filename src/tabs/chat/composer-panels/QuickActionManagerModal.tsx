import React from "react";
import {
  SlidersHorizontal,
  RefreshCw,
  Play,
  Cpu,
  Plug,
  Wrench,
  Sliders,
  RotateCcw,
  X,
  Check,
} from "lucide-react";
import { Switch } from "@/src/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { useMobileBackHandler } from "../../../hooks/useMobileBackHandler";
import { useTranslation } from "../../../contexts/LanguageContext";
import {
  DEFAULT_QUICK_ACTION_MODULES,
  MAX_ACTIVE_QUICK_ACTIONS,
  type QuickActionModuleId,
  type QuickActionModulesConfig,
} from "./quickActionTypes";

export interface QuickActionManagerModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly quickActionsVisible: boolean;
  readonly onToggleQuickActionsVisible: (visible: boolean) => void;
  readonly modulesConfig: QuickActionModulesConfig;
  readonly onUpdateModulesConfig: (next: QuickActionModulesConfig) => void;
}

interface ModuleItemDef {
  readonly id: QuickActionModuleId;
  readonly titleKey: string;
  readonly defaultTitle: string;
  readonly descKey: string;
  readonly defaultDesc: string;
  readonly icon: React.ComponentType<{ className?: string }>;
  readonly accentColor: string;
}

const MODULE_DEFINITIONS: readonly ModuleItemDef[] = [
  {
    id: "reroll",
    titleKey: "quick_actions.reroll_title",
    defaultTitle: "重新生成回复 (重发)",
    descKey: "quick_actions.reroll_desc",
    defaultDesc: "消除最后一条 AI 回复并重新生成故事分支。",
    icon: RefreshCw,
    accentColor: "text-blue-400 bg-blue-500/15 border-blue-500/30",
  },
  {
    id: "continue",
    titleKey: "quick_actions.continue_title",
    defaultTitle: "继续推进剧情",
    descKey: "quick_actions.continue_desc",
    defaultDesc: "快捷发送指令，引导 AI 沿当前剧情线继续往下推进发展。",
    icon: Play,
    accentColor: "text-emerald-400 bg-emerald-500/15 border-emerald-500/30",
  },
  {
    id: "preset",
    titleKey: "quick_actions.preset_title",
    defaultTitle: "预设调控 (Preset)",
    descKey: "quick_actions.preset_desc",
    defaultDesc: "快速切换预设方案，并在聊天中即时开关各项预设提示词模块（文风、视角、细节强化等）。",
    icon: Sliders,
    accentColor: "text-amber-400 bg-amber-500/15 border-amber-500/30",
  },
  {
    id: "token_predict",
    titleKey: "quick_actions.token_predict_title",
    defaultTitle: "Token 实时预估",
    descKey: "quick_actions.token_predict_desc",
    defaultDesc: "在快捷栏右侧实时显示当前输入与上下文预计消耗的 Token 数量。",
    icon: Cpu,
    accentColor: "text-indigo-400 bg-indigo-500/15 border-indigo-500/30",
  },
  {
    id: "tool",
    titleKey: "quick_actions.tool_title",
    defaultTitle: "工具插件 (Tool)",
    descKey: "quick_actions.tool_desc",
    defaultDesc: "快捷唤起 DeepSeek 网页搜索、网页抓取、掷骰子、随机抽取等插件工具。",
    icon: Wrench,
    accentColor: "text-teal-400 bg-teal-500/15 border-teal-500/30",
  },
  {
    id: "mcp",
    titleKey: "quick_actions.mcp_title",
    defaultTitle: "外部能力 (MCP)",
    descKey: "quick_actions.mcp_desc",
    defaultDesc: "快捷唤起 MCP 外部服务与能力面板，支持随时手动触发外部工具并提取资料。",
    icon: Plug,
    accentColor: "text-purple-400 bg-purple-500/15 border-purple-500/30",
  },
] as const;

export function QuickActionManagerModal({
  open,
  onClose,
  quickActionsVisible,
  onToggleQuickActionsVisible,
  modulesConfig,
  onUpdateModulesConfig,
}: QuickActionManagerModalProps): React.JSX.Element {
  const { t } = useTranslation();

  useMobileBackHandler(open, () => {
    onClose();
    return true;
  }, 860);

  const [draftConfig, setDraftConfig] = React.useState<QuickActionModulesConfig>(() => ({
    ...modulesConfig,
  }));
  const [draftVisible, setDraftVisible] = React.useState<boolean>(quickActionsVisible);

  React.useEffect(() => {
    if (open) {
      setDraftConfig({ ...modulesConfig });
      setDraftVisible(quickActionsVisible);
    }
  }, [open, modulesConfig, quickActionsVisible]);

  const activeCount = Object.values(draftConfig).filter(Boolean).length;
  const isMaxReached = activeCount >= MAX_ACTIVE_QUICK_ACTIONS;

  const handleToggleModule = (id: QuickActionModuleId, checked: boolean) => {
    if (checked && isMaxReached) {
      return;
    }
    setDraftConfig((prev) => {
      const next = { ...prev, [id]: checked };
      onUpdateModulesConfig(next);
      return next;
    });
  };

  const handleToggleVisible = (checked: boolean) => {
    setDraftVisible(checked);
    onToggleQuickActionsVisible(checked);
  };

  const handleReset = () => {
    setDraftConfig({ ...DEFAULT_QUICK_ACTION_MODULES });
    onUpdateModulesConfig({ ...DEFAULT_QUICK_ACTION_MODULES });
    setDraftVisible(true);
    onToggleQuickActionsVisible(true);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/60 backdrop-blur-sm"
        className="flex w-full max-w-md max-h-[88vh] flex-col gap-0 overflow-hidden rounded-2xl border border-border bg-card p-0 shadow-2xl animate-in fade-in duration-200"
      >
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between border-b border-border/80 bg-muted/40 px-4 py-3 select-none">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/20">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-sm font-bold text-foreground">
                {t("quick_actions.manager_title") || "快捷栏管理"}
              </DialogTitle>
              <p className="text-[11px] text-muted-foreground">
                {t("quick_actions.manager_subtitle") || "最多开启 4 个快捷模块，自由定制与开关"}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 主体滚动区 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 总开关卡片 */}
          <div className="flex items-center justify-between rounded-xl border border-border/70 bg-background/60 p-3 shadow-xs">
            <div className="space-y-0.5 pr-2">
              <div className="text-xs font-semibold text-foreground">
                {t("quick_actions.enable_bar") || "启用输入框快捷栏"}
              </div>
              <div className="text-[11px] text-muted-foreground leading-relaxed">
                {t("quick_actions.enable_bar_desc") || "关闭后快捷栏将在聊天输入框上方整体收起。"}
              </div>
            </div>
            <Switch
              checked={draftVisible}
              onCheckedChange={handleToggleVisible}
              aria-label="启用输入框快捷栏"
            />
          </div>

          {/* 模块列表头部 */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold text-muted-foreground">
              {t("quick_actions.modules_heading") || "功能模块"}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              isMaxReached ? "bg-amber-500/15 text-amber-400" : "bg-primary/10 text-primary"
            }`}>
              {activeCount} / 4 {t("quick_actions.enabled_label") || "已开启"}
            </span>
          </div>

          {isMaxReached && (
            <p className="px-1 text-[11px] text-amber-500/90 font-medium">
              {t("quick_actions.max_limit_reached") || "最多同时开启 4 个快捷功能，请先关闭其他功能后再开启"}
            </p>
          )}

          {/* 6 个模块开关卡片 */}
          <div className="space-y-2">
            {MODULE_DEFINITIONS.map((mod) => {
              const Icon = mod.icon;
              const isChecked = Boolean(draftConfig[mod.id]);
              const isDisabled = !isChecked && isMaxReached;

              return (
                <div
                  key={mod.id}
                  className={`flex items-start justify-between gap-3 rounded-xl border p-3 transition-colors ${
                    isChecked
                      ? "border-primary/30 bg-primary/5"
                      : isDisabled
                        ? "border-border/40 bg-background/20 opacity-50 cursor-not-allowed"
                        : "border-border/60 bg-background/40 opacity-75"
                  }`}
                >
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${mod.accentColor}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <div className="text-xs font-semibold text-foreground truncate">
                        {t(mod.titleKey) || mod.defaultTitle}
                      </div>
                      <div className="text-[11px] text-muted-foreground leading-normal line-clamp-2">
                        {t(mod.descKey) || mod.defaultDesc}
                      </div>
                    </div>
                  </div>
                  <div className="pt-0.5 shrink-0">
                    <Switch
                      checked={isChecked}
                      disabled={isDisabled}
                      onCheckedChange={(checked) => handleToggleModule(mod.id, checked)}
                      aria-label={t(mod.titleKey) || mod.defaultTitle}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between border-t border-border/80 bg-muted/30 px-4 py-3">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 rounded-lg border border-border/80 bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>{t("quick_actions.reset_default") || "恢复默认"}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-xs transition-transform hover:bg-primary/90 active:scale-95"
          >
            <Check className="h-3.5 w-3.5" />
            <span>{t("quick_actions.done") || "完成"}</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
