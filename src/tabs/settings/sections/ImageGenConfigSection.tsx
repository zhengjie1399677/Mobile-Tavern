import { Palette } from "lucide-react";
import { useTranslation } from "../../../contexts/LanguageContext";
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
  const { t } = useTranslation();
  return (
    <AccordionItem value="image-gen-api" className="glass-panel shadow-sm rounded-xl overflow-hidden mt-2">
      <AccordionTrigger className="px-3.5 py-2.5 hover:no-underline hover:bg-muted/30 transition">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-primary" />
          <div className="flex flex-col items-start gap-1">
            <span className="text-sm font-semibold">{t("image_gen.title")}</span>
            <span className="text-[10px] text-muted-foreground font-normal flex items-center gap-1.5">
              {t("image_gen.subtitle")}
            </span>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="p-3 pt-1 border-t border-border/50 space-y-3">
        {/* Enabled Switch */}
        <div className="flex items-center justify-between pb-3 border-b border-border/40">
          <div className="space-y-0.5">
            <label className="text-[13px] font-semibold text-foreground">{t("image_gen.enable")}</label>
            <p className="text-[10px] text-muted-foreground max-w-[450px]">
              {t("image_gen.enable_desc")}
            </p>
          </div>
          <Switch
            aria-label={t("image_gen.enable")}
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
          <div className="space-y-3 animate-in fade-in duration-300">
            {/* Force Protocol Switch */}
            <div className="flex items-center justify-between pb-2 border-b border-border/20">
              <div className="space-y-0.5">
                <label className="text-[12px] font-semibold text-foreground">{t("image_gen.force_protocol")}</label>
                <p className="text-[10px] text-muted-foreground max-w-[450px]">
                  {t("image_gen.force_protocol_desc")}
                </p>
              </div>
              <Switch
                aria-label={t("image_gen.force_protocol")}
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
                <span>{t("image_gen.protocol_title")}</span>
                {!settings.imageGenApi?.forceProtocol && (
                  <span className="text-[9px] text-primary/80 font-bold">{t("image_gen.auto_detect")}</span>
                )}
              </label>
              <Select
                aria-label={t("image_gen.protocol_title")}
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
                <SelectTrigger aria-label={t("image_gen.protocol_title")} className="w-full h-9 text-xs bg-input/40 border border-border">
                  <SelectValue placeholder="Select type" />
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
              <label className="text-[11px] font-semibold text-muted-foreground">{t("image_gen.base_url")}</label>
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
              <label className="text-[11px] font-semibold text-muted-foreground">{t("image_gen.api_key")}</label>
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
                placeholder={t("image_gen.api_key_placeholder")}
              />
            </div>

            {/* Model Name */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground">{t("image_gen.model")}</label>
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
                placeholder={t("image_gen.model_placeholder")}
              />
            </div>

            {/* Width & Height */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground">{t("image_gen.width")}</label>
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
                <label className="text-[11px] font-semibold text-muted-foreground">{t("image_gen.height")}</label>
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
                <label className="text-[10px] font-semibold text-muted-foreground">{t("image_gen.steps")}</label>
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
                <label className="text-[10px] font-semibold text-muted-foreground">{t("image_gen.cfg")}</label>
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
                <label className="text-[10px] font-semibold text-muted-foreground">{t("image_gen.sampler")}</label>
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
                  placeholder={t("image_gen.sampler_placeholder")}
                />
              </div>
            </div>

            {/* Prompt Edit Before Generate Switch */}
            <div className="flex items-center justify-between border-t border-border/40 pt-3 mt-1 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="space-y-0.5">
                <label className="text-[12px] font-semibold text-foreground">{t("image_gen.edit_before_gen")}</label>
                <p className="text-[10px] text-muted-foreground max-w-[450px]">
                  {t("image_gen.edit_before_gen_desc")}
                </p>
              </div>
              <Switch
                aria-label={t("image_gen.edit_before_gen")}
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
                    {t("image_gen.advanced_prompts")}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-0 space-y-3">
                  {/* Prompt Prefix */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-muted-foreground">{t("image_gen.prompt_prefix")}</label>
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
                      placeholder="e.g. masterpiece, best quality, "
                    />
                  </div>

                  {/* Negative Prompt (SD & NovelAI only) */}
                  {(settings.imageGenApi?.type === "sd-webui" || settings.imageGenApi?.type === "novelai") && (
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-muted-foreground">{t("image_gen.negative_prompt")}</label>
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
                        placeholder="lowres, bad hands..."
                      />
                    </div>
                  )}

                  {/* Prompt Generator Template */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-muted-foreground">{t("image_gen.prompt_template")}</label>
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
                      placeholder="Prompt template for LLM summarization"
                    />
                    <p className="text-[9px] text-muted-foreground leading-tight">
                      {t("image_gen.prompt_template_desc")}
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
