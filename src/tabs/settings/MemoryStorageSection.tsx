import { Database, Lock, MessageSquare, Download, Upload } from "lucide-react";
import { useState } from "react";
import { getDB } from "../../utils/localDB";
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
    | "showCustomAlert"
    | "getKernelService"
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
  showCustomAlert,
  isTauri,
  deviceModel,
  viewportSize,
  getKernelService,
}: MemoryStorageSectionProps) {
  const [diagnoseLog, setDiagnoseLog] = useState<string>("");
  const [isChecking, setIsChecking] = useState(false);

  const runSelfCheck = async () => {
    setIsChecking(true);
    let logLines: string[] = [];
    const log = (text: string) => {
      logLines.push(text);
      setDiagnoseLog(logLines.join("\n"));
    };

    log(`[${new Date().toISOString()}] =================================`);
    log(`[SYSTEM DIAGNOSTIC START] Running local environment verification...`);
    log(`=================================================`);

    // 1. IndexedDB Test
    log(`\n[DB] Testing IndexedDB connection and write-ahead CRUD...`);
    try {
      const db = await getDB();
      log(`[DB] SUCCESS: IndexedDB opened. DB: ${db.name} (v${db.version})`);
      log(`[DB] ObjectStores: ${Array.from(db.objectStoreNames).join(", ")}`);
      
      const writeStart = Date.now();
      const writeTx = db.transaction(["settings"], "readwrite");
      const writeStore = writeTx.objectStore("settings");
      await new Promise<void>((resolve, reject) => {
        const req = writeStore.put({ id: "diagnose_transient_key", value: Date.now() }, "diagnose_transient_key");
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      const writeLatency = Date.now() - writeStart;
      log(`[DB] SUCCESS: Transient record written. Latency: ${writeLatency}ms`);

      const deleteTx = db.transaction(["settings"], "readwrite");
      const deleteStore = deleteTx.objectStore("settings");
      await new Promise<void>((resolve, reject) => {
        const req = deleteStore.delete("diagnose_transient_key");
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      log(`[DB] SUCCESS: Transient record deleted.`);
      log(`[DB] Database health: EXCELLENT`);
    } catch (err: any) {
      log(`[DB] ERROR: Database operation failed!`);
      log(`[DB] Details: ${err?.stack || err?.message || err}`);
    }

    // 2. Native Bridge Check
    log(`\n[BRIDGE] Verifying Native Webview bridge interfaces...`);
    const w = window as any;
    if (w.AndroidThemeBridge) {
      log(`[BRIDGE] SUCCESS: window.AndroidThemeBridge detected.`);
      const methods = Object.getOwnPropertyNames(w.AndroidThemeBridge).filter((p: string) => typeof w.AndroidThemeBridge[p] === 'function');
      log(`[BRIDGE] Available methods: ${methods.join(", ")}`);
    } else {
      log(`[BRIDGE] WARNING: window.AndroidThemeBridge is undefined.`);
      log(`[BRIDGE] Status: Standard browser web environment (Simulated mode). APK features disabled.`);
    }

    // 3. Audio & Speech engines
    log(`\n[SPEECH] Checking local Speech Synthesis and Recognition engines...`);
    const hasTTS = typeof window !== "undefined" && !!window.speechSynthesis;
    const hasASR = typeof window !== "undefined" && (!!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition);
    log(`[SPEECH] TTS (SpeechSynthesis): ${hasTTS ? "SUPPORTED (OK)" : "UNSUPPORTED (ERROR)"}`);
    log(`[SPEECH] ASR (SpeechRecognition): ${hasASR ? "SUPPORTED (OK)" : "UNSUPPORTED (WARNING: WebSpeech recognition unavailable)"}`);

    // 4. Kernel Services
    log(`\n[KERNEL] Checking micro-kernel services registry...`);
    const coreServices = ["database", "memory", "bgm", "tts", "asr", "updateCheck"];
    for (const name of coreServices) {
      try {
        const s = getKernelService(name);
        if (s) {
          log(`[KERNEL] Service "${name}": INITIALIZED (OK)`);
        } else {
          log(`[KERNEL] Service "${name}": NOT FOUND (WARNING)`);
        }
      } catch (err: any) {
        log(`[KERNEL] Service "${name}": RESOLUTION ERROR: ${err.message}`);
      }
    }

    // 5. LLM API Ping
    log(`\n[LLM API] Testing connection endpoint: ${settings.api?.baseUrl || "https://api.openai.com/v1"}`);
    if (!settings.api?.apiKey) {
      log(`[LLM API] WARNING: apiKey is empty. Remote requests will fail.`);
    } else {
      const maskedKey = settings.api.apiKey.length > 8 ? `${settings.api.apiKey.substring(0, 4)}...${settings.api.apiKey.substring(settings.api.apiKey.length - 4)}` : "***";
      log(`[LLM API] apiKey length: ${settings.api.apiKey.length} (${maskedKey}). Type: ${settings.api.type || "openai-compat"}`);
      try {
        const pingStart = Date.now();
        const { universalFetch } = await import("../../utils/apiClient");
        const response = await universalFetch("/api/test-connection", {
          baseUrl: settings.api.baseUrl,
          apiKey: settings.api.apiKey,
          modelName: settings.api.modelName,
          chatPath: settings.api.chatPath,
          bypassProxy: settings.api.bypassProxy,
          forceBasicParams: settings.api.forceBasicParams,
        });
        const latency = Date.now() - pingStart;
        const status = response.status;
        
        let data: any = null;
        let rawText = "";
        try {
          rawText = await response.text();
          const contentType = response.headers.get("content-type") || "";
          if (contentType.includes("application/json") || (rawText.trim().startsWith("{") && rawText.trim().endsWith("}"))) {
            data = JSON.parse(rawText);
          }
        } catch (e: any) {
          // Fallback if reading text fails
        }

        if (response.ok && data?.success) {
          log(`[LLM API] SUCCESS: Connection verified. HTTP ${status}. Latency: ${latency}ms`);
          log(`[LLM API] Message: ${data.message || "Connected"}`);
        } else {
          log(`[LLM API] ERROR: Connection failed with HTTP status ${status}.`);
          if (data) {
            log(`[LLM API] Details: ${data.error || JSON.stringify(data)}`);
          } else {
            const cleanText = rawText.trim();
            const snippet = cleanText.length > 300 ? cleanText.substring(0, 300) + "... [truncated]" : cleanText;
            log(`[LLM API] Raw response payload: ${snippet || "(empty response)"}`);
            
            // Standard relay diagnostics guidance
            if (status === 502) {
              log(`[LLM API] DIAGNOSIS: 502 Bad Gateway. The proxy server is running, but it cannot connect to the target LLM upstream API. (e.g. proxy server network issue, target API block, or upstream downtime)`);
            } else if (status === 504) {
              log(`[LLM API] DIAGNOSIS: 504 Gateway Timeout. The proxy server timed out waiting for the target LLM upstream API to respond.`);
            } else if (status === 403) {
              log(`[LLM API] DIAGNOSIS: 403 Forbidden. The request was rejected by Cloudflare, local firewall CORS, or credentials restriction.`);
            } else if (status === 404) {
              log(`[LLM API] DIAGNOSIS: 404 Not Found. The endpoint URL path might be incorrect. Please verify base URL and endpoint paths.`);
            }
          }
        }
      } catch (err: any) {
        log(`[LLM API] ERROR: Ping request failed.`);
        log(`[LLM API] Details: ${err?.stack || err?.message || err}`);
      }
    }

    log(`\n=================================================`);
    log(`[SYSTEM DIAGNOSTIC COMPLETE] All tests executed.`);
    log(`=================================================`);
    setIsChecking(false);
  };

  return (
    <>
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

      <Card className="bg-card border-border shadow-sm mt-2">
        <CardHeader
          className="py-2.5 px-3 cursor-pointer hover:bg-muted/50 transition-colors border-b border-border/40"
          onClick={() => setShowBackupUI(!showBackupUI)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs flex items-center gap-2 font-bold text-foreground">
              <Lock className="w-4 h-4 text-emerald-500" />{" "}
              离线数据全库备份/还原
            </CardTitle>
            <span className="text-muted-foreground text-[10px]">
              {showBackupUI ? "收起" : "展开"}
            </span>
          </div>
        </CardHeader>
        {showBackupUI && (
          <CardContent className="pt-3 px-3 pb-3 space-y-3 bg-muted/10 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center justify-between border-b border-border/20 pb-2.5">
              <div className="flex flex-col">
                <span className="text-sm font-semibold flex items-center gap-2 text-destructive">
                  加密导出保护 (XOR强加密)
                </span>
                <span className="text-[9px] text-muted-foreground mt-0.5">
                  推荐开启以防配置文件侧链泄露
                </span>
              </div>
              <Switch
                aria-label="加密导出保护"
                checked={encryptBackup}
                onCheckedChange={setEncryptBackup}
                className="data-[state=checked]:bg-destructive"
              />
            </div>

            {encryptBackup && (
              <div className="space-y-1 animate-in fade-in duration-300">
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
                  accept=".backup,.json,.jsonl,.txt,.bin,application/json,text/plain"
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

      <Card className="bg-card border-border shadow-sm mt-2">
        <CardHeader className="pb-2.5 border-b border-border/50 px-3 pt-3">
          <CardTitle className="text-xs flex items-center gap-2 font-bold text-foreground">
            <MessageSquare className="w-4 h-4 text-primary" /> 导入酒馆单会话聊天记录
          </CardTitle>
          <CardDescription className="text-[10px] mt-0.5">
            导入 SillyTavern 单个角色的聊天记录 (.json/.jsonl) 格式文件
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-3 px-3 pb-3 space-y-3">
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
                accept=".json,.jsonl,.txt,.bin,application/json,text/plain"
                className="hidden"
              />
            </label>
          </div>
        </CardContent>
      </Card>

      <UsageDisplay />

      <div className="mt-6 text-center space-y-1 pb-4 select-text font-mono text-[9px] text-muted-foreground/80">
        <p className="font-bold text-[10px] text-muted-foreground mb-1 select-none flex items-center justify-center gap-1">
          🛠️ 系统报告
          <button
            onClick={() => {
              const reportText = [
                `当前版本: v${__APP_VERSION__}`,
                `运行平台: ${isTauri ? "Tauri Android 客户端" : "Web 网页端"}`,
                `设备型号: ${deviceModel}`,
                typeof window !== "undefined" ? `视口尺寸: ${viewportSize.w}x${viewportSize.h} (视觉: ${Math.round(viewportSize.vW)}x${Math.round(viewportSize.vH)})` : null,
                safeAreas ? `安全区域: 顶部 ${safeAreas.top}dp | 底部 ${safeAreas.bottom}dp` : null,
                `安卓桥接: ${typeof window !== "undefined" && (window as any).AndroidThemeBridge ? "已注入 (Success)" : "未注入/不支持 (None)"}`,
                `UA 信息: ${typeof navigator !== "undefined" ? navigator.userAgent : "N/A"}`,
                `TTS 配置: ${settings.ttsConfig?.enabled ? `开启 (${settings.ttsConfig.provider || "speech-synthesis"})` : "关闭"}`,
                `ASR 配置: ${settings.asrConfig?.enabled ? `开启 (${settings.asrConfig.provider || "web-speech"})` : "关闭"}`,
                `生图配置: ${settings.imageGenApi?.enabled ? `开启 (${settings.imageGenApi.type || "openai-dalle"})` : "关闭"}`,
                `主 API 接口: ${settings.api?.baseUrl ? `已配 (Base: ${settings.api.baseUrl.replace(/^(https?:\/\/[^\/]+).*$/, "$1")}...)` : "未配置"}`
              ].filter(Boolean).join("\n");

              let copyText = reportText;
              if (diagnoseLog) {
                copyText += `\n\n=================================\n🛠️ 系统自检诊断日志 (DEBUGLOG)\n=================================\n${diagnoseLog}`;
              }

              if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(copyText);
              } else {
                const textarea = document.createElement("textarea");
                textarea.value = copyText;
                document.body.appendChild(textarea);
                textarea.select();
                try {
                  document.execCommand("copy");
                } catch (_) {}
                document.body.removeChild(textarea);
              }
              showCustomAlert(diagnoseLog ? "系统报告及自检日志已成功复制到剪贴板！" : "系统报告已成功复制到剪贴板！", "复制成功");
            }}
            className="text-[9px] text-primary hover:underline font-normal cursor-pointer select-none px-1.5 py-0.5 border border-primary/20 rounded bg-primary/5 hover:bg-primary/10 ml-1.5 active:scale-95 transition-all"
          >
            复制报告
          </button>
          <button
            onClick={runSelfCheck}
            disabled={isChecking}
            className="text-[9px] text-emerald-500 hover:underline font-normal cursor-pointer select-none px-1.5 py-0.5 border border-emerald-500/20 rounded bg-emerald-500/5 hover:bg-emerald-500/10 ml-1 active:scale-95 transition-all disabled:opacity-55"
          >
            {isChecking ? "自检中..." : "开始自检"}
          </button>
        </p>
        <p className="opacity-55">
          当前版本: v{__APP_VERSION__} • 运行平台: {isTauri ? "Tauri Android 客户端" : "Web 网页端"}
        </p>
        <p className="opacity-55">
          设备型号: {deviceModel}
        </p>
        {typeof window !== "undefined" && (
          <p className="opacity-55">
            视口尺寸: {viewportSize.w}x{viewportSize.h} (视觉: {Math.round(viewportSize.vW)}x{Math.round(viewportSize.vH)})
          </p>
        )}
        {safeAreas && (
          <p className="opacity-55">
            安全区域: 顶部 {safeAreas.top}dp | 底部 {safeAreas.bottom}dp
          </p>
        )}

        {diagnoseLog && (
          <div className="mt-3 text-left p-2.5 bg-zinc-950/90 border border-zinc-800 rounded-lg text-zinc-300 font-sans tracking-wide overflow-x-auto max-w-full shadow-inner leading-relaxed">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-1 mb-1.5 text-[8px] font-bold text-zinc-500 select-none">
              <span>🛠️ 系统自检诊断日志 (DEBUGLOG)</span>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (navigator.clipboard?.writeText) {
                      navigator.clipboard.writeText(diagnoseLog);
                    }
                    showCustomAlert("自检日志已成功复制到剪贴板！", "复制成功");
                  }}
                  className="text-primary hover:underline text-[8px]"
                >
                  [复制日志]
                </button>
                <button
                  onClick={() => setDiagnoseLog("")}
                  className="text-zinc-500 hover:text-zinc-400 text-[8px]"
                >
                  [清除]
                </button>
              </div>
            </div>
            <pre className="whitespace-pre-wrap break-all select-text font-mono text-[8.5px] leading-relaxed text-zinc-300">{diagnoseLog}</pre>
          </div>
        )}
      </div>
    </>
  );
}
