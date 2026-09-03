import { useState } from "react";
import { Volume2, Play, Square } from "lucide-react";
import { useTranslation } from "../../../contexts/LanguageContext";
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "../../../../components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../components/ui/select";
import { Switch } from "../../../../components/ui/switch";
import { Input } from "../../../../components/ui/input";
import type { UnifiedAppContextProps } from "../../../UnifiedAppContext";
import type { ITtsService } from "@/src/application/serviceContracts";

export type TtsConfigSectionProps = Pick<
  UnifiedAppContextProps,
  "settings" | "updateSettings" | "getKernelService"
>;

export default function TtsConfigSection({
  settings,
  updateSettings,
  getKernelService,
}: TtsConfigSectionProps) {
  const { t } = useTranslation();
  const [testSpeaking, setTestSpeaking] = useState(false);

  const handlePlayTest = async () => {
    try {
      setTestSpeaking(true);
      const ttsService = getKernelService<ITtsService>("tts");
      const testText = t("tts.test_text");
      await ttsService.speak(testText, settings.ttsConfig);
    } catch (e: unknown) {
      console.warn("TTS test failed:", e);
    } finally {
      setTestSpeaking(false);
    }
  };

  const handleStopTest = async () => {
    try {
      const ttsService = getKernelService<ITtsService>("tts");
      ttsService.stop();
    } catch (e) {
      console.warn("[TtsConfigSection] Failed to stop TTS test:", e);
    }
    setTestSpeaking(false);
  };

  return (
    <AccordionItem value="tts-config" className="settings-connection-item overflow-hidden">
      <AccordionTrigger className="settings-panel-trigger px-3 py-2 hover:no-underline hover:bg-muted/30 transition">
        <div className="flex items-center justify-between w-full pr-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="settings-panel-icon"><Volume2 className="w-4 h-4 text-primary" /></span>
            <div className="flex flex-col items-start gap-0.5 min-w-0">
              <span className="text-xs sm:text-[13px] font-semibold text-foreground">{t("tts.title")}</span>
              <span className="text-[10.5px] text-muted-foreground/75 font-normal truncate">
                {t("tts.subtitle")}
              </span>
            </div>
          </div>
          <span className={`shrink-0 items-center rounded-md px-1.5 py-0.5 text-[9px] font-semibold font-mono ${
            settings.ttsConfig?.enabled
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
              : "bg-muted/40 text-muted-foreground border border-border/40"
          }`}>
            {settings.ttsConfig?.enabled ? "已启用" : "未启用"}
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="p-3 space-y-3">
        <div className="flex items-center justify-between border-b border-border/30 pb-3">
          <div>
            <div className="text-xs font-semibold text-foreground">{t("tts.enable")}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{t("tts.enable_desc")}</div>
          </div>
          <Switch
            aria-label={t("tts.enable")}
            checked={settings.ttsConfig?.enabled || false}
            onCheckedChange={(checked) => {
              updateSettings((prev) => ({
                ...prev,
                ttsConfig: {
                  ...(prev.ttsConfig || {
                    enabled: false,
                    provider: "speech-synthesis",
                    volume: 0.5,
                    rate: 1.0,
                    pitch: 1.0,
                    voiceName: "",
                    openaiApiKey: "",
                    openaiBaseUrl: "https://api.openai.com/v1",
                    openaiModel: "tts-1",
                    openaiVoice: "alloy",
                  }),
                  enabled: checked,
                },
              }));
            }}
          />
        </div>

        {settings.ttsConfig?.enabled && (
          <div className="space-y-3 animate-in fade-in duration-300">
            {/* Play Mode & Read Mode */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground">{t("tts.trigger")}</label>
                <Select
                  aria-label={t("tts.trigger")}
                  value={settings.ttsConfig?.playMode || "auto"}
                  onValueChange={(val: "auto" | "manual") => {
                    updateSettings((prev) => ({
                      ...prev,
                      ttsConfig: {
                        ...(prev.ttsConfig || {
                          enabled: true,
                          provider: "speech-synthesis",
                          volume: 0.5,
                          rate: 1.0,
                          pitch: 1.0,
                          voiceName: "",
                          openaiApiKey: "",
                          openaiBaseUrl: "https://api.openai.com/v1",
                          openaiModel: "tts-1",
                          openaiVoice: "alloy",
                        }),
                        playMode: val,
                      },
                    }));
                  }}
                >
                  <SelectTrigger aria-label={t("tts.trigger")} className="w-full text-xs h-8.5 rounded-xl text-xs bg-background/80 border-border/70 shadow-2xs font-medium">
                    <SelectValue placeholder={t("tts.trigger")}>
                      {settings.ttsConfig?.playMode === "auto" ? t("tts.trigger_auto") : t("tts.trigger_manual")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto" className="text-xs font-semibold">{t("tts.trigger_auto")}</SelectItem>
                    <SelectItem value="manual" className="text-xs font-semibold">{t("tts.trigger_manual")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground">{t("tts.range")}</label>
                <Select
                  aria-label={t("tts.range")}
                  value={settings.ttsConfig?.readMode || "all"}
                  onValueChange={(val: "all" | "dialogue_only") => {
                    updateSettings((prev) => ({
                      ...prev,
                      ttsConfig: {
                        ...(prev.ttsConfig || {
                          enabled: true,
                          provider: "speech-synthesis",
                          volume: 0.5,
                          rate: 1.0,
                          pitch: 1.0,
                          voiceName: "",
                          openaiApiKey: "",
                          openaiBaseUrl: "https://api.openai.com/v1",
                          openaiModel: "tts-1",
                          openaiVoice: "alloy",
                        }),
                        readMode: val,
                      },
                    }));
                  }}
                >
                  <SelectTrigger className="w-full text-xs h-8.5 rounded-xl text-xs bg-background/80 border-border/70 shadow-2xs font-medium">
                    <SelectValue placeholder={t("tts.range")}>
                      {settings.ttsConfig?.readMode === "dialogue_only" ? t("tts.range_dialogue") : t("tts.range_all")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs font-semibold">{t("tts.range_all")}</SelectItem>
                    <SelectItem value="dialogue_only" className="text-xs font-semibold">{t("tts.range_dialogue")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Provider Selection */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground">{t("tts.engine")}</label>
              <Select
                aria-label={t("tts.engine")}
                value={settings.ttsConfig?.provider || "speech-synthesis"}
                onValueChange={(val: "speech-synthesis" | "openai") => {
                  updateSettings((prev) => ({
                    ...prev,
                    ttsConfig: {
                      ...(prev.ttsConfig || {
                        enabled: true,
                        provider: "speech-synthesis",
                        volume: 0.5,
                        rate: 1.0,
                        pitch: 1.0,
                        voiceName: "",
                        openaiApiKey: "",
                        openaiBaseUrl: "https://api.openai.com/v1",
                        openaiModel: "tts-1",
                        openaiVoice: "alloy",
                      }),
                      provider: val,
                    },
                  }));
                }}
              >
                <SelectTrigger className="w-full text-xs h-8.5 rounded-xl text-xs bg-background/80 border-border/70 shadow-2xs font-medium">
                  <SelectValue placeholder={t("tts.engine")}>
                    {settings.ttsConfig?.provider === "openai" ? t("tts.engine_openai") : t("tts.engine_system")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="speech-synthesis" className="text-xs font-semibold">{t("tts.engine_system")}</SelectItem>
                  <SelectItem value="openai" className="text-xs font-semibold">{t("tts.engine_openai")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Sliders for Volume, Speed, Pitch */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-muted-foreground block">{t("tts.volume")} ({Math.round((settings.ttsConfig?.volume ?? 0.5) * 100)}%)</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={settings.ttsConfig?.volume ?? 0.5}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    updateSettings((prev) => ({
                      ...prev,
                      ttsConfig: {
                        ...(prev.ttsConfig || {
                          enabled: true,
                          provider: "speech-synthesis",
                          volume: 0.5,
                          rate: 1.0,
                          pitch: 1.0,
                          voiceName: "",
                          openaiApiKey: "",
                          openaiBaseUrl: "https://api.openai.com/v1",
                          openaiModel: "tts-1",
                          openaiVoice: "alloy",
                        }),
                        volume: val,
                      },
                    }));
                  }}
                  className="w-full accent-primary h-1 bg-border rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-muted-foreground block">{t("tts.rate")} ({settings.ttsConfig?.rate ?? 1.0}x)</label>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={settings.ttsConfig?.rate ?? 1.0}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    updateSettings((prev) => ({
                      ...prev,
                      ttsConfig: {
                        ...(prev.ttsConfig || {
                          enabled: true,
                          provider: "speech-synthesis",
                          volume: 0.5,
                          rate: 1.0,
                          pitch: 1.0,
                          voiceName: "",
                          openaiApiKey: "",
                          openaiBaseUrl: "https://api.openai.com/v1",
                          openaiModel: "tts-1",
                          openaiVoice: "alloy",
                        }),
                        rate: val,
                      },
                    }));
                  }}
                  className="w-full accent-primary h-1 bg-border rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-muted-foreground block">{t("tts.pitch")} ({settings.ttsConfig?.pitch ?? 1.0})</label>
                <input
                  type="range"
                  min="0.5"
                  max="1.5"
                  step="0.1"
                  value={settings.ttsConfig?.pitch ?? 1.0}
                  disabled={settings.ttsConfig?.provider === "openai"}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    updateSettings((prev) => ({
                      ...prev,
                      ttsConfig: {
                        ...(prev.ttsConfig || {
                          enabled: true,
                          provider: "speech-synthesis",
                          volume: 0.5,
                          rate: 1.0,
                          pitch: 1.0,
                          voiceName: "",
                          openaiApiKey: "",
                          openaiBaseUrl: "https://api.openai.com/v1",
                          openaiModel: "tts-1",
                          openaiVoice: "alloy",
                        }),
                        pitch: val,
                      },
                    }));
                  }}
                  className="w-full accent-primary h-1 bg-border rounded-lg appearance-none cursor-pointer disabled:opacity-40"
                />
              </div>
            </div>

            {/* Provider Specific Settings */}
            {settings.ttsConfig?.provider === "speech-synthesis" ? (
              <div className="p-3 bg-muted/30 border border-border/40 rounded-lg">
                <div className="text-[11px] text-muted-foreground">
                  {t("tts.system_desc")}
                </div>
              </div>
            ) : (
              <div className="space-y-3 p-3 bg-muted/30 border border-border/40 rounded-lg">
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-muted-foreground">OpenAI API Key</label>
                  <Input
                    type="password"
                    value={settings.ttsConfig?.openaiApiKey || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateSettings((prev) => ({
                        ...prev,
                        ttsConfig: {
                          ...(prev.ttsConfig || {
                            enabled: true,
                            provider: "openai",
                            volume: 0.5,
                            rate: 1.0,
                            pitch: 1.0,
                            voiceName: "",
                            openaiApiKey: "",
                            openaiBaseUrl: "https://api.openai.com/v1",
                            openaiModel: "tts-1",
                            openaiVoice: "alloy",
                          }),
                          openaiApiKey: val,
                        },
                      }));
                    }}
                    placeholder="sk-..."
                    className="h-8.5 rounded-xl text-xs bg-background/80 border-border/70 shadow-2xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-muted-foreground">OpenAI Base URL</label>
                  <Input
                    value={settings.ttsConfig?.openaiBaseUrl || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateSettings((prev) => ({
                        ...prev,
                        ttsConfig: {
                          ...(prev.ttsConfig || {
                            enabled: true,
                            provider: "openai",
                            volume: 0.5,
                            rate: 1.0,
                            pitch: 1.0,
                            voiceName: "",
                            openaiApiKey: "",
                            openaiBaseUrl: "https://api.openai.com/v1",
                            openaiModel: "tts-1",
                            openaiVoice: "alloy",
                          }),
                          openaiBaseUrl: val,
                        },
                      }));
                    }}
                    placeholder="https://api.openai.com/v1"
                    className="h-8.5 rounded-xl text-xs bg-background/80 border-border/70 shadow-2xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-muted-foreground block">{t("image_gen.model")}</label>
                    <Input
                      value={settings.ttsConfig?.openaiModel || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateSettings((prev) => ({
                          ...prev,
                          ttsConfig: {
                            ...(prev.ttsConfig || {
                              enabled: true,
                              provider: "openai",
                              volume: 0.5,
                              rate: 1.0,
                              pitch: 1.0,
                              voiceName: "",
                              openaiApiKey: "",
                              openaiBaseUrl: "https://api.openai.com/v1",
                              openaiModel: "tts-1",
                              openaiVoice: "alloy",
                            }),
                            openaiModel: val,
                          },
                        }));
                      }}
                      placeholder="tts-1"
                      className="h-8.5 rounded-xl text-xs bg-background/80 border-border/70 shadow-2xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-muted-foreground block">{t("tts.voice")}</label>
                    <Select
                      aria-label={t("tts.voice")}
                      value={settings.ttsConfig?.openaiVoice || "alloy"}
                      onValueChange={(val) => {
                        updateSettings((prev) => ({
                          ...prev,
                          ttsConfig: {
                            ...(prev.ttsConfig || {
                              enabled: true,
                              provider: "openai",
                              volume: 0.5,
                              rate: 1.0,
                              pitch: 1.0,
                              voiceName: "",
                              openaiApiKey: "",
                              openaiBaseUrl: "https://api.openai.com/v1",
                              openaiModel: "tts-1",
                              openaiVoice: "alloy",
                            }),
                            openaiVoice: val ?? "alloy",
                          },
                        }));
                      }}
                    >
                      <SelectTrigger className="w-full text-xs h-8.5 rounded-xl text-xs bg-background/80 border-border/70 shadow-2xs font-medium">
                        <SelectValue placeholder="alloy" />
                      </SelectTrigger>
                      <SelectContent>
                        {["alloy", "echo", "fable", "onyx", "nova", "shimmer"].map((v) => (
                          <SelectItem key={v} value={v} className="text-xs font-semibold">
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {/* Test TTS Button */}
            <div className="flex gap-2 justify-end pt-2">
              {testSpeaking ? (
                <button
                  type="button"
                  onClick={handleStopTest}
                  className="h-8 px-3 bg-rose-950/20 hover:bg-rose-950/40 border border-rose-900/40 text-red-400 text-xs font-bold rounded-lg transition-all flex items-center gap-1 active:scale-95 cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>{t("tts.test_stop")}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handlePlayTest}
                  className="h-8 px-3 bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary text-xs font-bold rounded-lg transition-all flex items-center gap-1 active:scale-95 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{t("tts.test_play")}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
