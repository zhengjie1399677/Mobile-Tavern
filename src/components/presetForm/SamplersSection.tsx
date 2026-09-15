import { Sliders, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../../components/ui/card";
import { useTranslation } from "../../contexts/LanguageContext";
import { cn } from "../../../lib/utils";
import type { UserSettings } from "../../types";

interface SamplersSectionProps {
  settings: UserSettings;
  updateSettings: (newSet: UserSettings | ((prev: UserSettings) => UserSettings)) => void;
  isSamplersFolded: boolean;
  handleToggleSamplersFold: () => void;
}

/** 2. 温度与采样参数 */
export default function SamplersSection({
  settings,
  updateSettings,
  isSamplersFolded,
  handleToggleSamplersFold,
}: SamplersSectionProps) {
  const { t } = useTranslation();
  return (
    <Card className={cn("glass-panel shadow-sm transition-all duration-300 rounded-2xl border border-border/60 bg-card/60 backdrop-blur-xs overflow-hidden", isSamplersFolded ? "gap-0" : "")}>
      <CardHeader
        className={cn("cursor-pointer hover:bg-muted/20 transition select-none py-2.5 px-3.5", isSamplersFolded ? "border-b-0" : "border-b border-border/30")}
        onClick={handleToggleSamplersFold}
      >
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-7.5 h-7.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
              <Sliders className="w-4 h-4" />
            </span>
            <div className="flex flex-col items-start min-w-0">
              <span className="text-xs sm:text-[13px] font-semibold text-foreground shrink-0">
                {t("samplers.title")}
              </span>
              {!isSamplersFolded && (
                <span className="text-[10px] text-muted-foreground/75 font-normal truncate max-w-[140px] sm:max-w-none">
                  {t("samplers.subtitle")}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 overflow-hidden">
            {isSamplersFolded && (
              <span className="text-[10px] text-amber-400 font-mono bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20 truncate max-w-[130px] sm:max-w-none">
                T: {settings.preset.temperature} | P: {settings.preset.topP}
              </span>
            )}
            {isSamplersFolded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
          </div>
        </div>
      </CardHeader>
      {!isSamplersFolded && (
        <CardContent className="pt-3 px-3 pb-3 space-y-3.5 overflow-hidden w-full">
          <div className="space-y-3 text-xs w-full overflow-hidden">
            <div className="space-y-1.5 w-full">
              <div className="flex justify-between items-center text-muted-foreground w-full">
                <span className="font-semibold text-[11px]">{t("samplers.temp")}</span>
                <span className="font-mono w-12 text-right">
                  {settings.preset.temperature}
                </span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.5"
                step="0.05"
                value={settings.preset.temperature}
                onChange={(e) =>
                  updateSettings({
                    ...settings,
                    preset: {
                      ...settings.preset,
                      id: "custom",
                      temperature: parseFloat(e.target.value),
                    },
                  })
                }
                className="w-full accent-primary h-1 bg-border rounded-lg appearance-none cursor-pointer"
              />
            </div>
            <div className="space-y-1.5 w-full">
              <div className="flex justify-between items-center text-muted-foreground w-full">
                <span className="font-semibold text-[11px]">{t("samplers.top_p")}</span>
                <span className="font-mono w-12 text-right">
                  {settings.preset.topP}
                </span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={settings.preset.topP}
                onChange={(e) =>
                  updateSettings({
                    ...settings,
                    preset: {
                      ...settings.preset,
                      id: "custom",
                      topP: parseFloat(e.target.value),
                    },
                  })
                }
                className="w-full accent-primary h-1 bg-border rounded-lg appearance-none cursor-pointer"
              />
            </div>
            <div className="space-y-1.5 w-full">
              <div className="flex justify-between items-center text-muted-foreground w-full">
                <span className="font-semibold text-[11px]">
                  {t("samplers.rep_penalty")}
                </span>
                <span className="font-mono w-12 text-right">
                  {settings.preset.repetitionPenalty}
                </span>
              </div>
              <input
                type="range"
                min="1.0"
                max="1.3"
                step="0.01"
                value={settings.preset.repetitionPenalty}
                onChange={(e) =>
                  updateSettings({
                    ...settings,
                    preset: {
                      ...settings.preset,
                      id: "custom",
                      repetitionPenalty: parseFloat(e.target.value),
                    },
                  })
                }
                className="w-full accent-primary h-1 bg-border rounded-lg appearance-none cursor-pointer"
              />
            </div>
            <div className="space-y-1.5 w-full">
              <div className="flex justify-between items-center text-muted-foreground w-full">
                <span className="font-semibold text-[11px]">
                  {t("samplers.max_tokens")}
                </span>
                <span className="font-mono w-16 text-right">
                  {settings.preset.maxTokens}
                </span>
              </div>
              <input
                type="range"
                min="100"
                max="150000"
                step="1000"
                value={settings.preset.maxTokens}
                onChange={(e) =>
                  updateSettings({
                    ...settings,
                    preset: {
                      ...settings.preset,
                      id: "custom",
                      maxTokens: parseInt(e.target.value),
                    },
                  })
                }
                className="w-full accent-primary h-1 bg-border rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
