import { Database, Lock, MessageSquare, Download, Upload } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "../../../components/ui/card";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "../../../components/ui/accordion";
import { Switch } from "../../../components/ui/switch";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import { DEFAULT_SETTINGS } from "../../hooks/useSettings";
import { UsageDisplay } from "../../utils/useUsageTracking";
import type { UnifiedAppContextProps } from "../../UnifiedAppContext";
import type { ViewportSize } from "./utils";

export interface MemoryStorageSectionProps
  extends Pick<UnifiedAppContextProps,
    | "settings"
    | "updateSettings"
    | "backupPass"
    | "setBackupPass"
    | "backupStatus"
    | "encryptBackup"
    | "setEncryptBackup"
    | "showBackupUI"
    | "setShowBackupUI"
    | "handleExportLocalDataBackup"
    | "handleImportLocalDataBackup"
    | "handleImportSillyChatHistory"
    | "safeAreas"
  > {
  isTauri: boolean;
  deviceModel: string;
  viewportSize: ViewportSize;
}

export default function MemoryStorageSection({
  settings,
  updateSettings,
  backupPass,
  setBackupPass,
  backupStatus,
  encryptBackup,
  setEncryptBackup,
  showBackupUI,
  setShowBackupUI,
  handleExportLocalDataBackup,
  handleImportLocalDataBackup,
  handleImportSillyChatHistory,
  safeAreas,
  isTauri,
  deviceModel,
  viewportSize,
}: MemoryStorageSectionProps) {
  return (
    <>
      <Card className="bg-card border-border shadow-sm">
        <CardHeader className="pb-3 border-b border-border/50">
          <CardTitle className="text-sm flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" /> 记忆系统
          </CardTitle>
          <CardDescription className="text-[11px]">
            统一管理短期上下文窗口、叙事记忆（时间轴摘要）与状态记忆（结构化表格）三个互补子模块
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5 space-y-5 text-xs text-muted-foreground">
          <div className="space-y-4">
            {/* 子模块 1：上下文窗口（短期直接传递） */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-primary/80 uppercase tracking-wide">
                <span className="inline-block w-1 h-3 bg-primary/60 rounded-full" />
                上下文窗口
              </div>
              <div className="flex items-center justify-between pl-2">
                <div className="flex flex-col">
                  <span className="font-semibold text-foreground text-[13px]">
                    上下文发送轮次 (Recent Turns)
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    直接发送全文保留的对话局数
                  </span>
                </div>
                <input
                  type="number"
                  min="2"
                  max="100"
                  step="1"
                  value={settings.memory.recentTurns}
                  onChange={(e) =>
                    updateSettings({
                      ...settings,
                      memory: {
                        ...settings.memory,
                        recentTurns: parseInt(e.target.value) || 0,
                      },
                    })
                  }
                  className="w-16 bg-muted border border-border text-center rounded p-1 text-sm outline-none focus:border-primary"
                />
              </div>
            </div>

            {/* 子模块 2：叙事记忆（Auto Summary 时间轴摘要） */}
            <div className="space-y-3 mt-4 pt-4 border-t border-border/50">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-500/80 uppercase tracking-wide">
                <span className="inline-block w-1 h-3 bg-emerald-500/60 rounded-full" />
                叙事记忆 · 时间轴摘要
              </div>
              <div className="flex items-center justify-between pl-2">
                <div className="flex flex-col">
                  <span className="font-semibold text-foreground text-[13px] flex items-center gap-2">
                    自动记忆整理 (Auto Summary){" "}
                    <Switch
                      checked={settings.memory.summaryTriggerTurns !== 0}
                      onCheckedChange={(val) =>
                        updateSettings({
                          ...settings,
                          memory: {
                            ...settings.memory,
                            summaryTriggerTurns: val ? 10 : 0,
                          },
                        })
                      }
                      className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
                    />
                  </span>
                  <span className="text-[10px] text-muted-foreground mt-0.5">
                    定期梳理记忆，否则默认与上方发送轮数同步整理
                  </span>
                </div>
              </div>
              {settings.memory.summaryTriggerTurns !== 0 && (
                <div className="flex justify-between items-center bg-muted/30 p-2 rounded border border-border">
                  <span className="text-[11px] text-muted-foreground font-semibold">
                    触发轮次 (满多少轮执行一次梳理)
                  </span>
                  <input
                    type="number"
                    min="2"
                    max="100"
                    step="1"
                    value={settings.memory.summaryTriggerTurns}
                    onChange={(e) =>
                      updateSettings({
                        ...settings,
                        memory: {
                          ...settings.memory,
                          summaryTriggerTurns:
                            parseInt(e.target.value) || 2,
                        },
                      })
                    }
                    className="w-16 bg-muted border border-border text-center rounded p-1 text-sm outline-none focus:border-primary"
                  />
                </div>
              )}
            </div>

            {/* 子模块 3：状态记忆（Table Memory 结构化表格） */}
            <div className="space-y-3 mt-4 pt-4 border-t border-border/50">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-sky-500/80 uppercase tracking-wide">
                <span className="inline-block w-1 h-3 bg-sky-500/60 rounded-full" />
                状态记忆 · 结构化表格
              </div>
              <div className="flex items-center justify-between pl-2">
                <div className="flex flex-col">
                  <span className="font-semibold text-foreground text-[13px] flex items-center gap-2">
                    结构化记忆表格 (Table Memory){" "}
                    <Switch
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
                  <span className="text-[10px] text-muted-foreground mt-0.5">
                    将好感、人物关系等属性以表格形式整理并静默喂给 AI 记忆
                  </span>
                </div>
              </div>
              {settings.enableTableMemory && (
                <div className="flex justify-between items-center bg-muted/30 p-2 rounded border border-border">
                  <span className="text-[11px] text-muted-foreground font-semibold">
                    AI 表格检查更新频率 (每几轮对话让 AI 检查并修改数据)
                  </span>
                  <select
                    value={settings.tableMemoryCheckFrequency || 1}
                    onChange={(e) =>
                      updateSettings({
                        ...settings,
                        tableMemoryCheckFrequency: parseInt(e.target.value) || 1,
                      })
                    }
                    className="bg-muted border border-border rounded px-1.5 py-1 text-xs outline-none focus:border-primary font-bold text-foreground"
                  >
                    <option value="1">每 1 轮 (最实时)</option>
                    <option value="3">每 3 轮 (推荐)</option>
                    <option value="5">每 5 轮 (省 token)</option>
                  </select>
                </div>
              )}
            </div>

            <Accordion type="single" collapsible className="w-full mt-4 border-t border-border/50 pt-4">
              <AccordionItem value="advanced-templates" className="border-none">
                <AccordionTrigger className="py-2 hover:no-underline hover:opacity-80 transition justify-between flex w-full">
                  <span className="text-[11px] font-semibold text-foreground">
                    高级整理模板与指令 (Advanced Templates & Prompts)
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pt-3 pb-0 space-y-4">
                  <div className="space-y-1.5">
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

                  <div className="space-y-1.5">
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
                      className="text-xs bg-input/50 min-h-[140px] leading-relaxed font-sans"
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
                        className="text-[10px] text-primary font-bold hover:underline"
                      >
                        重置总结指令为系统默认
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-border/30">
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
                      className="text-xs bg-input/50 min-h-[100px] leading-relaxed font-sans"
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
                        className="text-[10px] text-primary font-bold hover:underline"
                      >
                        重置推理指令为系统默认
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-border/30">
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
                      className="text-xs bg-input/50 min-h-[140px] leading-relaxed font-sans"
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
                        className="text-[10px] text-primary font-bold hover:underline"
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

      <Card className="bg-card border-border shadow-sm">
        <CardHeader
          className="py-3 cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => setShowBackupUI(!showBackupUI)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2 text-foreground">
              <Lock className="w-4 h-4 text-emerald-500" />{" "}
              离线数据全库备份/还原
            </CardTitle>
            <span className="text-muted-foreground text-xs">
              {showBackupUI ? "收起" : "展开"}
            </span>
          </div>
        </CardHeader>
        {showBackupUI && (
          <CardContent className="pt-4 space-y-4 bg-muted/10 border-t border-border/50 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <div className="flex flex-col">
                <span className="text-sm font-semibold flex items-center gap-2 text-destructive">
                  加密导出保护 (XOR强加密)
                </span>
                <span className="text-[10px] text-muted-foreground mt-1">
                  推荐开启以防配置文件侧链泄露
                </span>
              </div>
              <Switch
                checked={encryptBackup}
                onCheckedChange={setEncryptBackup}
                className="data-[state=checked]:bg-destructive"
              />
            </div>

            {encryptBackup && (
              <div className="space-y-1.5 animate-in fade-in duration-300">
                <label className="text-[11px] font-semibold text-foreground">
                  离线全文件核心密钥
                </label>
                <Input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  autoCorrect="off"
                  value={backupPass}
                  onChange={(e) => setBackupPass(e.target.value)}
                  placeholder="务必牢记，否则无法恢复..."
                  className="h-9 placeholder:text-muted-foreground/50 bg-background border-destructive/30 focus-visible:ring-destructive/40 text-xs font-mono"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 text-xs font-bold pt-1">
              <button
                onClick={handleExportLocalDataBackup}
                className="bg-background hover:bg-muted border border-border shadow-sm text-foreground py-2 rounded-md transition flex justify-center items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5 text-primary" />{" "}
                包裹归档提取
              </button>
              <label className="bg-background hover:bg-muted border border-border shadow-sm text-foreground py-2 rounded-md transition flex justify-center items-center gap-1.5 cursor-pointer">
                <Upload className="w-3.5 h-3.5 text-emerald-500" />{" "}
                还原覆盖数据
                <input
                  type="file"
                  onChange={handleImportLocalDataBackup}
                  accept=".backup,.json"
                  className="hidden"
                />
              </label>
            </div>

            {backupStatus && (
              <div className="bg-background border border-border rounded p-2 text-[10px] text-muted-foreground text-center font-mono animate-in fade-in zoom-in-95 duration-200">
                {backupStatus}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <Card className="bg-card border-border shadow-sm mt-4">
        <CardHeader className="pb-3 border-b border-border/50">
          <CardTitle className="text-sm flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary" /> 导入酒馆单会话聊天记录
          </CardTitle>
          <CardDescription className="text-[11px]">
            导入 SillyTavern 单个角色的聊天记录 (.json/.jsonl) 格式文件
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            系统将解析对话记录并与本地角色卡进行绑定。如果本地未导入对应的角色卡，会提示先导入角色卡。
            <br />
            <span className="text-primary font-medium">提示：</span>导入后系统默认关闭这些历史句子的自动总结功能，以避免 API 频宽雪崩。
          </p>
          <div className="flex font-bold text-xs">
            <label className="w-full bg-background hover:bg-muted border border-border shadow-sm text-foreground py-2 rounded-md transition flex justify-center items-center gap-1.5 cursor-pointer">
              <Upload className="w-3.5 h-3.5 text-emerald-500" /> 选择聊天文件并导入
              <input
                type="file"
                onChange={handleImportSillyChatHistory}
                accept=".json,.jsonl"
                className="hidden"
              />
            </label>
          </div>
        </CardContent>
      </Card>

      <UsageDisplay />

      <div className="mt-8 text-center space-y-1 pb-4 opacity-55 select-text font-mono text-[9px] text-muted-foreground/80">
        <p className="font-bold text-[10px] text-muted-foreground mb-1 select-none">
          🛠️ 系统报告
        </p>
        <p>
          当前版本: v1.5.9 • 运行平台: {isTauri ? "Tauri Android 客户端" : "Web 网页端"}
        </p>
        <p>
          设备型号: {deviceModel}
        </p>
        {typeof window !== "undefined" && (
          <p>
            视口尺寸: {viewportSize.w}x{viewportSize.h} (视觉: {Math.round(viewportSize.vW)}x{Math.round(viewportSize.vH)})
          </p>
        )}
        {safeAreas && (
          <p>
            安全区域: 顶部 {safeAreas.top}dp | 底部 {safeAreas.bottom}dp
          </p>
        )}
      </div>
    </>
  );
}
