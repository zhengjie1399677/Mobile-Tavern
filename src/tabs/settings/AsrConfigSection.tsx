import { Mic } from "lucide-react";
import { AccordionItem, AccordionTrigger, AccordionContent } from "../../../components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import { Input } from "../../../components/ui/input";
import type { UserSettings } from "../../types";

export interface AsrConfigSectionProps {
  settings: UserSettings;
  updateSettings: (updater: (prev: UserSettings) => UserSettings) => void;
}

export default function AsrConfigSection({ settings, updateSettings }: AsrConfigSectionProps) {
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
    <AccordionItem value="asr-api-config" className="glass-panel shadow-sm rounded-xl overflow-hidden mt-2">
      <AccordionTrigger className="px-3.5 py-2.5 hover:no-underline hover:bg-muted/30 transition">
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4 text-primary" />
          <div className="flex flex-col items-start gap-1">
            <span className="text-sm font-semibold">语音输入 (ASR) 配置</span>
            <span className="text-[10px] text-muted-foreground font-normal">
              开启麦克风输入与语音转文字（浏览器原生或 OpenAI Whisper）
            </span>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="p-3 pt-1 border-t border-border/50 space-y-3">
        {/* Enable Switch */}
        <div className="flex items-center justify-between pb-3 border-b border-border/40">
          <div className="space-y-0.5">
            <label className="text-[13px] font-semibold text-foreground">开启语音输入</label>
            <p className="text-[10px] text-muted-foreground max-w-[450px]">
              开启后，聊天输入框左侧将显示麦克风图标，允许录音并自动转为文字。
            </p>
          </div>
          <Switch
            checked={asrConfig.enabled}
            onCheckedChange={(checked) => updateAsr({ enabled: checked })}
            className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
          />
        </div>

        {asrConfig.enabled && (
          <div className="space-y-4 animate-in fade-in duration-300">
            {/* Provider Selection */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground block">
                语音识别服务提供商 (Provider)
              </label>
              <Select
                value={asrConfig.provider}
                onValueChange={(val: "web-speech" | "openai") => updateAsr({ provider: val })}
              >
                <SelectTrigger className="w-full h-9 text-xs bg-input/40 border border-border">
                  <SelectValue placeholder="选择接口类型" />
                </SelectTrigger>
                <SelectContent className="bg-popover text-popover-foreground border border-border shadow-lg">
                  <SelectItem value="web-speech" className="text-xs">
                    浏览器原生 Web Speech API (免 Key/实时流式)
                  </SelectItem>
                  <SelectItem value="openai" className="text-xs">
                    OpenAI Whisper API (高准确率)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Language Field */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground">识别语言 (Language)</label>
              <Input
                type="text"
                className="font-mono text-xs h-9 bg-input/50"
                value={asrConfig.language}
                onChange={(e) => updateAsr({ language: e.target.value })}
                placeholder="如 zh-CN, en-US, ja-JP"
              />
              <p className="text-[9px] text-muted-foreground/70">
                浏览器原生识别时必须输入正确的语言标识，Whisper 可留空自动检测。
              </p>
            </div>

            {/* Whisper specific config */}
            {asrConfig.provider === "openai" && (
              <div className="space-y-4 border-t border-border/20 pt-3 animate-in fade-in duration-300">
                {/* Whisper API Key */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground">API Key</label>
                  <Input
                    type="password"
                    className="font-mono text-xs h-9 bg-input/50"
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
                    className="font-mono text-xs h-9 bg-input/50"
                    spellCheck={false}
                    value={asrConfig.openaiBaseUrl || ""}
                    onChange={(e) => updateAsr({ openaiBaseUrl: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                  />
                </div>

                {/* Whisper Model Name */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground">模型名称 (Model)</label>
                  <Input
                    type="text"
                    className="font-mono text-xs h-9 bg-input/50"
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
