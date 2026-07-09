import { useState, useEffect } from "react";
import { Volume2, Play, Square } from "lucide-react";
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

export interface TtsConfigSectionProps
  extends Pick<UnifiedAppContextProps, "settings" | "updateSettings" | "getKernelService"> {}

export default function TtsConfigSection({
  settings,
  updateSettings,
  getKernelService,
}: TtsConfigSectionProps) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [testSpeaking, setTestSpeaking] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      const updateVoices = () => {
        setVoices(window.speechSynthesis.getVoices());
      };
      updateVoices();
      window.speechSynthesis.onvoiceschanged = updateVoices;
      return () => {
        window.speechSynthesis.onvoiceschanged = null;
      };
    }
  }, []);

  const handlePlayTest = async () => {
    try {
      setTestSpeaking(true);
      const ttsService = getKernelService<any>("tts");
      await ttsService.speak("你好，欢迎来到移动酒馆。这是一段语音测试朗读。", settings.ttsConfig);
    } catch (e: any) {
      console.warn("TTS test failed:", e);
    } finally {
      setTestSpeaking(false);
    }
  };

  const handleStopTest = async () => {
    try {
      const ttsService = getKernelService<any>("tts");
      ttsService.stop();
    } catch (e) { }
    setTestSpeaking(false);
  };

  return (
    <AccordionItem value="tts-config" className="glass-panel shadow-sm rounded-xl overflow-hidden mt-2">
      <AccordionTrigger className="px-4 py-3 hover:no-underline [&[data-state=open]]:bg-muted/40">
        <div className="flex items-center gap-2">
          <Volume2 className="w-4 h-4 text-primary" />
          <span className="text-xs font-bold text-foreground">语音朗读设置 (TTS)</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="p-4 space-y-4">
        <div className="flex items-center justify-between border-b border-border/30 pb-3">
          <div>
            <div className="text-xs font-semibold text-foreground">开启 TTS 语音朗读</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">启用后支持在消息菜单中朗读文本</div>
          </div>
          <Switch
            aria-label="启用 TTS 朗读"
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
          <div className="space-y-4 animate-in fade-in duration-300">
            {/* Play Mode & Read Mode */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground">朗读触发方式</label>
                <Select
                  aria-label="朗读触发方式"
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
                  <SelectTrigger aria-label="排版结构格式" className="w-full text-xs h-9 bg-input/50 font-semibold">
                    <SelectValue placeholder="触发方式" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto" className="text-xs font-semibold">自动朗读 (默认)</SelectItem>
                    <SelectItem value="manual" className="text-xs font-semibold">手动朗读 (仅按需)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground">朗读内容范围</label>
                <Select
                  aria-label="朗读内容范围"
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
                  <SelectTrigger className="w-full text-xs h-9 bg-input/50 font-semibold">
                    <SelectValue placeholder="内容范围" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs font-semibold">朗读全文 (含动作)</SelectItem>
                    <SelectItem value="dialogue_only" className="text-xs font-semibold">仅朗读对白 (过滤动作)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Provider Selection */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground">语音引擎 (Provider)</label>
              <Select
                aria-label="语音引擎"
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
                <SelectTrigger className="w-full text-xs h-9 bg-input/50 font-semibold">
                  <SelectValue placeholder="选择语音引擎" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="speech-synthesis" className="text-xs font-semibold">浏览器本地语音合成 (SpeechSynthesis)</SelectItem>
                  <SelectItem value="openai" className="text-xs font-semibold">OpenAI TTS 接口 (在线高清语音)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Sliders for Volume, Speed, Pitch */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-muted-foreground block">音量 ({Math.round((settings.ttsConfig?.volume ?? 0.5) * 100)}%)</label>
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
                <label className="text-[10px] font-semibold text-muted-foreground block">语速 ({settings.ttsConfig?.rate ?? 1.0}x)</label>
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
                <label className="text-[10px] font-semibold text-muted-foreground block">音高 ({settings.ttsConfig?.pitch ?? 1.0})</label>
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
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground">选择本地音色 (Local Voice)</label>
                <Select
                  aria-label="选择本地音色"
                  value={settings.ttsConfig?.voiceName || "default"}
                  onValueChange={(val) => {
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
                        voiceName: val === "default" ? "" : val,
                      },
                    }));
                  }}
                >
                  <SelectTrigger className="w-full text-xs h-9 bg-input/50 font-semibold">
                    <SelectValue placeholder="系统默认音色" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default" className="text-xs font-semibold">系统默认音色</SelectItem>
                    {voices
                      .filter((v) => {
                        const lang = v.lang.toLowerCase();
                        return (
                          lang.includes("zh") ||
                          lang.includes("cmn") ||
                          lang.includes("yue") ||
                          lang.includes("chinese")
                        );
                      })
                      .map((v) => (
                        <SelectItem key={v.name} value={v.name} className="text-xs font-semibold">
                          🗣️ {v.name} ({v.lang})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
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
                    className="h-8 text-xs bg-input/50"
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
                    className="h-8 text-xs bg-input/50"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-muted-foreground block">TTS 模型</label>
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
                      className="h-8 text-xs bg-input/50"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-muted-foreground block">声音角色 (Voice)</label>
                    <Select
                      aria-label="声音角色"
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
                            openaiVoice: val,
                          },
                        }));
                      }}
                    >
                      <SelectTrigger className="w-full text-xs h-8 bg-input/50 font-semibold">
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
                  <span>停止测试</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handlePlayTest}
                  className="h-8 px-3 bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary text-xs font-bold rounded-lg transition-all flex items-center gap-1 active:scale-95 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>测试发音</span>
                </button>
              )}
            </div>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
