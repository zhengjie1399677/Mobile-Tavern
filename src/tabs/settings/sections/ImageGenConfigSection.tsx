import { Palette } from "lucide-react";
import {
  Accordion,
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
import { Textarea } from "../../../../components/ui/textarea";
import type { UnifiedAppContextProps } from "../../../UnifiedAppContext";

export interface ImageGenConfigSectionProps
  extends Pick<UnifiedAppContextProps, "settings" | "updateSettings"> {}

export default function ImageGenConfigSection({
  settings,
  updateSettings,
}: ImageGenConfigSectionProps) {
  return (
    <AccordionItem value="image-gen-api" className="glass-panel shadow-sm rounded-xl overflow-hidden mt-2">
      <AccordionTrigger className="px-3.5 py-2.5 hover:no-underline hover:bg-muted/30 transition">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-primary" />
          <div className="flex flex-col items-start gap-1">
            <span className="text-sm font-semibold">AI 生图服务端点配置</span>
            <span className="text-[10px] text-muted-foreground font-normal flex items-center gap-1.5">
              配置 Stable Diffusion、NovelAI 或 DALL-E 接口
            </span>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="p-3 pt-1 border-t border-border/50 space-y-3">
        {/* Enabled Switch */}
        <div className="flex items-center justify-between pb-3 border-b border-border/40">
          <div className="space-y-0.5">
            <label className="text-[13px] font-semibold text-foreground">开启生图拓展功能</label>
            <p className="text-[10px] text-muted-foreground max-w-[450px]">
              开启后，可在 AI 消息快捷菜单中对对白执行场景绘制。
            </p>
          </div>
          <Switch
            aria-label="启用图像生成"
            checked={settings.imageGenApi?.enabled || false}
            onCheckedChange={(checked) =>
              updateSettings((prev) => ({
                ...prev,
                imageGenApi: {
                  ...(prev.imageGenApi || {
                    enabled: false,
                    type: "openai-dalle",
                    baseUrl: "https://api.openai.com/v1",
                    apiKey: "",
                    modelName: "dall-e-3",
                    promptPrefix: "masterpiece, best quality, anime style, ",
                    negativePrompt: "lowres, bad anatomy, bad hands, text, error",
                    width: 1024,
                    height: 1024,
                    steps: 20,
                    cfgScale: 7.0,
                    sampler: "Euler a",
                  }),
                  enabled: checked,
                },
              }))
            }
            className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
          />
        </div>

        {settings.imageGenApi?.enabled && (
          <div className="space-y-4 animate-in fade-in duration-300">
            {/* Force Protocol Switch */}
            <div className="flex items-center justify-between pb-2 border-b border-border/20">
              <div className="space-y-0.5">
                <label className="text-[12px] font-semibold text-foreground">手动强行指定协议类型</label>
                <p className="text-[10px] text-muted-foreground max-w-[450px]">
                  关闭时，系统会根据 Base URL 自动检测（如检测到 novelai 或 sdwebui 关键字自动套用其格式，其余默认使用 OpenAI 格式）。
                </p>
              </div>
              <Switch
                aria-label="强制图像生成协议"
                checked={settings.imageGenApi?.forceProtocol || false}
                onCheckedChange={(checked) =>
                  updateSettings((prev) => ({
                    ...prev,
                    imageGenApi: {
                      ...(prev.imageGenApi || {
                        enabled: true,
                        type: "openai-dalle",
                        baseUrl: "https://api.openai.com/v1",
                        apiKey: "",
                        modelName: "dall-e-3",
                        promptPrefix: "masterpiece, best quality, anime style, ",
                        negativePrompt: "lowres, bad anatomy, bad hands, text, error",
                        width: 1024,
                        height: 1024,
                        steps: 20,
                        cfgScale: 7.0,
                        sampler: "Euler a",
                        forceProtocol: false,
                      }),
                      forceProtocol: checked,
                    },
                  }))
                }
                className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
              />
            </div>

            {/* Type Select */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground flex justify-between">
                <span>生图接口类型</span>
                {!settings.imageGenApi?.forceProtocol && (
                  <span className="text-[9px] text-primary/80 font-bold">自动识别模式（根据 Base URL 猜测）</span>
                )}
              </label>
              <Select
                aria-label="图像生成格式"
                disabled={!settings.imageGenApi?.forceProtocol}
                value={
                  settings.imageGenApi?.forceProtocol
                    ? (settings.imageGenApi?.type || "openai-dalle")
                    : (() => {
                      const urlLower = (settings.imageGenApi?.baseUrl || "").toLowerCase();
                      if (urlLower.includes("novelai")) return "novelai";
                      if (urlLower.includes("7860") || urlLower.includes("sdapi") || urlLower.includes("sd-webui")) return "sd-webui";
                      return "openai-dalle";
                    })()
                }
                onValueChange={(val: any) =>
                  updateSettings((prev) => ({
                    ...prev,
                    imageGenApi: {
                      ...(prev.imageGenApi || {
                        enabled: true,
                        type: "openai-dalle",
                        baseUrl: "https://api.openai.com/v1",
                        apiKey: "",
                        modelName: "dall-e-3",
                        promptPrefix: "masterpiece, best quality, anime style, ",
                        negativePrompt: "lowres, bad anatomy, bad hands, text, error",
                        width: 1024,
                        height: 1024,
                        steps: 20,
                        cfgScale: 7.0,
                        sampler: "Euler a",
                      }),
                      type: val,
                      baseUrl: val === "openai-dalle"
                        ? "https://api.openai.com/v1"
                        : val === "sd-webui"
                          ? "http://127.0.0.1:7860"
                          : "https://image.novelai.net",
                      modelName: val === "openai-dalle"
                        ? "dall-e-3"
                        : val === "sd-webui"
                          ? ""
                          : "safe-diffusion",
                    },
                  }))
                }
              >
                <SelectTrigger aria-label="语音引擎" className="w-full h-9 text-xs bg-input/40 border border-border">
                  <SelectValue placeholder="选择接口类型" />
                </SelectTrigger>
                <SelectContent className="bg-popover text-popover-foreground border border-border shadow-lg">
                  <SelectItem value="openai-dalle" className="text-xs">OpenAI DALL-E (DALL-E 3)</SelectItem>
                  <SelectItem value="sd-webui" className="text-xs">Stable Diffusion WebUI</SelectItem>
                  <SelectItem value="novelai" className="text-xs">NovelAI API</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Base URL */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground">生图接口 Base URL</label>
              <Input
                type="text"
                className="font-mono text-xs h-9 bg-input/50"
                spellCheck={false}
                value={settings.imageGenApi?.baseUrl || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  updateSettings((prev) => ({
                    ...prev,
                    imageGenApi: {
                      ...(prev.imageGenApi || {
                        enabled: true,
                        type: "openai-dalle",
                        baseUrl: "",
                        apiKey: "",
                        modelName: "",
                        promptPrefix: "",
                        negativePrompt: "",
                        width: 512,
                        height: 512,
                        steps: 20,
                        cfgScale: 7.0,
                        sampler: "",
                      }),
                      baseUrl: val,
                    },
                  }));
                }}
                placeholder="https://api.openai.com/v1"
              />
            </div>

            {/* API Key */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground">API Key / Access Token</label>
              <Input
                type="password"
                className="font-mono text-xs h-9 bg-input/50"
                spellCheck={false}
                value={settings.imageGenApi?.apiKey || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  updateSettings((prev) => ({
                    ...prev,
                    imageGenApi: {
                      ...(prev.imageGenApi || {
                        enabled: true,
                        type: "openai-dalle",
                        baseUrl: "",
                        apiKey: "",
                        modelName: "",
                        promptPrefix: "",
                        negativePrompt: "",
                        width: 512,
                        height: 512,
                        steps: 20,
                        cfgScale: 7.0,
                        sampler: "",
                      }),
                      apiKey: val,
                    },
                  }));
                }}
                placeholder="填写接口密钥或 Token"
              />
            </div>

            {/* Model Name */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground">模型名称 (Model)</label>
              <Input
                type="text"
                className="font-mono text-xs h-9 bg-input/50"
                spellCheck={false}
                value={settings.imageGenApi?.modelName || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  updateSettings((prev) => ({
                    ...prev,
                    imageGenApi: {
                      ...(prev.imageGenApi || {
                        enabled: true,
                        type: "openai-dalle",
                        baseUrl: "",
                        apiKey: "",
                        modelName: "",
                        promptPrefix: "",
                        negativePrompt: "",
                        width: 512,
                        height: 512,
                        steps: 20,
                        cfgScale: 7.0,
                        sampler: "",
                      }),
                      modelName: val,
                    },
                  }));
                }}
                placeholder="如 dall-e-3 或 custom-model"
              />
            </div>

            {/* Width & Height */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground">图片宽度 (Width)</label>
                <Input
                  type="number"
                  className="font-mono text-xs h-9 bg-input/50"
                  value={settings.imageGenApi?.width || 512}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 512;
                    updateSettings((prev) => ({
                      ...prev,
                      imageGenApi: {
                        ...(prev.imageGenApi || {
                          enabled: true,
                          type: "openai-dalle",
                          baseUrl: "",
                          apiKey: "",
                          modelName: "",
                          promptPrefix: "",
                          negativePrompt: "",
                          width: 512,
                          height: 512,
                          steps: 20,
                          cfgScale: 7.0,
                          sampler: "",
                        }),
                        width: val,
                      },
                    }));
                  }}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground">图片高度 (Height)</label>
                <Input
                  type="number"
                  className="font-mono text-xs h-9 bg-input/50"
                  value={settings.imageGenApi?.height || 512}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 512;
                    updateSettings((prev) => ({
                      ...prev,
                      imageGenApi: {
                        ...(prev.imageGenApi || {
                          enabled: true,
                          type: "openai-dalle",
                          baseUrl: "",
                          apiKey: "",
                          modelName: "",
                          promptPrefix: "",
                          negativePrompt: "",
                          width: 512,
                          height: 512,
                          steps: 20,
                          cfgScale: 7.0,
                          sampler: "",
                        }),
                        height: val,
                      },
                    }));
                  }}
                />
              </div>
            </div>

            {/* Steps, CFG & Sampler */}
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-muted-foreground">步数 (Steps)</label>
                <Input
                  type="number"
                  className="font-mono text-xs h-9 bg-input/50"
                  value={settings.imageGenApi?.steps || 20}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 20;
                    updateSettings((prev) => ({
                      ...prev,
                      imageGenApi: {
                        ...(prev.imageGenApi || {
                          enabled: true,
                          type: "openai-dalle",
                          baseUrl: "",
                          apiKey: "",
                          modelName: "",
                          promptPrefix: "",
                          negativePrompt: "",
                          width: 512,
                          height: 512,
                          steps: 20,
                          cfgScale: 7.0,
                          sampler: "",
                        }),
                        steps: val,
                      },
                    }));
                  }}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-muted-foreground">CFG Scale</label>
                <Input
                  type="number"
                  step="0.1"
                  className="font-mono text-xs h-9 bg-input/50"
                  value={settings.imageGenApi?.cfgScale || 7.0}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 7.0;
                    updateSettings((prev) => ({
                      ...prev,
                      imageGenApi: {
                        ...(prev.imageGenApi || {
                          enabled: true,
                          type: "openai-dalle",
                          baseUrl: "",
                          apiKey: "",
                          modelName: "",
                          promptPrefix: "",
                          negativePrompt: "",
                          width: 512,
                          height: 512,
                          steps: 20,
                          cfgScale: 7.0,
                          sampler: "",
                        }),
                        cfgScale: val,
                      },
                    }));
                  }}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-muted-foreground">采样器 (Sampler)</label>
                <Input
                  type="text"
                  className="font-mono text-xs h-9 bg-input/50"
                  value={settings.imageGenApi?.sampler || ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateSettings((prev) => ({
                      ...prev,
                      imageGenApi: {
                        ...(prev.imageGenApi || {
                          enabled: true,
                          type: "openai-dalle",
                          baseUrl: "",
                          apiKey: "",
                          modelName: "",
                          promptPrefix: "",
                          negativePrompt: "",
                          width: 512,
                          height: 512,
                          steps: 20,
                          cfgScale: 7.0,
                          sampler: "",
                        }),
                        sampler: val,
                      },
                    }));
                  }}
                  placeholder="如 Euler a"
                />
              </div>
            </div>

            {/* Prompt Edit Before Generate Switch */}
            <div className="flex items-center justify-between border-t border-border/40 pt-3 mt-1 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="space-y-0.5">
                <label className="text-[12px] font-semibold text-foreground">生图前弹窗确认/修改提示词</label>
                <p className="text-[10px] text-muted-foreground max-w-[450px]">
                  开启后，大模型总结完提示词会弹出输入框，允许您手动修改 Prompt 后再发起生图。
                </p>
              </div>
              <Switch
                aria-label="图像生成前编辑提示词"
                checked={settings.imageGenApi?.promptEditBeforeGenerate || false}
                onCheckedChange={(checked) =>
                  updateSettings((prev) => ({
                    ...prev,
                    imageGenApi: {
                      ...(prev.imageGenApi || {
                        enabled: true,
                        type: "openai-dalle",
                        baseUrl: "",
                        apiKey: "",
                        modelName: "",
                        promptPrefix: "",
                        negativePrompt: "",
                        width: 512,
                        height: 512,
                        steps: 20,
                        cfgScale: 7.0,
                        sampler: "",
                        promptGeneratorTemplate: "",
                        promptEditBeforeGenerate: false,
                      }),
                      promptEditBeforeGenerate: checked,
                    },
                  }))
                }
                className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
              />
            </div>

            {/* Nested Collapsible Prompts Accordion */}
            <Accordion type="single" collapsible className="w-full border-t border-border/40 pt-2 mt-2">
              <AccordionItem value="image-prompts-settings" className="border-none">
                <AccordionTrigger className="py-2 hover:no-underline hover:opacity-80 transition justify-between flex w-full">
                  <span className="text-[11px] font-semibold text-foreground">
                    高级提示词模板与前缀 (Advanced Prompts & Templates)
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pt-3 pb-0 space-y-4">
                  {/* Prompt Prefix */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-muted-foreground">默认提示词前缀</label>
                    <Textarea
                      className="font-mono text-xs min-h-[120px] bg-input/50 leading-relaxed"
                      value={settings.imageGenApi?.promptPrefix || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateSettings((prev) => ({
                          ...prev,
                          imageGenApi: {
                            ...(prev.imageGenApi || {
                              enabled: true,
                              type: "openai-dalle",
                              baseUrl: "",
                              apiKey: "",
                              modelName: "",
                              promptPrefix: "",
                              negativePrompt: "",
                              width: 512,
                              height: 512,
                              steps: 20,
                              cfgScale: 7.0,
                              sampler: "",
                            }),
                            promptPrefix: val,
                          },
                        }));
                      }}
                      placeholder="例如: masterpiece, best quality, "
                    />
                  </div>

                  {/* Negative Prompt (SD & NovelAI only) */}
                  {(settings.imageGenApi?.type === "sd-webui" || settings.imageGenApi?.type === "novelai") && (
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-muted-foreground">反向提示词 (Negative Prompt)</label>
                      <Textarea
                        className="font-mono text-xs min-h-[120px] bg-input/50 leading-relaxed"
                        value={settings.imageGenApi?.negativePrompt || ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateSettings((prev) => ({
                            ...prev,
                            imageGenApi: {
                              ...(prev.imageGenApi || {
                                enabled: true,
                                type: "openai-dalle",
                                baseUrl: "",
                                apiKey: "",
                                modelName: "",
                                promptPrefix: "",
                                negativePrompt: "",
                                width: 512,
                                height: 512,
                                steps: 20,
                                cfgScale: 7.0,
                                sampler: "",
                              }),
                              negativePrompt: val,
                            },
                          }));
                        }}
                        placeholder="低画质，坏手..."
                      />
                    </div>
                  )}

                  {/* Prompt Generator Template */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-muted-foreground">场景描述总结模板 (Prompt Generator Template)</label>
                    <Textarea
                      className="font-mono text-xs min-h-[160px] bg-input/50 leading-relaxed"
                      value={settings.imageGenApi?.promptGeneratorTemplate || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateSettings((prev) => ({
                          ...prev,
                          imageGenApi: {
                            ...(prev.imageGenApi || {
                              enabled: true,
                              type: "openai-dalle",
                              baseUrl: "",
                              apiKey: "",
                              modelName: "",
                              promptPrefix: "",
                              negativePrompt: "",
                              width: 512,
                              height: 512,
                              steps: 20,
                              cfgScale: 7.0,
                              sampler: "",
                              promptGeneratorTemplate: "",
                            }),
                            promptGeneratorTemplate: val,
                          },
                        }));
                      }}
                      placeholder="基于对话总结画面 Prompt 的模板"
                    />
                    <p className="text-[9px] text-muted-foreground leading-tight">
                      系统会使用聊天配置的 LLM 运行此引导提示词。内置占位符 <code>{'{appearance}'}</code>（外观特征）、<code>{'{context}'}</code>（对话上下文）、<code>{'{message}'}</code>（当前对白）将自动替换。
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
