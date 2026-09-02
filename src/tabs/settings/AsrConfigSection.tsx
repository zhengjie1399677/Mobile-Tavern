import { Mic } from "lucide-react";
import { AccordionItem, AccordionTrigger, AccordionContent } from "../../../components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import { Input } from "../../../components/ui/input";
import type { UserSettings } from "../../types";
import { useTranslation } from "../../contexts/LanguageContext";

export interface AsrConfigSectionProps {
  settings: UserSettings;
  updateSettings: (updater: (prev: UserSettings) => UserSettings) => void;
}

export default function AsrConfigSection({ settings, updateSettings }: AsrConfigSectionProps) {
  const { t } = useTranslation();
  const asrConfig = settings.asrConfig || {
    enabled: false,
    provider: "web-speech",
    language: "zh-CN",
    openaiApiKey: "",
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiModel: "whisper-1",
  };

  const updateAsr = (fields: Partial<typeof asrConfig>) => {
    updateSettings((prev) => ({
      ...prev,
      asrConfig: {
        ...(prev.asrConfig || asrConfig),
        ...fields,
      },
    }));
  };

  return (
    <AccordionItem value="asr-api-config" className="settings-connection-item overflow-hidden">
      <AccordionTrigger className="settings-panel-trigger px-3 py-2 hover:no-underline hover:bg-muted/30 transition">
        <div className="flex items-center justify-between w-full pr-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="settings-panel-icon"><Mic className="w-4 h-4 text-primary" /></span>
            <div className="flex flex-col items-start gap-0.5 min-w-0">
              <span className="text-xs sm:text-[13px] font-semibold text-foreground">{t("asr.title")}</span>
              <span className="text-[10.5px] text-muted-foreground/75 font-normal truncate max-w-[200px] sm:max-w-none">
                {t("asr.subtitle")}
              </span>
            </div>
          </div>
          <span className={`shrink-0 items-center rounded-md px-1.5 py-0.5 text-[9px] font-semibold font-mono ${
            asrConfig.enabled
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
              : "bg-muted/40 text-muted-foreground border border-border/40"
          }`}>
            {asrConfig.enabled ? "已启用" : "未启用"}
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="p-3 pt-1 border-t border-border/50 space-y-3">
        {/* Enable Switch */}
        <div className="flex items-center justify-between pb-3 border-b border-border/40">
          <div className="space-y-0.5">
            <label className="text-[13px] font-semibold text-foreground">{t("asr.enable")}</label>
            <p className="text-[10px] text-muted-foreground max-w-[450px]">
              {t("asr.enable_desc")}
            </p>
          </div>
          <Switch
            aria-label={t("asr.enable")}
            checked={asrConfig.enabled}
            onCheckedChange={(checked) => updateAsr({ enabled: checked })}
            className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
          />
        </div>

        {asrConfig.enabled && (
          <div className="space-y-3 animate-in fade-in duration-300">
            {/* Provider Selection */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground block">
                {t("asr.engine")}
              </label>
              <Select
                value={asrConfig.provider}
                onValueChange={(val: "web-speech" | "openai") => updateAsr({ provider: val })}
              >
                <SelectTrigger aria-label={t("asr.engine")} className="w-full h-8.5 text-xs bg-background/80 border-border/70 rounded-xl shadow-2xs font-medium">
                  <SelectValue placeholder="Select Provider" />
                </SelectTrigger>
                <SelectContent className="bg-popover text-popover-foreground border border-border shadow-lg">
                  <SelectItem value="web-speech" className="text-xs">
                    {t("asr.engine_system")}
                  </SelectItem>
                  <SelectItem value="openai" className="text-xs">
                    {t("asr.engine_whisper")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Language Field */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground">{t("asr.lang")}</label>
              <Input
                type="text"
                className="font-mono text-xs h-8.5 rounded-xl bg-background/80 border-border/70 shadow-2xs"
                value={asrConfig.language}
                onChange={(e) => updateAsr({ language: e.target.value })}
                placeholder={t("asr.lang_placeholder")}
              />
              <p className="text-[9px] text-muted-foreground/70">
                {t("asr.lang_desc")}
              </p>
            </div>

            {/* Whisper specific config */}
            {asrConfig.provider === "openai" && (
              <div className="space-y-3 border-t border-border/20 pt-2.5 animate-in fade-in duration-300">
                {/* Whisper API Key */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground">API Key</label>
                  <Input
                    type="password"
                    className="font-mono text-xs h-8.5 rounded-xl bg-background/80 border-border/70 shadow-2xs"
                    spellCheck={false}
                    value={asrConfig.openaiApiKey || ""}
                    onChange={(e) => updateAsr({ openaiApiKey: e.target.value })}
                    placeholder="sk-..."
                  />
                </div>

                {/* Whisper Base URL */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground">Base URL</label>
                  <Input
                    type="text"
                    className="font-mono text-xs h-8.5 rounded-xl bg-background/80 border-border/70 shadow-2xs"
                    spellCheck={false}
                    value={asrConfig.openaiBaseUrl || ""}
                    onChange={(e) => updateAsr({ openaiBaseUrl: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                  />
                </div>

                {/* Whisper Model Name */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground">{t("image_gen.model")}</label>
                  <Input
                    type="text"
                    className="font-mono text-xs h-8.5 rounded-xl bg-background/80 border-border/70 shadow-2xs"
                    spellCheck={false}
                    value={asrConfig.openaiModel || ""}
                    onChange={(e) => updateAsr({ openaiModel: e.target.value })}
                    placeholder="whisper-1"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
