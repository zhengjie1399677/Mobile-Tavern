import { useState } from "react";
import { ChevronDown, FlaskConical, Globe } from "lucide-react";
import {
  Card,
  CardHeader,
  CardContent,
  CardDescription,
} from "../../../components/ui/card";
import { Switch } from "../../../components/ui/switch";
import { Input } from "../../../components/ui/input";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "../../../components/ui/accordion";
import { Textarea } from "../../../components/ui/textarea";
import { DEFAULT_SETTINGS } from "../../hooks/useSettings";
import type { UnifiedAppContextProps } from "../../UnifiedAppContext";
import { useTranslation } from "../../contexts/LanguageContext";
import SettingsSelect from "./SettingsSelect";

export type FeaturesSectionProps = Pick<UnifiedAppContextProps, "settings" | "updateSettings">;

export default function FeaturesSection({
  settings,
  updateSettings,
}: FeaturesSectionProps) {
  const { language, changeLanguage, t } = useTranslation();
  const [showFeatureDetails, setShowFeatureDetails] = useState(false);
  const [showExpressionDictionary, setShowExpressionDictionary] = useState(false);

  return (
    <>
      {/* 1. 多语言设置 (Language Settings) */}
      <Card className="glass-panel shadow-sm">
        <CardContent className="p-3 space-y-3">
          <div className="flex items-center gap-2 pb-1.5 border-b border-border/50 mb-1.5 select-none">
            <Globe className="w-4 h-4 text-primary" />
            <span className="text-[13.5px] font-black text-foreground tracking-wide">
              {t("lang.section_title")}
            </span>
          </div>

          <div className="space-y-3 pl-1">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="space-y-0.5 max-w-lg">
                <label className="text-[11px] font-bold text-foreground">
                  {t("lang.select_label")}
                </label>
                <p className="text-[9px] text-muted-foreground/80 leading-relaxed overflow-wrap break-word">
                  {t("lang.select_desc")}
                </p>
              </div>
              <SettingsSelect
                value={language}
                onValueChange={changeLanguage}
                ariaLabel={t("lang.select_label")}
                className="shrink-0 sm:w-48"
                options={[
                  { value: "zh-CN", label: "简体中文 (Simplified Chinese)" },
                  { value: "zh-TW", label: "繁體中文 (Traditional Chinese)" },
                  { value: "en", label: "English" },
                  { value: "ja", label: "日本語 (Japanese)" },
                  { value: "ru", label: "Русский (Russian)" },
                  { value: "es", label: "Español (Spanish)" },
                ]}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. 功能设置 (Features) */}
      <Card className="glass-panel shadow-sm mt-2">
        <button
          type="button"
          aria-expanded={showFeatureDetails}
          onClick={() => setShowFeatureDetails((current) => !current)}
          className="flex min-h-11 w-full items-center gap-2 px-3 text-left"
        >
            <FlaskConical className="w-4 h-4 text-primary" />
            <span className="flex-1 text-[13px] font-black text-foreground tracking-wide">
              {t("features.section_title")}
            </span>
            <ChevronDown className={`size-4 text-muted-foreground transition-transform ${showFeatureDetails ? "rotate-180" : ""}`} />
        </button>
        {showFeatureDetails && (
        <CardContent className="space-y-3 border-t border-border/40 px-3 pb-3 pt-2">

          {/* 子分类 1：界面渲染与交互特性 */}
          <div className="space-y-2">
            {/* 子分类标题 1 (指示条小节栏，层级明晰) */}
            <div className="flex items-center gap-1.5 pb-1 border-b border-border/60 mt-0.5 mb-2 select-none">
              <span className="w-1.2 h-3 bg-primary rounded-full" />
              <span className="text-[11.5px] font-black text-foreground tracking-wide">
                {t("features.cat_rendering")}
              </span>
            </div>

            {/* 子分类下功能 (带缩进展现从属层级，并进行 Flex 折行与 Switch 防挤压适配) */}
            <div className="space-y-3.5 pl-1">
              
              {/* 开启富文本 HTML 渲染 */}
              <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
                <div className="space-y-0.5 min-w-0 flex-1">
                  <label className="text-[11px] font-bold text-foreground">
                    {t("features.html_rendering")}
                  </label>
                  <p className="text-[9px] text-muted-foreground/80 leading-relaxed overflow-wrap break-word">
                    {t("features.html_rendering_desc")}
                  </p>
                </div>
                <Switch
                  aria-label={t("features.html_rendering")}
                  checked={settings.enableHtmlRendering || false}
                  onCheckedChange={(val) =>
                    updateSettings({ ...settings, enableHtmlRendering: val })
                  }
                  className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3 shrink-0 self-center"
                />
              </div>

              {/* 开启卡片 JavaScript 脚本执行 */}
              <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
                <div className="space-y-0.5 min-w-0 flex-1">
                  <label className="text-[11px] font-bold text-foreground">
                    {t("features.js_execution")}
                  </label>
                  <p className="text-[9px] text-muted-foreground/80 leading-relaxed overflow-wrap break-word">
                    {t("features.js_execution_desc")}
                  </p>
                </div>
                <Switch
                  aria-label={t("features.js_execution")}
                  checked={settings.enableScriptExecution || false}
                  onCheckedChange={(val) =>
                    updateSettings({ ...settings, enableScriptExecution: val })
                  }
                  className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3 shrink-0 self-center"
                />
              </div>

              {settings.enableScriptExecution && (
                <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap pl-4 border-l-2 border-primary/30 mt-1 animate-in slide-in-from-top-1 duration-200">
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <label className="text-[11px] font-bold text-foreground">
                      {t("features.loop_protection")}
                    </label>
                    <p className="text-[9px] text-muted-foreground/80 leading-relaxed overflow-wrap break-word">
                      {t("features.loop_protection_desc")}
                    </p>
                  </div>
                  <Switch
                    aria-label={t("features.loop_protection")}
                    checked={settings.enableLoopProtection !== false}
                    onCheckedChange={(val) =>
                      updateSettings({ ...settings, enableLoopProtection: val })
                    }
                    className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3 shrink-0 self-center"
                  />
                </div>
              )}

              {/* 环境光感应联动 */}
              <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
                <div className="space-y-0.5 min-w-0 flex-1">
                  <label className="text-[11px] font-bold text-foreground flex items-center gap-1.5 flex-wrap">
                    <span>{t("features.ambient_glow")}</span>
                    <span className="text-[8.5px] text-amber-500 bg-amber-500/10 px-1 py-0.2 rounded font-normal scale-90">
                      {t("features.ambient_glow_experimental")}
                    </span>
                  </label>
                  <p className="text-[9px] text-muted-foreground/80 leading-relaxed overflow-wrap break-word">
                    {t("features.ambient_glow_desc")}
                  </p>
                </div>
                <Switch
                  aria-label={t("features.ambient_glow")}
                  checked={settings.enableEmotionAmbientGlow || false}
                  onCheckedChange={(val) =>
                    updateSettings({ ...settings, enableEmotionAmbientGlow: val })
                  }
                  className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3 shrink-0 self-center"
                />
              </div>

              {/* 思维链显示 */}
              <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
                <div className="space-y-0.5 min-w-0 flex-1">
                  <label className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
                    <span>{t("features.reasoning_display")}</span>
                  </label>
                  <p className="text-[9px] text-muted-foreground/80 leading-relaxed overflow-wrap break-word">
                    {t("features.reasoning_display_desc")}
                  </p>
                </div>
                <Switch
                  aria-label={t("features.reasoning_display")}
                  checked={settings.enableReasoningContentDisplay !== false}
                  onCheckedChange={(val) =>
                    updateSettings({ ...settings, enableReasoningContentDisplay: val })
                  }
                  className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3 shrink-0 self-center"
                />
              </div>

              {/* 多消息排队合并发送 */}
              <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
                <div className="space-y-0.5 min-w-0 flex-1">
                  <label className="text-[11px] font-bold text-foreground flex items-center gap-1.5 flex-wrap">
                    <span>{t("features.message_queue")}</span>
                    <span className="text-[8.5px] text-amber-500 bg-amber-500/10 px-1 py-0.2 rounded font-normal scale-90">
                      {t("features.message_queue_plugin")}
                    </span>
                  </label>
                  <p className="text-[9px] text-muted-foreground/80 leading-relaxed overflow-wrap break-word">
                    {t("features.message_queue_desc")}
                  </p>
                </div>
                <Switch
                  aria-label={t("features.message_queue")}
                  checked={settings.enableMultiMessageQueue || false}
                  onCheckedChange={(val) =>
                    updateSettings({ ...settings, enableMultiMessageQueue: val })
                  }
                  className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3 shrink-0 self-center"
                />
              </div>

              {/* 星号动作分色渲染 */}
              <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
                <div className="space-y-0.5 min-w-0 flex-1">
                  <label className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
                    <span>{t("features.asterisk_formatting")}</span>
                  </label>
                  <p className="text-[9px] text-muted-foreground/80 leading-relaxed overflow-wrap break-word">
                    {t("features.asterisk_formatting_desc")}
                  </p>
                </div>
                <Switch
                  aria-label={t("features.asterisk_formatting")}
                  checked={settings.enableAsteriskFormatting || false}
                  onCheckedChange={(val) =>
                    updateSettings({ ...settings, enableAsteriskFormatting: val })
                  }
                  className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3 shrink-0 self-center"
                />
              </div>

              {/* 野牛模式 */}
              <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
                <div className="space-y-0.5 min-w-0 flex-1">
                  <label className="text-[11px] font-bold text-foreground flex items-center gap-1.5 flex-wrap">
                    <span>{t("features.bison_mode")}</span>
                    <span className="text-[8.5px] text-amber-500 bg-amber-500/10 px-1 py-0.2 rounded font-normal scale-90">
                      {t("features.ambient_glow_experimental")}
                    </span>
                    <span className="text-[8.5px] text-red-500 bg-red-500/10 px-1 py-0.2 rounded font-normal scale-90">
                      {t("features.bison_mode_token_warning")}
                    </span>
                  </label>
                  <p className="text-[9px] text-muted-foreground/80 leading-relaxed overflow-wrap break-word">
                    {t("features.bison_mode_desc")}
                  </p>
                  <p className="text-[9px] text-red-400 font-medium leading-relaxed overflow-wrap break-word">
                    {t("features.bison_mode_warning")}
                  </p>
                </div>
                <Switch
                  aria-label={t("features.bison_mode")}
                  checked={settings.enableBisonMode || false}
                  onCheckedChange={(val) =>
                    updateSettings({ ...settings, enableBisonMode: val })
                  }
                  className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3 shrink-0 self-center"
                />
              </div>

              {settings.enableBisonMode && (
                <div className="mt-1.5 bg-muted/15 p-2 rounded-lg border border-border/30 space-y-1.5 animate-in fade-in duration-300">
                  <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="bison-prompt-accordion" className="border-none">
                      <AccordionTrigger className="py-0.5 hover:no-underline hover:opacity-80 transition justify-between flex w-full">
                        <span className="text-[10px] font-semibold text-muted-foreground">
                          {t("features.bison_mode_prompt_title")}
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="pt-1.5 pb-0 space-y-1.5">
                        <Textarea
                          value={settings.bisonModePrompt || ""}
                          onChange={(e) =>
                            updateSettings({ ...settings, bisonModePrompt: e.target.value })
                          }
                          className="text-xs bg-input/50 min-h-[100px] leading-relaxed font-sans"
                          placeholder="..."
                        />
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              updateSettings({
                                ...settings,
                                bisonModePrompt: DEFAULT_SETTINGS.bisonModePrompt || "",
                              });
                            }}
                            className="text-[9px] text-primary font-bold hover:underline"
                          >
                            {t("features.reset_default")}
                          </button>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              )}
            </div>
          </div>

          {/* 子分类 2：提示词注入与生成协议 */}
          <div className="space-y-2 pt-1">
            {/* 子分类标题 2 (指示条小节栏，层级明晰) */}
            <div className="flex items-center gap-1.5 pb-1 border-b border-border/60 mt-2 mb-2 select-none">
              <span className="w-1.2 h-3 bg-primary rounded-full" />
              <span className="text-[11.5px] font-black text-foreground tracking-wide">
                提示词注入与生成协议
              </span>
            </div>

            {/* 子分类下功能 (带缩进展现从属层级，并进行 Flex 折行与 Switch 防挤压适配) */}
            <div className="space-y-3.5 pl-1">
              
              {/* AI 回复走向推荐 */}
              <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
                <div className="space-y-0.5 min-w-0 flex-1">
                  <label className="text-[11px] font-bold text-foreground flex items-center gap-1.5 flex-wrap">
                    <span>{t("features.reply_suggestions")}</span>
                    <span className="text-[8.5px] text-amber-500 bg-amber-500/10 px-1 py-0.2 rounded font-normal scale-90">
                      {t("features.ambient_glow_experimental")}
                    </span>
                  </label>
                  <p className="text-[9px] text-muted-foreground/80 leading-relaxed overflow-wrap break-word">
                    {t("features.reply_suggestions_desc")}
                  </p>
                </div>
                <Switch
                  aria-label={t("features.reply_suggestions")}
                  checked={settings.enableReplySuggestions || false}
                  onCheckedChange={(val) =>
                    updateSettings({ ...settings, enableReplySuggestions: val })
                  }
                  className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3 shrink-0 self-center"
                />
              </div>

              {settings.enableReplySuggestions && (
                <div className="space-y-2 mt-1.5 bg-muted/15 p-2 rounded-lg border border-border/30 animate-in fade-in duration-300">
                  <div className="flex justify-between items-center pb-1.5 border-b border-border/20 gap-2 flex-wrap">
                    <span className="text-[10px] text-muted-foreground font-semibold">
                      {t("features.click_mode")}
                    </span>
                    <SettingsSelect
                      value={settings.replySuggestionsClickMode || "fill"}
                      onValueChange={(nextValue) =>
                        updateSettings({
                          ...settings,
                          replySuggestionsClickMode: nextValue as "send" | "fill",
                        })
                      }
                      ariaLabel={t("features.click_mode")}
                      className="w-28"
                      options={[
                        { value: "fill", label: t("features.click_mode_fill") },
                        { value: "send", label: t("features.click_mode_send") },
                      ]}
                    />
                  </div>

                  {/* Collapsible Suggestions Prompt */}
                  <Accordion type="single" collapsible className="w-full pt-0.5">
                    <AccordionItem value="suggestions-prompt-accordion" className="border-none">
                      <AccordionTrigger className="py-0.5 hover:no-underline hover:opacity-80 transition justify-between flex w-full">
                        <span className="text-[10px] font-semibold text-muted-foreground">
                          {t("features.suggestions_prompt_title")}
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="pt-1.5 pb-0 space-y-1.5">
                        <Textarea
                          value={settings.replySuggestionsPrompt || ""}
                          onChange={(e) =>
                            updateSettings({ ...settings, replySuggestionsPrompt: e.target.value })
                          }
                          className="text-xs bg-input/50 min-h-[110px] leading-relaxed font-sans"
                          placeholder="..."
                        />
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              updateSettings({
                                ...settings,
                                replySuggestionsPrompt: DEFAULT_SETTINGS.replySuggestionsPrompt || "",
                              });
                            }}
                            className="text-[9px] text-primary font-bold hover:underline"
                          >
                            {t("features.reset_default")}
                          </button>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              )}
            </div>
          </div>
        </CardContent>
        )}
      </Card>

      {/* 3. 全局表情情绪匹配正则词典 */}
      <Card className="glass-panel shadow-sm mt-2">
        <CardHeader className="p-0">
          <button
            type="button"
            aria-expanded={showExpressionDictionary}
            onClick={() => setShowExpressionDictionary((current) => !current)}
            className="flex min-h-11 w-full items-center gap-2 px-3 text-left"
          >
            <span className="flex-1 text-xs font-bold text-foreground">
              {t("features.expression_dict_title")}
            </span>
            <ChevronDown className={`size-4 text-muted-foreground transition-transform ${showExpressionDictionary ? "rotate-180" : ""}`} />
          </button>
          {showExpressionDictionary && (
            <CardDescription className="border-t border-border/40 px-3 pb-2 pt-2 text-[10px] leading-relaxed overflow-wrap break-word">
              {t("features.expression_dict_desc")}
            </CardDescription>
          )}
        </CardHeader>
        {showExpressionDictionary && (
        <CardContent className="space-y-2 px-3 pb-3 pt-2 text-xs">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                updateSettings({
                  ...settings,
                  expressionTriggers: {
                    joy: "笑了|微笑|开心|😊|smile|joy|happy",
                    happy: "笑了|微笑|开心|😊|smile|joy|happy",
                    smile: "笑了|微笑|开心|😊|smile|joy|happy",
                    sadness: "哭|流泪|伤心|😢|cry|sad",
                    sad: "哭|流泪|伤心|😢|cry|sad",
                    cry: "哭|流泪|伤心|😢|cry|sad",
                    anger: "生气|愤怒|😡|angry|rage",
                    angry: "生气|愤怒|😡|angry|rage",
                    rage: "生气|愤怒|😡|angry|rage",
                    blush: "脸红|害羞|😳|blush|shy",
                    shy: "脸红|害羞|😳|blush|shy",
                  }
                });
              }}
              className="text-[9px] text-primary font-bold hover:underline"
            >
              {t("features.reset_dict")}
            </button>
          </div>
          {[
            { k: "joy", n: "狂喜 (Joy)" },
            { k: "happy", n: "开心 (Happy)" },
            { k: "smile", n: "微笑 (Smile)" },
            { k: "sadness", n: "悲伤 (Sadness)" },
            { k: "sad", n: "伤心 (Sad)" },
            { k: "cry", n: "流泪 (Cry)" },
            { k: "anger", n: "发怒 (Anger)" },
            { k: "angry", n: "生气 (Angry)" },
            { k: "rage", n: "暴怒 (Rage)" },
            { k: "blush", n: "羞涩 (Blush)" },
            { k: "shy", n: "害羞 (Shy)" },
          ].map((item) => (
            <div key={item.k} className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              <span className="font-semibold text-muted-foreground w-20 shrink-0 text-[10.5px]">
                {item.n}
              </span>
              <Input
                value={settings.expressionTriggers?.[item.k] ?? ""}
                onChange={(e) => {
                  const nextTriggers = {
                    ...(settings.expressionTriggers || {}),
                    [item.k]: e.target.value,
                  };
                  updateSettings({
                    ...settings,
                    expressionTriggers: nextTriggers,
                  });
                }}
                className="h-8 text-xs font-mono bg-input/50 flex-1 min-w-[120px]"
                placeholder="..."
              />
            </div>
          ))}
        </CardContent>
        )}
      </Card>
    </>
  );
}
