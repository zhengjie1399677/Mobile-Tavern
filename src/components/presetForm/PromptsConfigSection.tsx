import { Brain, ChevronDown, ChevronUp, AlertCircle, HelpCircle, Plus, Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../../components/ui/card";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "../../../components/ui/accordion";
import { Switch } from "../../../components/ui/switch";
import { Checkbox } from "../../../components/ui/checkbox";
import { Input } from "../../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { Textarea } from "../../../components/ui/textarea";
import { cn } from "../../../lib/utils";
import CorePromptBlocks from "./CorePromptBlocks";
import type { UserSettings } from "../../types";

interface PromptsConfigSectionProps {
  settings: UserSettings;
  updateSettings: (newSet: UserSettings | ((prev: UserSettings) => UserSettings)) => void;
  handleToggleCustomPrompt: (id: string, enabled: boolean) => void;
  handleUpdateCustomPrompt: (id: string, name: string, role: any, content: string) => void;
  handleAddNewCustomPrompt: () => void;
  handleDeleteCustomPrompt: (id: string) => Promise<void>;
  isPromptsFolded: boolean;
  handleTogglePromptsFold: () => void;
  coreStatusText: string;
  activeCustomPrompts: number;
  selectedPromptIds: string[];
  setSelectedPromptIds: (value: string[] | ((prev: string[]) => string[])) => void;
  isBatchDeletingPrompts: boolean;
  setIsBatchDeletingPrompts: (value: boolean | ((prev: boolean) => boolean)) => void;
  handleBatchDeletePrompts: () => Promise<void>;
}

/** 3. 预设提示词配置容器（编排 CorePromptBlocks 与自定义提示词模组） */
export default function PromptsConfigSection({
  settings,
  updateSettings,
  handleToggleCustomPrompt,
  handleUpdateCustomPrompt,
  handleAddNewCustomPrompt,
  handleDeleteCustomPrompt,
  isPromptsFolded,
  handleTogglePromptsFold,
  coreStatusText,
  activeCustomPrompts,
  selectedPromptIds,
  setSelectedPromptIds,
  isBatchDeletingPrompts,
  setIsBatchDeletingPrompts,
  handleBatchDeletePrompts,
}: PromptsConfigSectionProps) {
  return (
    <Card className={cn("glass-panel shadow-sm transition-all duration-300", isPromptsFolded ? "py-2 gap-0" : "")}>
      <CardHeader
        className={cn("cursor-pointer hover:bg-muted/20 transition select-none", isPromptsFolded ? "pb-0 border-b-0" : "pb-3 border-b border-border/50")}
        onClick={handleTogglePromptsFold}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2 shrink-0">
            <Brain className="w-4 h-4 text-primary" /> 预设提示词配置
          </CardTitle>
          <div className="flex items-center gap-2 overflow-hidden">
            {isPromptsFolded && (
              <span className="text-[10px] text-muted-foreground/80 font-mono bg-muted/40 px-1.5 py-0.5 rounded border border-border/30 truncate max-w-[150px] sm:max-w-none">
                核心: {coreStatusText} | 模组: {activeCustomPrompts}
              </span>
            )}
            {isPromptsFolded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
          </div>
        </div>
        {!isPromptsFolded && (
          <CardDescription className="text-[11px] mt-1">
            配置底层扮演指令、规则提示以及颗粒化扩展提示词模组
          </CardDescription>
        )}
      </CardHeader>
      {!isPromptsFolded && (
        <CardContent className="pt-4 space-y-4">
        <div className="bg-muted/50 p-3 rounded-lg border border-border/50 text-[11px] text-muted-foreground flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            注入环境兼容 ST 标签：
            <code className="text-primary bg-primary/10 px-1 rounded">
              {"{{char}}"}, {"{{user}}"}
            </code>{" "}
            等规则动态匹配宏处理。
          </p>
        </div>

        {/* CORE PROMPT BLOCKS */}
        <span className="block text-xs font-bold font-mono text-foreground">CORE PROMPTS</span>
        <CorePromptBlocks settings={settings} updateSettings={updateSettings} />

        <div className="flex justify-between items-center mb-1 pt-2 border-t border-border/50 flex-wrap gap-2">
          <span className="text-xs font-bold font-mono text-foreground">
            PROMPT MODULES
          </span>
          <div className="flex gap-2">
            {isBatchDeletingPrompts ? (
              <>
                <button
                  type="button"
                  onClick={handleBatchDeletePrompts}
                  disabled={selectedPromptIds.length === 0}
                  className="text-xs font-bold text-rose-500 bg-rose-500/10 hover:bg-rose-500/20 px-2 py-1 rounded border border-rose-500/20 flex items-center gap-1 transition disabled:opacity-50 disabled:cursor-not-allowed tap-scale"
                >
                  <Trash2 className="w-3.5 h-3.5" /> 确认删除 ({selectedPromptIds.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsBatchDeletingPrompts(false);
                    setSelectedPromptIds([]);
                  }}
                  className="text-xs font-bold text-muted-foreground bg-muted hover:bg-muted/80 px-2 py-1 rounded border border-border flex items-center gap-1 transition tap-scale"
                >
                  取消
                </button>
              </>
            ) : (
              <>
                {settings.promptConfig.customPrompts && settings.promptConfig.customPrompts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setIsBatchDeletingPrompts(true)}
                    className="text-xs font-bold text-muted-foreground hover:text-destructive bg-muted/40 hover:bg-destructive/10 px-2 py-1 rounded border border-border hover:border-destructive/20 flex items-center gap-1 transition tap-scale"
                  >
                    批量删除
                  </button>
                )}
                <button
                  onClick={handleAddNewCustomPrompt}
                  className="text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 px-2 py-1 rounded border border-primary/20 flex items-center gap-1 transition tap-scale"
                >
                  <Plus className="w-3 h-3" /> 新建模组
                </button>
              </>
            )}
          </div>
        </div>

        {!settings.promptConfig.customPrompts ||
        settings.promptConfig.customPrompts.length === 0 ? (
          <div className="border border-dashed border-border/80 rounded-xl p-8 text-center text-muted-foreground flex flex-col items-center justify-center gap-2">
            <HelpCircle className="w-6 h-6 opacity-50" />
            <span className="text-xs font-semibold">
              无挂规则组件
            </span>
          </div>
        ) : (
          <Accordion type="multiple" className="space-y-2">
            {settings.promptConfig.customPrompts.map((p) => (
              <AccordionItem
                value={p.id}
                key={p.id}
                className="group/accordion-item border border-border rounded-lg bg-card overflow-hidden [&[data-state=open]]:border-primary/40 [&[data-state=open]]:shadow-sm [&[data-state=open]]:ring-1 [&[data-state=open]]:ring-primary/10 transition-all duration-200"
              >
                <div className="flex items-center justify-between p-2.5 gap-2 pr-4 bg-muted/20">
                  <div className="flex items-center gap-2 flex-1">
                    {isBatchDeletingPrompts && (
                      <Checkbox
                        checked={selectedPromptIds.includes(p.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedPromptIds((prev) => [...prev, p.id]);
                          } else {
                            setSelectedPromptIds((prev) => prev.filter((id) => id !== p.id));
                          }
                        }}
                        className="shrink-0"
                      />
                    )}
                    <Switch
                      checked={p.enabled}
                      onCheckedChange={(checked) =>
                        handleToggleCustomPrompt(p.id, checked)
                      }
                      className="data-[state=checked]:bg-primary !h-5 !w-9 [&>span]:!w-4 [&>span]:!h-4"
                    />
                    <span
                      className={cn(
                        "text-[10px] font-bold transition-all duration-200 block",
                        p.enabled ? "text-foreground" : "text-muted-foreground opacity-70",
                        "truncate max-w-[120px]",
                        "group-data-[state=open]/accordion-item:max-w-none group-data-[state=open]/accordion-item:whitespace-normal group-data-[state=open]/accordion-item:overflow-visible"
                      )}
                    >
                      {p.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteCustomPrompt(p.id);
                      }}
                      className="p-1 hover:bg-destructive/20 hover:text-destructive text-muted-foreground rounded transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <AccordionTrigger className="w-6 h-6 flex justify-center items-center p-0 rounded hover:bg-accent/50 [&>svg]:text-muted-foreground" />
                  </div>
                </div>
                <AccordionContent className="p-3 pt-0 border-t border-border/50 bg-background/50 outline-none">
                  <div className="pt-3 space-y-3">
                    <div className="flex gap-2">
                      <Input
                        value={p.name}
                        onChange={(e) =>
                          handleUpdateCustomPrompt(
                            p.id,
                            e.target.value,
                            p.role,
                            p.content,
                          )
                        }
                        className="h-8 text-xs bg-input/50 focus-visible:ring-1"
                      />

                    </div>
                    <Textarea
                      value={p.content}
                      onChange={(e) =>
                        handleUpdateCustomPrompt(
                          p.id,
                          p.name,
                          p.role,
                          e.target.value,
                        )
                      }
                      className="min-h-[220px] text-sm font-sans leading-relaxed resize-y bg-input/50 focus-visible:ring-primary/40 text-foreground font-sans shadow-inner"
                      placeholder="Enter strict instructions here..."
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </CardContent>
      )}
    </Card>
  );
}
