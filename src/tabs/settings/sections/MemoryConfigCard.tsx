import { Database } from "lucide-react";
import { useTranslation } from "../../../contexts/LanguageContext";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "../../../../components/ui/card";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "../../../../components/ui/accordion";
import { Switch } from "../../../../components/ui/switch";
import { Input } from "../../../../components/ui/input";
import { Textarea } from "../../../../components/ui/textarea";
import { DEFAULT_SETTINGS } from "../../../hooks/useSettings";
import type { UnifiedAppContextProps } from "../../../UnifiedAppContext";
import SettingsSelect from "../SettingsSelect";

export interface MemoryConfigCardProps extends Pick<UnifiedAppContextProps, "settings" | "updateSettings"> {}

export default function MemoryConfigCard({
  settings,
  updateSettings,
}: MemoryConfigCardProps) {
  const { t } = useTranslation();
  return (
    <Card className="bg-card border-border shadow-sm">
      <CardHeader className="pb-2.5 border-b border-border/50 px-3 pt-3">
        <CardTitle className="text-xs flex items-center gap-2 font-bold text-foreground">
          <Database className="w-4 h-4 text-primary" /> {t("memory_sys.title")}
        </CardTitle>
        <CardDescription className="text-[10px] mt-0.5">
          {t("memory_sys.subtitle")}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-3.5 px-3 pb-3 space-y-3.5 text-xs text-muted-foreground">
        <div className="space-y-3">
          {/* 子模块 1：上下文窗口（短期直接传递） */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[10.5px] font-bold text-primary/80 uppercase tracking-wide">
              <span className="inline-block w-1 h-3 bg-primary/60 rounded-full" />
              {t("memory_sys.recent_turns_title")}
            </div>
            <div className="flex items-center justify-between pl-1">
              <div className="flex flex-col">
                <span className="font-semibold text-foreground text-[12.5px]">
                  {t("memory_sys.recent_turns")}
                </span>
                <span className="text-[9.5px] text-muted-foreground">
                  {t("memory_sys.recent_turns_desc")}
                </span>
              </div>
              <input
                type="number"
                min="2"
                max="100"
                step="1"
                value={settings.memory.recentTurns}
                onChange={(e) => {
                  const parsed = parseInt(e.target.value);
                  if (!isNaN(parsed) && parsed >= 1) {
                    updateSettings({
                      ...settings,
                      memory: {
                        ...settings.memory,
                        recentTurns: parsed,
                      },
                    });
                  }
                }}
                className="w-16 bg-muted border border-border text-center rounded p-1 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* 子模块 1.5：长线记忆召回 */}
          <div className="space-y-1.5 mt-2.5 pt-2.5 border-t border-border/40">
            <div className="flex items-center gap-1.5 text-[10.5px] font-bold text-violet-500/80 uppercase tracking-wide">
              <span className="inline-block w-1 h-3 bg-violet-500/60 rounded-full" />
              {t("memory_sys.recall_title")}
            </div>
            <div className="flex items-center justify-between pl-1">
              <div className="flex flex-col">
                <span className="font-semibold text-foreground text-[12.5px] flex items-center gap-2">
                  {t("memory_sys.recall_enable")}{" "}
                  <Switch
                    aria-label={t("memory_sys.recall_enable")}
                    checked={settings.memory.enableRecall !== false}
                    onCheckedChange={(val) =>
                      updateSettings({
                        ...settings,
                        memory: {
                          ...settings.memory,
                          enableRecall: val,
                        },
                      })
                    }
                    className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
                  />
                </span>
                <span className="text-[9.5px] text-muted-foreground mt-0.5">
                  {t("memory_sys.recall_desc")}
                </span>
              </div>
            </div>
            {settings.memory.enableRecall !== false && (
              <div className="flex justify-between items-center bg-muted/30 p-2 rounded border border-border">
                <span className="text-[10px] text-muted-foreground font-semibold">
                  {t("memory_sys.recall_top_k")}
                </span>
                <input
                  type="number"
                  min="1"
                  max="10"
                  step="1"
                  value={settings.memory.recallTopK ?? 3}
                  onChange={(e) => {
                    const parsed = parseInt(e.target.value);
                    if (!isNaN(parsed) && parsed >= 1) {
                      updateSettings({
                        ...settings,
                        memory: {
                          ...settings.memory,
                          recallTopK: parsed,
                        },
                      });
                    }
                  }}
                  className="w-16 bg-muted border border-border text-center rounded p-1 text-sm outline-none focus:border-primary font-mono"
                />
              </div>
            )}
            {settings.memory.enableRecall !== false && (
              <div className="flex justify-between items-center bg-muted/30 p-2 rounded border border-border">
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground font-semibold">
                    {t("memory_sys.recall_timeout")}
                  </span>
                  <span className="text-[9px] text-muted-foreground/70 mt-0.5">
                    {t("memory_sys.recall_timeout_desc")}
                  </span>
                </div>
                <Switch
                  aria-label={t("memory_sys.recall_timeout")}
                  checked={(settings.memory.recallTimeoutMs ?? 3000) > 0}
                  onCheckedChange={(val) =>
                    updateSettings({
                      ...settings,
                      memory: {
                        ...settings.memory,
                        recallTimeoutMs: val ? 3000 : 0,
                      },
                    })
                  }
                />
              </div>
            )}
          </div>

          {/* 子模块 2：叙事记忆（Auto Summary 时间轴摘要） */}
          <div className="space-y-1.5 mt-2.5 pt-2.5 border-t border-border/40">
            <div className="flex items-center gap-1.5 text-[10.5px] font-bold text-emerald-500/80 uppercase tracking-wide">
              <span className="inline-block w-1 h-3 bg-emerald-500/60 rounded-full" />
              {t("memory_sys.summary_title")}
            </div>
            <div className="flex items-center justify-between pl-1">
              <div className="flex flex-col">
                <span className="font-semibold text-foreground text-[12.5px] flex items-center gap-2">
                  {t("memory_sys.summary_enable")}{" "}
                  <Switch
                    aria-label={t("memory_sys.summary_enable")}
                    checked={settings.memory.enableAutoSummary !== false}
                    onCheckedChange={(val) =>
                      updateSettings({
                        ...settings,
                        memory: {
                          ...settings.memory,
                          enableAutoSummary: val,
                        },
                      })
                    }
                    className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
                  />
                </span>
                <span className="text-[9.5px] text-muted-foreground mt-0.5">
                  {t("memory_sys.summary_desc")}
                </span>
              </div>
            </div>
            {settings.memory.enableAutoSummary !== false && (
              <div className="flex justify-between items-center bg-muted/30 p-2 rounded border border-border">
                <span className="text-[10px] text-muted-foreground font-semibold">
                  {t("memory_sys.summary_trigger")}
                </span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={settings.memory.summaryTriggerTurns}
                  onChange={(e) =>
                    updateSettings({
                      ...settings,
                      memory: {
                        ...settings.memory,
                        summaryTriggerTurns:
                          parseInt(e.target.value) || 0,
                      },
                    })
                  }
                  className="w-16 bg-muted border border-border text-center rounded p-1 text-sm outline-none focus:border-primary font-mono"
                />
              </div>
            )}
          </div>

          {/* 子模块 3：状态记忆（Table Memory 结构化表格） */}
          <div className="space-y-1.5 mt-2.5 pt-2.5 border-t border-border/40">
            <div className="flex items-center gap-1.5 text-[10.5px] font-bold text-sky-500/80 uppercase tracking-wide">
              <span className="inline-block w-1 h-3 bg-sky-500/60 rounded-full" />
              {t("memory_sys.table_title")}
            </div>
            <div className="flex items-center justify-between pl-1">
              <div className="flex flex-col">
                <span className="font-semibold text-foreground text-[12.5px] flex items-center gap-2">
                  {t("memory_sys.table_enable")}{" "}
                  <Switch
                    aria-label={t("memory_sys.table_enable")}
                    checked={!!settings.enableTableMemory}
                    onCheckedChange={(val) =>
                      updateSettings({
                        ...settings,
                        enableTableMemory: val,
                      })
                    }
                    className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
                  />
                </span>
                <span className="text-[9.5px] text-muted-foreground mt-0.5">
                  {t("memory_sys.table_desc")}
                </span>
              </div>
            </div>
            {settings.enableTableMemory && (
              <div className="flex justify-between items-center bg-muted/30 p-2 rounded border border-border">
                <span className="text-[10px] text-muted-foreground font-semibold">
                  {t("memory_sys.table_freq")}
                </span>
                <SettingsSelect
                  value={String(settings.tableMemoryCheckFrequency || 1)}
                  onValueChange={(nextValue) =>
                    updateSettings({
                      ...settings,
                      tableMemoryCheckFrequency: parseInt(nextValue) || 1,
                    })
                  }
                  ariaLabel={t("memory_sys.table_freq")}
                  className="w-24"
                  options={[
                    { value: "1", label: t("memory_sys.table_freq_1") },
                    { value: "3", label: t("memory_sys.table_freq_3") },
                    { value: "5", label: t("memory_sys.table_freq_5") },
                  ]}
                />
              </div>
            )}
          </div>

          <Accordion type="single" collapsible className="w-full mt-2.5 border-t border-border/30 pt-2.5">
            <AccordionItem value="advanced-templates" className="border-none">
              <AccordionTrigger className="py-1.5 hover:no-underline hover:opacity-80 transition justify-between flex w-full">
                <span className="text-[11px] font-semibold text-foreground">
                  {t("memory_sys.advanced_title")}
                </span>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-0 space-y-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-foreground">
                    {t("memory_sys.time_tag")}
                  </label>
                  <Input
                    value={settings.memory.timeTagTemplate || ""}
                    onChange={(e) =>
                      updateSettings({
                        ...settings,
                        memory: {
                          ...settings.memory,
                          timeTagTemplate: e.target.value,
                        },
                      })
                    }
                    className="h-9 text-xs bg-input/50"
                    placeholder="e.g. Chapter {{index}}"
                  />
                  <p className="text-[9px] text-muted-foreground">
                    {t("memory_sys.time_tag_desc")}
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-foreground">
                    {t("memory_sys.summary_prompt")}
                  </label>
                  <Textarea
                    value={settings.memory.summarySystemPrompt || ""}
                    onChange={(e) =>
                      updateSettings({
                        ...settings,
                        memory: {
                          ...settings.memory,
                          summarySystemPrompt: e.target.value,
                        },
                      })
                    }
                    className="text-xs bg-input/50 min-h-[260px] leading-relaxed font-mono"
                    placeholder="Summary instructions..."
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        updateSettings({
                          ...settings,
                          memory: {
                            ...settings.memory,
                            summarySystemPrompt: DEFAULT_SETTINGS.memory.summarySystemPrompt,
                          }
                        });
                      }}
                      className="text-[9px] text-primary font-bold hover:underline"
                    >
                      {t("memory_sys.reset_summary")}
                    </button>
                  </div>
                </div>

                <div className="space-y-1 pt-2 border-t border-border/30">
                  <label className="text-[11px] font-semibold text-foreground">
                    {t("memory_sys.reasoning_prompt")}
                  </label>
                  <Textarea
                    value={settings.promptConfig?.reasoningGuidancePrompt || ""}
                    onChange={(e) =>
                      updateSettings({
                        ...settings,
                        promptConfig: {
                          ...settings.promptConfig,
                          reasoningGuidancePrompt: e.target.value,
                        },
                      })
                    }
                    className="text-xs bg-input/50 min-h-[260px] leading-relaxed font-mono"
                    placeholder="Reasoning instructions..."
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        updateSettings({
                          ...settings,
                          promptConfig: {
                            ...settings.promptConfig,
                            reasoningGuidancePrompt: DEFAULT_SETTINGS.promptConfig?.reasoningGuidancePrompt || "",
                          }
                        });
                      }}
                      className="text-[9px] text-primary font-bold hover:underline"
                    >
                      {t("memory_sys.reset_reasoning")}
                    </button>
                  </div>
                </div>

                <div className="space-y-1 pt-2 border-t border-border/30">
                  <label className="text-[11px] font-semibold text-foreground">
                    {t("memory_sys.table_prompt")}
                  </label>
                  <Textarea
                    value={settings.promptConfig?.tableMemoryPrompt || ""}
                    onChange={(e) =>
                      updateSettings({
                        ...settings,
                        promptConfig: {
                          ...settings.promptConfig,
                          tableMemoryPrompt: e.target.value,
                        },
                      })
                    }
                    className="text-xs bg-input/50 min-h-[260px] leading-relaxed font-mono"
                    placeholder="Table instructions..."
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        updateSettings({
                          ...settings,
                          promptConfig: {
                            ...settings.promptConfig,
                            tableMemoryPrompt: DEFAULT_SETTINGS.promptConfig?.tableMemoryPrompt || "",
                          }
                        });
                      }}
                      className="text-[9px] text-primary font-bold hover:underline"
                    >
                      {t("memory_sys.reset_table")}
                    </button>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </CardContent>
    </Card>
  );
}
