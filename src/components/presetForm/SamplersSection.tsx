import { Sliders, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../../components/ui/card";
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
  return (
    <Card className={cn("glass-panel shadow-sm transition-all duration-300", isSamplersFolded ? "py-1.5 gap-0" : "")}>
      <CardHeader
        className={cn("cursor-pointer hover:bg-muted/20 transition select-none py-2.5 px-3", isSamplersFolded ? "pb-0 border-b-0" : "pb-2 border-b border-border/30")}
        onClick={handleToggleSamplersFold}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs flex items-center gap-2 shrink-0 font-bold text-foreground">
            <Sliders className="w-4 h-4 text-primary" /> 温度与采样参数
          </CardTitle>
          <div className="flex items-center gap-2 overflow-hidden">
            {isSamplersFolded && (
              <span className="text-[10px] text-muted-foreground/80 font-mono bg-muted/40 px-1.5 py-0.5 rounded border border-border/30 truncate max-w-[150px] sm:max-w-none">
                T: {settings.preset.temperature} | P: {settings.preset.topP} | Max: {settings.preset.maxTokens}
              </span>
            )}
            {isSamplersFolded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
          </div>
        </div>
        {!isSamplersFolded && (
          <CardDescription className="text-[10px] mt-0.5">
            调节模型生成时的随机性、惩罚与最大长度等采样参数
          </CardDescription>
        )}
      </CardHeader>
      {!isSamplersFolded && (
        <CardContent className="pt-3 px-3 pb-3 space-y-3.5 overflow-hidden w-full">
          <div className="space-y-3 text-xs w-full overflow-hidden">
            <div className="space-y-1.5 w-full">
              <div className="flex justify-between items-center text-muted-foreground w-full">
                <span className="font-semibold text-[11px]">温度 (Temp)</span>
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
                <span className="font-semibold text-[11px]">核采样 (Top P)</span>
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
                  重复惩罚 (Rep Penalty)
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
                  长度上限 (Max Tokens)
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
