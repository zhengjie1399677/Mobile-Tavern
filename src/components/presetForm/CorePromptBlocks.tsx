import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "../../../components/ui/accordion";
import { Switch } from "../../../components/ui/switch";
import { Textarea } from "../../../components/ui/textarea";
import { useTranslation } from "../../contexts/LanguageContext";
import type { UserSettings } from "../../types";

interface CorePromptBlocksProps {
  settings: UserSettings;
  updateSettings: (newSet: UserSettings | ((prev: UserSettings) => UserSettings)) => void;
}

/** 核心提示词区块：Main / Jailbreak / PostHistory / Reasoning 四个内置 block */
export default function CorePromptBlocks({
  settings,
  updateSettings,
}: CorePromptBlocksProps) {
  const { t } = useTranslation();
  return (
    <Accordion type="multiple" className="space-y-2">

      {/* 1. 底层扮演指令 (Main System Prompt) */}
      <AccordionItem value="main-prompt" className="border border-border rounded-lg bg-card overflow-hidden [&[data-state=open]]:border-primary/40 transition-all duration-200">
        <div className="flex items-center justify-between p-2.5 gap-2 pr-4 bg-muted/20">
          <div className="flex items-center gap-2 flex-1">
            <Switch
              aria-label={t("prompts.system_prompt")}
              checked={settings.promptConfig.useMainPrompt ?? true}
              onCheckedChange={(checked) =>
                updateSettings({
                  ...settings,
                  promptConfig: {
                    ...settings.promptConfig,
                    useMainPrompt: checked,
                  },
                })
              }
              className="data-[state=checked]:bg-primary !h-5 !w-9 [&>span]:!w-4 [&>span]:!h-4"
            />
            <div className="flex flex-col">
              <span className={`text-xs font-bold truncate ${(settings.promptConfig.useMainPrompt ?? true) ? "text-foreground" : "text-muted-foreground opacity-70"}`}>
                {t("prompts.system_prompt")}
              </span>
              <span className="text-[9px] font-mono text-muted-foreground">{t("prompts.system_prompt_tip")}</span>
            </div>
          </div>
          <AccordionTrigger aria-label="展开或折叠底层扮演指令编辑区" className="w-6 h-6 flex justify-center items-center p-0 rounded hover:bg-accent/50 [&>svg]:text-muted-foreground" />
        </div>
        <AccordionContent className="p-3 pt-0 border-t border-border/50 bg-background/50 outline-none">
          <div className="pt-3">
            <Textarea
              value={settings.promptConfig.mainPrompt || ""}
              onChange={(e) =>
                updateSettings({
                  ...settings,
                  promptConfig: {
                    ...settings.promptConfig,
                    mainPrompt: e.target.value,
                  },
                })
              }
              className="min-h-[240px] text-sm font-sans leading-relaxed resize-y bg-input/50 focus-visible:ring-primary/40 text-foreground shadow-inner"
              placeholder={t("prompts.system_prompt_placeholder")}
            />
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* 2. 规则提示词 (Jailbreak) */}
      <AccordionItem value="jailbreak-prompt" className="border border-border rounded-lg bg-card overflow-hidden [&[data-state=open]]:border-primary/40 transition-all duration-200">
        <div className="flex items-center justify-between p-2.5 gap-2 pr-4 bg-muted/20">
          <div className="flex items-center gap-2 flex-1">
            <Switch
              aria-label={t("prompts.jailbreak")}
              checked={settings.promptConfig.useJailbreak ?? true}
              onCheckedChange={(checked) =>
                updateSettings({
                  ...settings,
                  promptConfig: {
                    ...settings.promptConfig,
                    useJailbreak: checked,
                  },
                })
              }
              className="data-[state=checked]:bg-primary !h-5 !w-9 [&>span]:!w-4 [&>span]:!h-4"
            />
            <div className="flex flex-col">
              <span className={`text-xs font-bold truncate ${(settings.promptConfig.useJailbreak ?? true) ? "text-foreground" : "text-muted-foreground opacity-70"}`}>
                {t("prompts.jailbreak")}
              </span>
              <span className="text-[9px] font-mono text-muted-foreground">{t("prompts.jailbreak_tip")}</span>
            </div>
          </div>
          <AccordionTrigger aria-label="展开或折叠规则提示词编辑区" className="w-6 h-6 flex justify-center items-center p-0 rounded hover:bg-accent/50 [&>svg]:text-muted-foreground" />
        </div>
        <AccordionContent className="p-3 pt-0 border-t border-border/50 bg-background/50 outline-none">
          <div className="pt-3">
            <Textarea
              value={settings.promptConfig.jailbreakPrompt || ""}
              onChange={(e) =>
                updateSettings({
                  ...settings,
                  promptConfig: {
                    ...settings.promptConfig,
                    jailbreakPrompt: e.target.value,
                  },
                })
              }
              className="min-h-[240px] text-sm font-sans leading-relaxed resize-y bg-input/50 focus-visible:ring-primary/40 text-foreground shadow-inner"
              placeholder={t("prompts.jailbreak_placeholder")}
            />
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
