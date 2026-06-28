import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "../../../components/ui/accordion";
import { Switch } from "../../../components/ui/switch";
import { Textarea } from "../../../components/ui/textarea";
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
  return (
    <Accordion type="multiple" className="space-y-2">

      {/* 1. 底层扮演指令 (Main System Prompt) */}
      <AccordionItem value="main-prompt" className="border border-border rounded-lg bg-card overflow-hidden [&[data-state=open]]:border-primary/40 transition-all duration-200">
        <div className="flex items-center justify-between p-2.5 gap-2 pr-4 bg-muted/20">
          <div className="flex items-center gap-2 flex-1">
            <Switch
              checked={settings.promptConfig.useMainPrompt}
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
              <span className={`text-xs font-bold truncate ${settings.promptConfig.useMainPrompt ? "text-foreground" : "text-muted-foreground opacity-70"}`}>
                底层扮演系统指令 (System Prompt)
              </span>
              <span className="text-[9px] font-mono text-muted-foreground">system · 处于上下文最顶部</span>
            </div>
          </div>
          <AccordionTrigger className="w-6 h-6 flex justify-center items-center p-0 rounded hover:bg-accent/50 [&>svg]:text-muted-foreground" />
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
              placeholder="输入底层角色扮演系统指令..."
            />
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* 2. 破限提示词 (Jailbreak) */}
      <AccordionItem value="jailbreak-prompt" className="border border-border rounded-lg bg-card overflow-hidden [&[data-state=open]]:border-primary/40 transition-all duration-200">
        <div className="flex items-center justify-between p-2.5 gap-2 pr-4 bg-muted/20">
          <div className="flex items-center gap-2 flex-1">
            <Switch
              checked={settings.promptConfig.useJailbreak}
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
              <span className={`text-xs font-bold truncate ${settings.promptConfig.useJailbreak ? "text-foreground" : "text-muted-foreground opacity-70"}`}>
                破限提示词 (Jailbreak)
              </span>
              <span className="text-[9px] font-mono text-muted-foreground">system · beforeLast 前注入</span>
            </div>
          </div>
          <AccordionTrigger className="w-6 h-6 flex justify-center items-center p-0 rounded hover:bg-accent/50 [&>svg]:text-muted-foreground" />
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
              placeholder="输入破限提示词..."
            />
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* 3. 生成纪律提醒 (Post-History) */}
      <AccordionItem value="post-history-prompt" className="border border-border rounded-lg bg-card overflow-hidden [&[data-state=open]]:border-primary/40 transition-all duration-200">
        <div className="flex items-center justify-between p-2.5 gap-2 pr-4 bg-muted/20">
          <div className="flex items-center gap-2 flex-1">
            <Switch
              checked={settings.promptConfig.usePostHistory}
              onCheckedChange={(checked) =>
                updateSettings({
                  ...settings,
                  promptConfig: {
                    ...settings.promptConfig,
                    usePostHistory: checked,
                  },
                })
              }
              className="data-[state=checked]:bg-primary !h-5 !w-9 [&>span]:!w-4 [&>span]:!h-4"
            />
            <div className="flex flex-col">
              <span className={`text-xs font-bold truncate ${settings.promptConfig.usePostHistory ? "text-foreground" : "text-muted-foreground opacity-70"}`}>
                生成纪律提醒 (Post-History)
              </span>
              <span className="text-[9px] font-mono text-muted-foreground">system · 历史记录末尾压轴</span>
            </div>
          </div>
          <AccordionTrigger className="w-6 h-6 flex justify-center items-center p-0 rounded hover:bg-accent/50 [&>svg]:text-muted-foreground" />
        </div>
        <AccordionContent className="p-3 pt-0 border-t border-border/50 bg-background/50 outline-none">
          <div className="pt-3">
            <Textarea
              value={settings.promptConfig.postHistoryPrompt || ""}
              onChange={(e) =>
                updateSettings({
                  ...settings,
                  promptConfig: {
                    ...settings.promptConfig,
                    postHistoryPrompt: e.target.value,
                  },
                })
              }
              className="min-h-[200px] text-sm font-sans leading-relaxed resize-y bg-input/50 focus-visible:ring-primary/40 text-foreground shadow-inner"
              placeholder="输入尾部纪律提醒指令..."
            />
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* 4. 深度思考推理引导 (Reasoning Guidance) */}
      <AccordionItem value="reasoning-guidance-prompt" className="border border-border rounded-lg bg-card overflow-hidden [&[data-state=open]]:border-primary/40 transition-all duration-200">
        <div className="flex items-center justify-between p-2.5 gap-2 pr-4 bg-muted/20">
          <div className="flex items-center gap-2 flex-1">
            <Switch
              checked={settings.promptConfig.enableReasoningGuidance ?? true}
              onCheckedChange={(checked) =>
                updateSettings({
                  ...settings,
                  promptConfig: {
                    ...settings.promptConfig,
                    enableReasoningGuidance: checked,
                  },
                })
              }
              className="data-[state=checked]:bg-primary !h-5 !w-9 [&>span]:!w-4 [&>span]:!h-4"
            />
            <div className="flex flex-col">
              <span className={`text-xs font-bold truncate ${(settings.promptConfig.enableReasoningGuidance ?? true) ? "text-foreground" : "text-muted-foreground opacity-70"}`}>
                推理深度思考引导 (Reasoning Guidance)
              </span>
              <span className="text-[9px] font-mono text-muted-foreground">system · 专为思考模型（如 DeepSeek）引导</span>
            </div>
          </div>
          <AccordionTrigger className="w-6 h-6 flex justify-center items-center p-0 rounded hover:bg-accent/50 [&>svg]:text-muted-foreground" />
        </div>
        <AccordionContent className="p-3 pt-0 border-t border-border/50 bg-background/50 outline-none">
          <div className="pt-3">
            <Textarea
              value={settings.promptConfig.reasoningGuidancePrompt ?? ""}
              onChange={(e) =>
                updateSettings({
                  ...settings,
                  promptConfig: {
                    ...settings.promptConfig,
                    reasoningGuidancePrompt: e.target.value,
                  },
                })
              }
              className="min-h-[160px] text-sm font-sans leading-relaxed resize-y bg-input/50 focus-visible:ring-primary/40 text-foreground shadow-inner"
              placeholder="输入推理引导提示词（空置则采用默认引导）..."
            />
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
