import { Database } from "lucide-react";
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

export interface MemoryConfigCardProps extends Pick<UnifiedAppContextProps, "settings" | "updateSettings"> {}

export default function MemoryConfigCard({
  settings,
  updateSettings,
}: MemoryConfigCardProps) {
  return (
    <Card className="bg-card border-border shadow-sm">
      <CardHeader className="pb-2.5 border-b border-border/50 px-3 pt-3">
        <CardTitle className="text-xs flex items-center gap-2 font-bold text-foreground">
          <Database className="w-4 h-4 text-primary" /> 记忆系统
        </CardTitle>
        <CardDescription className="text-[10px] mt-0.5">
          统一管理短期上下文窗口、叙事记忆（时间轴摘要）与状态记忆（结构化表格）三个互补子模块
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-3.5 px-3 pb-3 space-y-3.5 text-xs text-muted-foreground">
        <div className="space-y-3">
          {/* 子模块 1：上下文窗口（短期直接传递） */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[10.5px] font-bold text-primary/80 uppercase tracking-wide">
              <span className="inline-block w-1 h-3 bg-primary/60 rounded-full" />
              上下文窗口
            </div>
            <div className="flex items-center justify-between pl-1">
              <div className="flex flex-col">
                <span className="font-semibold text-foreground text-[12.5px]">
                  上下文发送轮次 (Recent Turns)
                </span>
                <span className="text-[9.5px] text-muted-foreground">
                  直接发送全文保留的对话局数
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
              长线记忆召回
            </div>
            <div className="flex items-center justify-between pl-1">
              <div className="flex flex-col">
                <span className="font-semibold text-foreground text-[12.5px] flex items-center gap-2">
                  开启长线记忆召回 (Memory Recall){" "}
                  <Switch
                    aria-label="开启长线记忆召回"
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
                  从历史消息库中自动检索并注入最相似的记忆片段
                </span>
              </div>
            </div>
            {settings.memory.enableRecall !== false && (
              <div className="flex justify-between items-center bg-muted/30 p-2 rounded border border-border">
                <span className="text-[10px] text-muted-foreground font-semibold">
                  记忆召回条数 (Recall Top K)
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
          </div>

          {/* 子模块 2：叙事记忆（Auto Summary 时间轴摘要） */}
          <div className="space-y-1.5 mt-2.5 pt-2.5 border-t border-border/40">
            <div className="flex items-center gap-1.5 text-[10.5px] font-bold text-emerald-500/80 uppercase tracking-wide">
              <span className="inline-block w-1 h-3 bg-emerald-500/60 rounded-full" />
              叙事记忆 · 时间轴摘要
            </div>
            <div className="flex items-center justify-between pl-1">
              <div className="flex flex-col">
                <span className="font-semibold text-foreground text-[12.5px] flex items-center gap-2">
                  自动记忆整理 (Auto Summary){" "}
                  <Switch
                    aria-label="自动记忆整理"
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
                  定期梳理记忆，触发轮数设为 0 时默认与上方发送轮数同步整理
                </span>
              </div>
            </div>
            {settings.memory.enableAutoSummary !== false && (
              <div className="flex justify-between items-center bg-muted/30 p-2 rounded border border-border">
                <span className="text-[10px] text-muted-foreground font-semibold">
                  触发轮次 (满多少轮执行一次梳理，输入 0 代表与上方发送轮数同步)
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
              状态记忆 · 结构化表格
            </div>
            <div className="flex items-center justify-between pl-1">
              <div className="flex flex-col">
                <span className="font-semibold text-foreground text-[12.5px] flex items-center gap-2">
                  结构化记忆表格 (Table Memory){" "}
                  <Switch
                    aria-label="结构化记忆表格"
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
                  将好感、人物关系等属性以表格形式整理并静默喂给 AI 记忆
                </span>
              </div>
            </div>
            {settings.enableTableMemory && (
              <div className="flex justify-between items-center bg-muted/30 p-2 rounded border border-border">
                <span className="text-[10px] text-muted-foreground font-semibold">
                  AI 表格检查更新频率 (每几轮对话让 AI 检查并修改数据)
                </span>
                <select
                  aria-label="AI 表格检查更新频率"
                  value={settings.tableMemoryCheckFrequency || 1}
                  onChange={(e) =>
                    updateSettings({
                      ...settings,
                      tableMemoryCheckFrequency: parseInt(e.target.value) || 1,
                    })
                  }
                  className="bg-muted border border-border rounded px-1.5 py-0.5 text-xs outline-none focus:border-primary font-bold text-foreground"
                >
                  <option value="1">每 1 轮 (最实时)</option>
                  <option value="3">每 3 轮 (推荐)</option>
                  <option value="5">每 5 轮 (省 token)</option>
                </select>
              </div>
            )}
          </div>

          <Accordion type="single" collapsible className="w-full mt-2.5 border-t border-border/30 pt-2.5">
            <AccordionItem value="advanced-templates" className="border-none">
              <AccordionTrigger className="py-1.5 hover:no-underline hover:opacity-80 transition justify-between flex w-full">
                <span className="text-[11px] font-semibold text-foreground">
                  高级整理模板与指令 (Advanced Templates & Prompts)
                </span>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-0 space-y-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-foreground">
                    时间轴幕数命名模板 (Time Tag Template)
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
                    placeholder="第{{index}}幕"
                  />
                  <p className="text-[9px] text-muted-foreground">
                    使用 <code className="text-primary bg-primary/10 px-1 rounded">{"{{index}}"}</code> 作为当前剧情序号的替换标记
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-foreground">
                    自动记忆归纳指导指令 (Summary System Prompt)
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
                    placeholder="输入总结大纲指示词..."
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
                      重置总结指令为系统默认
                    </button>
                  </div>
                </div>

                <div className="space-y-1 pt-2 border-t border-border/30">
                  <label className="text-[11px] font-semibold text-foreground">
                    推理引导指令 (Reasoning Guidance Prompt)
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
                    placeholder="输入推理引导指示词..."
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
                      重置推理指令为系统默认
                    </button>
                  </div>
                </div>

                <div className="space-y-1 pt-2 border-t border-border/30">
                  <label className="text-[11px] font-semibold text-foreground">
                    表格记忆匹配指令 (Table Memory Prompt)
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
                    placeholder="输入表格记忆指示词..."
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
                      重置表格指令为系统默认
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
