import React from "react";
import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { useTranslation } from "../../contexts/LanguageContext";
import type { PromptConfig, UserSettings } from "../../types";

interface CompatibilityPromptOptionsProps {
  settings: UserSettings;
  updateSettings: (newSet: UserSettings | ((prev: UserSettings) => UserSettings)) => void;
}

type OptionalPromptTextField =
  | "scenarioFormat"
  | "personalityFormat"
  | "worldInfoFormat";

const TEXT_FIELDS: ReadonlyArray<{ field: OptionalPromptTextField; labelKey: string; placeholder: string }> = [
  { field: "scenarioFormat", labelKey: "compat_options.scenario_format", placeholder: "{{scenario}}" },
  { field: "personalityFormat", labelKey: "compat_options.personality_format", placeholder: "{{personality}}" },
  { field: "worldInfoFormat", labelKey: "compat_options.world_info_format", placeholder: "{0}" },
];

const NAMES_BEHAVIORS = [
  { value: "", labelKey: "compat_options.names_inherit" },
  { value: "-1", labelKey: "compat_options.names_none" },
  { value: "0", labelKey: "compat_options.names_default" },
  { value: "1", labelKey: "compat_options.names_completion" },
  { value: "2", labelKey: "compat_options.names_content" },
] as const;

const POST_PROCESSING = [
  { value: "", labelKey: "compat_options.post_inherit" },
  { value: "merge", label: "merge" },
  { value: "claude", label: "claude" },
  { value: "merge_tools", label: "merge_tools" },
  { value: "semi", label: "semi" },
  { value: "semi_tools", label: "semi_tools" },
  { value: "strict", label: "strict" },
  { value: "strict_tools", label: "strict_tools" },
  { value: "single", label: "single" },
] as const;

/**
 * SillyTavern 预设兼容参数。
 *
 * 这些字段会真实改变请求内容，因此必须可查看、可编辑、可清空；导入时由预设写入，
 * 清空后回到本应用的运行时默认，不再继承上一个预设。
 */
export function CompatibilityPromptOptions({
  settings,
  updateSettings,
}: CompatibilityPromptOptionsProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = React.useState(false);
  const promptConfig = settings.promptConfig;

  const updatePromptConfig = (updater: (config: PromptConfig) => PromptConfig) => {
    updateSettings((prev) => ({
      ...prev,
      promptConfig: updater(prev.promptConfig),
    }));
  };

  const setTextField = (field: OptionalPromptTextField, raw: string) => {
    updatePromptConfig((config) => {
      const next = { ...config };
      if (raw.trim()) next[field] = raw;
      else delete next[field];
      return next;
    });
  };

  const setNamesBehavior = (raw: string) => {
    updatePromptConfig((config) => {
      const next = { ...config };
      if (raw === "") delete next.namesBehavior;
      else next.namesBehavior = Number(raw) as NonNullable<PromptConfig["namesBehavior"]>;
      return next;
    });
  };

  const setPostProcessing = (raw: string) => {
    updatePromptConfig((config) => {
      if (!config.requestShaping) {
        return raw ? { ...config, requestShaping: { enabled: true, customPromptPostProcessing: raw } } : config;
      }
      const shaping = { ...config.requestShaping };
      if (raw) {
        shaping.customPromptPostProcessing = raw;
        // 后处理只在 requestShaping.enabled 时生效；界面选中模式必须同时打开通道。
        shaping.enabled = true;
        // ST 的这些模式都会先合并相邻同角色消息。
        shaping.mergeAdjacentMessages = true;
      } else {
        delete shaping.customPromptPostProcessing;
      }
      return { ...config, requestShaping: shaping };
    });
  };

  const resetAll = () => {
    updatePromptConfig((config) => {
      const next = { ...config };
      delete next.namesBehavior;
      delete next.scenarioFormat;
      delete next.personalityFormat;
      delete next.worldInfoFormat;
      if (next.requestShaping) {
        const shaping = { ...next.requestShaping };
        delete shaping.customPromptPostProcessing;
        next.requestShaping = shaping;
      }
      return next;
    });
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/60 shadow-sm backdrop-blur-xs">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/20"
        aria-expanded={isOpen}
      >
        <span className="flex flex-col items-start">
          <span className="text-xs font-semibold text-foreground sm:text-[13px]">
            {t("compat_options.title")}
          </span>
          <span className="text-[10px] text-muted-foreground/75">
            {t("compat_options.subtitle")}
          </span>
        </span>
        {isOpen
          ? <ChevronUp className="size-4 shrink-0 text-muted-foreground" />
          : <ChevronDown className="size-4 shrink-0 text-muted-foreground" />}
      </button>

      {isOpen && (
        <div className="space-y-3 border-t border-border/30 px-3.5 pb-3.5 pt-3">
          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-medium text-muted-foreground">
                {t("compat_options.names_behavior")}
              </span>
              <select
                value={promptConfig.namesBehavior === undefined ? "" : String(promptConfig.namesBehavior)}
                onChange={(event) => setNamesBehavior(event.target.value)}
                className="h-8 w-full rounded-lg border border-border/70 bg-background/80 px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
              >
                {NAMES_BEHAVIORS.map((option) => (
                  <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-medium text-muted-foreground">
                {t("compat_options.post_processing")}
              </span>
              <select
                value={promptConfig.requestShaping?.customPromptPostProcessing ?? ""}
                onChange={(event) => setPostProcessing(event.target.value)}
                className="h-8 w-full rounded-lg border border-border/70 bg-background/80 px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
              >
                {POST_PROCESSING.map((option) => (
                  <option key={option.value} value={option.value}>
                    {"labelKey" in option ? t(option.labelKey) : option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {TEXT_FIELDS.map((spec) => (
            <label key={spec.field} className="flex flex-col gap-1">
              <span className="text-[10.5px] font-medium text-muted-foreground">
                {t(spec.labelKey)}
              </span>
              <input
                type="text"
                value={promptConfig[spec.field] ?? ""}
                placeholder={spec.placeholder}
                onChange={(event) => setTextField(spec.field, event.target.value)}
                className="h-8 w-full rounded-lg border border-border/70 bg-background/80 px-2 font-mono text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
              />
            </label>
          ))}

          <button
            type="button"
            onClick={resetAll}
            className="inline-flex items-center gap-1 rounded-md border border-border/40 px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-muted/50 hover:text-foreground active:scale-95"
          >
            <RotateCcw className="size-3 text-amber-400" />
            <span>{t("compat_options.reset")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
