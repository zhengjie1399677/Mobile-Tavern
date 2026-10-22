/**
 * 聊天输入区的统一「工具」面板（底部抽屉）。
 *
 * 2026-10-21：合并「工具」与「MCP」两个重复入口。
 * 2026-10-22：拆分「模型可用 / 立即执行」；改为底部抽屉并放大输入与点击目标；
 *            结果只插入数据正文（剥离 Host 执行信封）；搜索类结果可一键接力到抓取类工具。
 *
 * 边界：只做展示与交互；调用统一走应用用例，结果回填草稿不自动发送。
 */
import React from "react";
import {
  Wrench,
  X,
  Search,
  ChevronRight,
  Sparkles,
  Cpu,
  Plug,
  Play,
  Loader2,
  Send,
  Copy,
  Check as CheckIcon,
  ShieldAlert,
  Link2,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/src/components/ui/dialog";
import { useMobileBackHandler } from "../../../hooks/useMobileBackHandler";
import { useTranslation } from "../../../contexts/LanguageContext";
import type { ComposerCommandDescriptor } from "@/src/domain/composer/contracts";
import type { IExternalSourceRuntimeService } from "@/src/application/serviceContracts";
import type { ManualToolInvocationResult } from "@/src/application/useCases/manualToolInvocation";
import { extractResultUrls } from "@/src/application/useCases/toolResultFormatting";
import { McpPanelContent } from "../../../components/externalTools/McpPanelContent";
import {
  buildToolArguments,
  deriveInitialToolArguments,
  findMissingRequiredArguments,
  listToolArgumentFields,
} from "../../../components/externalTools/externalToolInvocation";

export type ToolsPanelTab = "model" | "run" | "mcp";

/** 面板展示用的 Tool 摘要：只取公开的展示字段，不携带执行实现。 */
export interface SessionModelToolSummary {
  readonly name: string;
  readonly description: string;
  readonly riskLevel: "low" | "medium" | "high";
  readonly sideEffect: string;
  readonly policy: "allow" | "deny" | "ask";
}

/** 可手动执行的工具：额外带上公开输入 Schema，用于生成表单。 */
export interface SessionManualToolSummary extends SessionModelToolSummary {
  readonly inputJsonSchema: Readonly<Record<string, unknown>>;
}

interface ToolsPanelProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly initialTab: ToolsPanelTab;
  readonly disabled?: boolean;
  readonly draftText: string;
  readonly modelTools: readonly SessionModelToolSummary[];
  readonly manualTools: readonly SessionManualToolSummary[];
  readonly availableCommands: readonly ComposerCommandDescriptor[];
  readonly onSelectCommand: (command: ComposerCommandDescriptor) => void;
  readonly onInvokeTool: (toolName: string, input: Record<string, unknown>) => Promise<ManualToolInvocationResult>;
  readonly onInsertData: (data: string) => void;
  readonly onOpenWorkbench: () => void;
  readonly showAlert: (message: string, title?: string) => Promise<void> | void;
  readonly getRuntime: () => IExternalSourceRuntimeService | null;
  readonly externalCapabilitiesEnabled: boolean;
}

const TOOL_COMMAND_OWNER_PREFIX = "tool-plugin/";

function riskLabel(risk: SessionModelToolSummary["riskLevel"]): string {
  return risk === "high" ? "高风险" : risk === "medium" ? "中风险" : "低风险";
}

function policyLabel(policy: SessionModelToolSummary["policy"]): string {
  if (policy === "ask") return "需确认";
  if (policy === "deny") return "禁止";
  return "自动放行";
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function RiskBadge({ risk }: { readonly risk: SessionModelToolSummary["riskLevel"] }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
        risk === "high"
          ? "bg-rose-500/12 text-rose-300"
          : risk === "medium"
            ? "bg-amber-500/12 text-amber-300"
            : "bg-emerald-500/12 text-emerald-300"
      }`}
    >
      {riskLabel(risk)}
    </span>
  );
}

export function ToolsPanel({
  open,
  onOpenChange,
  initialTab,
  disabled = false,
  draftText,
  modelTools,
  manualTools,
  availableCommands,
  onSelectCommand,
  onInvokeTool,
  onInsertData,
  onOpenWorkbench,
  showAlert,
  getRuntime,
  externalCapabilitiesEnabled,
}: ToolsPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const [tab, setTab] = React.useState<ToolsPanelTab>(initialTab);
  const [filterText, setFilterText] = React.useState("");
  const [selectedTool, setSelectedTool] = React.useState<SessionManualToolSummary | null>(null);
  const [fieldValues, setFieldValues] = React.useState<Record<string, string | boolean>>({});
  const [runError, setRunError] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);
  const [runResult, setRunResult] = React.useState<ManualToolInvocationResult | null>(null);
  const [copied, setCopied] = React.useState(false);
  const runScrollRef = React.useRef<HTMLDivElement | null>(null);

  useMobileBackHandler(open, () => {
    onOpenChange(false);
    return true;
  }, 960);

  React.useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  React.useEffect(() => {
    if (open) return;
    setFilterText("");
    setSelectedTool(null);
    setFieldValues({});
    setRunError(null);
    setRunResult(null);
    setCopied(false);
  }, [open]);

  const toolCommands = React.useMemo(
    () => availableCommands.filter((command) => command.owner.startsWith(TOOL_COMMAND_OWNER_PREFIX)),
    [availableCommands],
  );

  const term = filterText.trim().toLowerCase();
  const matches = React.useCallback(
    (name: string, description: string) =>
      !term || name.toLowerCase().includes(term) || description.toLowerCase().includes(term),
    [term],
  );

  const filteredModelTools = modelTools.filter((tool) => matches(tool.name, tool.description));
  const filteredManualTools = manualTools.filter((tool) => matches(tool.name, tool.description));
  const filteredCommands = toolCommands.filter((command) =>
    !term
    || command.name.toLowerCase().includes(term)
    || (command.label?.toLowerCase().includes(term) ?? false)
    || (command.description?.toLowerCase().includes(term) ?? false));

  const selectedFields = selectedTool ? listToolArgumentFields(selectedTool.inputJsonSchema) : [];

  const startTool = (tool: SessionManualToolSummary, preset?: Record<string, string | boolean>) => {
    const initial = deriveInitialToolArguments(tool.inputJsonSchema, draftText);
    setSelectedTool(tool);
    setFieldValues({ ...initial, ...(preset ?? {}) });
    setRunError(null);
    setRunResult(null);
    setCopied(false);
    requestAnimationFrame(() => runScrollRef.current?.scrollTo({ top: 0 }));
  };

  const handleRun = async () => {
    if (!selectedTool || running) return;
    const missing = findMissingRequiredArguments(selectedFields, fieldValues);
    if (missing.length > 0) {
      setRunError(`请填写必填参数：${missing.join("、")}`);
      return;
    }
    setRunning(true);
    setRunError(null);
    setRunResult(null);
    try {
      const input = buildToolArguments(selectedFields, fieldValues);
      setRunResult(await onInvokeTool(selectedTool.name, input));
    } catch (error: unknown) {
      setRunResult({
        toolName: selectedTool.name,
        data: error instanceof Error ? error.message : String(error),
        durationMs: 0,
        isError: true,
      });
    } finally {
      setRunning(false);
    }
  };

  // 搜索类结果里的 URL 可以接力给接受 url 参数的工具（典型是网页抓取），
  // 这样「搜索 → 抓取」是一条连续路径，而不是两个互不相干的按钮。
  const urls = runResult && !runResult.isError ? extractResultUrls(runResult.data) : [];
  const linkTool = React.useMemo(
    () => manualTools.find((tool) =>
      tool.name !== selectedTool?.name
      && listToolArgumentFields(tool.inputJsonSchema).some((field) => field.key.toLowerCase() === "url")),
    [manualTools, selectedTool],
  );

  const showFilter = (tab === "model" && modelTools.length > 0)
    || (tab === "run" && (manualTools.length + toolCommands.length) > 0);

  return (
    <>
      <button
        type="button"
        aria-label={t("quick_actions.tools_btn") || "工具"}
        title={t("quick_actions.tools_btn") || "工具"}
        disabled={disabled}
        onClick={() => onOpenChange(true)}
        className={`flex h-8 flex-1 min-w-0 items-center justify-center gap-1.5 rounded-lg px-1.5 transition-colors disabled:opacity-40 ${
          open ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-primary"
        }`}
      >
        <Wrench className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate text-xs font-medium">{t("quick_actions.tools_btn") || "工具"}</span>
      </button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          aria-label="工具面板"
          className="fixed inset-x-0 bottom-0 top-auto left-0 z-[1300] flex h-auto max-h-[86dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl rounded-b-none border-x-0 border-b-0 bg-popover p-0 pb-[max(env(safe-area-inset-bottom),0px)] shadow-2xl sm:max-w-none data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-6 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-bottom-6"
        >
          <DialogTitle className="sr-only">工具面板</DialogTitle>

          <div className="flex shrink-0 justify-center pt-2">
            <span className="h-1 w-10 rounded-full bg-muted-foreground/25" />
          </div>

          <header className="flex items-center justify-between px-4 pb-2 pt-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <Wrench className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-foreground">
                  {t("quick_actions.tools_title") || "工具"}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {modelTools.length} 个模型可用 · {manualTools.length} 个可执行
                </p>
              </div>
            </div>
            <button
              type="button"
              aria-label="关闭工具面板"
              onClick={() => onOpenChange(false)}
              className="flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
            >
              <X className="size-4.5" />
            </button>
          </header>

          <div role="tablist" aria-label="工具分区" className="flex shrink-0 gap-1.5 px-3 pb-2">
            {([
              { id: "model", label: "模型可用", icon: Cpu, count: modelTools.length },
              { id: "run", label: "立即执行", icon: Play, count: manualTools.length },
              { id: "mcp", label: "MCP", icon: Plug, count: null },
            ] as const).map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(item.id)}
                  className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-semibold transition-colors ${
                    active ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-muted/60"
                  }`}
                >
                  <Icon className="size-3.5" />
                  {item.label}
                  {item.count !== null && <span className="font-mono text-[10px] opacity-70">{item.count}</span>}
                </button>
              );
            })}
          </div>

          {showFilter && (
            <div className="shrink-0 px-3 pb-2">
              <div className="relative flex items-center">
                <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
                <input
                  type="search"
                  value={filterText}
                  onChange={(event) => setFilterText(event.target.value)}
                  placeholder={t("quick_actions.tools_filter_placeholder") || "搜索工具或命令…"}
                  className="h-10 w-full rounded-xl border border-border/60 bg-muted/40 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/40 focus:bg-background focus:outline-hidden"
                />
              </div>
            </div>
          )}

          {tab === "model" && (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
              {filteredModelTools.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-1 px-3 py-8 text-center text-muted-foreground">
                  <Cpu className="h-5 w-5 opacity-40" />
                  <p className="text-xs font-medium">本会话没有模型可自动调用的工具</p>
                  <p className="text-[11px] opacity-80">
                    工具由会话创建时的组合快照决定；新启用的插件需要新建会话。
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="px-1 text-[10.5px] text-muted-foreground">
                    由模型按需自动调用，不需要手动触发
                  </p>
                  {filteredModelTools.map((tool) => (
                    <div key={tool.name} className="rounded-xl border border-border/50 bg-card/40 px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="size-3.5 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-semibold text-foreground">
                          {tool.name}
                        </span>
                        <RiskBadge risk={tool.riskLevel} />
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {policyLabel(tool.policy)}
                        </span>
                      </div>
                      {tool.description && (
                        <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                          {tool.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "run" && (
            <div ref={runScrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
              <p className="flex items-center gap-1 px-1 pb-1.5 text-[10.5px] font-semibold text-muted-foreground">
                <Play className="size-3" />
                工具（点一下手动执行一次）
              </p>
              {filteredManualTools.length === 0 ? (
                <p className="px-1 py-2 text-[11px] text-muted-foreground">当前没有可手动执行的工具。</p>
              ) : (
                <div className="space-y-1.5">
                  {filteredManualTools.map((tool) => {
                    const active = selectedTool?.name === tool.name;
                    return (
                      <button
                        key={tool.name}
                        type="button"
                        onClick={() => (active ? setSelectedTool(null) : startTool(tool))}
                        className={`flex min-h-[3.25rem] w-full items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
                          active
                            ? "border-primary/40 bg-primary/10"
                            : "border-border/50 bg-card/40 hover:bg-muted/60"
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate font-mono text-[11.5px] font-semibold text-foreground">
                              {tool.name}
                            </span>
                            <RiskBadge risk={tool.riskLevel} />
                            {tool.policy !== "allow" && (
                              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {policyLabel(tool.policy)}
                              </span>
                            )}
                          </span>
                          {tool.description && (
                            <span className="mt-0.5 line-clamp-1 block text-[11px] leading-tight text-muted-foreground">
                              {tool.description}
                            </span>
                          )}
                        </span>
                        <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground/50 ${active ? "rotate-90" : ""}`} />
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedTool && (
                <div className="mt-2 space-y-2.5 rounded-2xl border border-primary/25 bg-card/50 px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-mono text-[11px] font-semibold text-primary">
                      {selectedTool.name}
                    </p>
                    <button
                      type="button"
                      aria-label="收起执行表单"
                      onClick={() => {
                        setSelectedTool(null);
                        setRunResult(null);
                        setRunError(null);
                      }}
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
                    >
                      <X className="size-4" />
                    </button>
                  </div>

                  {selectedFields.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">该工具不需要参数，可直接执行。</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedFields.map((field) => (
                        <label key={field.key} className="block space-y-1">
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <span className="font-mono text-foreground">{field.key}</span>
                            {field.required && <span className="text-rose-400">*</span>}
                            {field.description && (
                              <span className="truncate opacity-80">· {field.description}</span>
                            )}
                          </span>
                          {field.type === "boolean" ? (
                            <span className="flex h-10 items-center justify-between rounded-xl border border-border/70 bg-background/80 px-3">
                              <span className="text-xs text-muted-foreground">开关</span>
                              <input
                                type="checkbox"
                                aria-label={field.key}
                                checked={fieldValues[field.key] === true}
                                onChange={(event) => {
                                  setFieldValues((current) => ({ ...current, [field.key]: event.target.checked }));
                                  setRunError(null);
                                }}
                                className="size-5 rounded border-border accent-primary"
                              />
                            </span>
                          ) : field.type === "json" ? (
                            <textarea
                              value={String(fieldValues[field.key] ?? "")}
                              onChange={(event) => {
                                setFieldValues((current) => ({ ...current, [field.key]: event.target.value }));
                                setRunError(null);
                              }}
                              rows={3}
                              spellCheck={false}
                              placeholder={field.description || "{ }"}
                              className="w-full resize-none rounded-xl border border-border/70 bg-background/80 px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary/50"
                            />
                          ) : (
                            <input
                              autoFocus={field.primary}
                              type={field.type === "number" ? "number" : "text"}
                              inputMode={field.type === "number" ? "decimal" : undefined}
                              enterKeyHint="go"
                              value={String(fieldValues[field.key] ?? "")}
                              onChange={(event) => {
                                setFieldValues((current) => ({ ...current, [field.key]: event.target.value }));
                                setRunError(null);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void handleRun();
                                }
                              }}
                              placeholder={field.description || field.key}
                              className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm text-foreground outline-none focus:border-primary/50"
                            />
                          )}
                        </label>
                      ))}
                    </div>
                  )}

                  {runError && <p className="text-[11px] font-medium text-rose-400">{runError}</p>}

                  {runResult ? (
                    <div className="space-y-2">
                      <div
                        className={`rounded-xl border px-3 py-2 ${
                          runResult.isError
                            ? "border-rose-500/30 bg-rose-500/10"
                            : "border-emerald-500/25 bg-emerald-500/8"
                        }`}
                      >
                        <p className={`text-[11px] font-semibold ${runResult.isError ? "text-rose-300" : "text-emerald-300"}`}>
                          {runResult.isError ? "执行失败" : `执行成功 · 耗时 ${runResult.durationMs}ms`}
                        </p>
                        <pre className="mt-1 max-h-40 overflow-y-auto overscroll-contain whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-foreground/90">
                          {runResult.data.slice(0, 2000)}
                        </pre>
                      </div>

                      {linkTool && urls.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-[10.5px] text-muted-foreground">
                            用 {linkTool.name} 继续抓取正文：
                          </p>
                          {urls.map((url) => (
                            <button
                              key={url}
                              type="button"
                              onClick={() => startTool(linkTool, { url })}
                              className="flex h-10 w-full items-center gap-2 rounded-xl border border-primary/25 bg-primary/8 px-3 text-left transition-colors hover:bg-primary/15 active:scale-[0.99]"
                            >
                              <Link2 className="size-3.5 shrink-0 text-primary" />
                              <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
                                {hostnameOf(url)}
                              </span>
                              <ChevronRight className="size-3.5 shrink-0 text-primary/70" />
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center gap-1.5">
                        {!runResult.isError && (
                          <button
                            type="button"
                            onClick={() => {
                              onInsertData(runResult.data);
                              onOpenChange(false);
                            }}
                            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary/15 text-sm font-bold text-primary transition-colors hover:bg-primary/25 active:scale-[0.99]"
                          >
                            <Send className="size-4" />
                            插入输入框
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard?.writeText(runResult.data)
                              .then(() => setCopied(true))
                              .catch(() => undefined);
                          }}
                          className="flex h-11 items-center justify-center gap-1 rounded-xl border border-border/70 px-3 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          {copied ? <CheckIcon className="size-4" /> : <Copy className="size-4" />}
                          {copied ? "已复制" : "复制"}
                        </button>
                        <button
                          type="button"
                          disabled={running}
                          onClick={() => void handleRun()}
                          className="h-11 rounded-xl border border-border/70 px-3 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                        >
                          重试
                        </button>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {runResult.isError
                          ? "失败结果不会进入对话；修改参数后重试。"
                          : "只把结果正文插入输入框，可编辑后再发送。"}
                      </p>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={running}
                      onClick={() => void handleRun()}
                      className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-primary/15 text-sm font-bold text-primary transition-colors hover:bg-primary/25 active:scale-[0.99] disabled:opacity-50"
                    >
                      {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                      {running ? "执行中…" : "执行"}
                    </button>
                  )}
                </div>
              )}

              <div className="mt-3 border-t border-border/50 pt-2">
                <p className="flex items-center gap-1 px-1 pb-1.5 text-[10.5px] font-semibold text-muted-foreground">
                  <Wrench className="size-3" />
                  插件命令（执行后回填输入框）
                </p>
                {filteredCommands.length === 0 ? (
                  <p className="px-1 py-2 text-[11px] text-muted-foreground">
                    还没有可用的插件命令。到工作台安装并启用 Tool 插件后出现。
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {filteredCommands.map((command) => (
                      <button
                        key={command.name}
                        type="button"
                        onClick={() => {
                          onSelectCommand(command);
                          onOpenChange(false);
                        }}
                        className="group flex min-h-[3.25rem] w-full items-center gap-2 rounded-xl border border-border/50 bg-card/40 px-3 py-2 text-left transition-colors hover:bg-muted/60 active:scale-[0.99]"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-foreground">
                            {command.label || command.name}
                            <span className="ml-1 font-mono text-[10px] font-normal text-muted-foreground">
                              /{command.name}
                            </span>
                          </span>
                          {command.description && (
                            <span className="mt-0.5 line-clamp-1 block text-[11px] leading-tight text-muted-foreground">
                              {command.description}
                            </span>
                          )}
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 group-hover:text-foreground" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "mcp" && (
            <div className="flex min-h-0 flex-1 flex-col">
              {!externalCapabilitiesEnabled && (
                <p className="flex items-center gap-1 px-4 pb-1 text-[10.5px] text-amber-300/90">
                  <ShieldAlert className="size-3" />
                  外部能力总开关关闭时，MCP 分区不可用
                </p>
              )}
              <McpPanelContent
                draftText={draftText}
                enabled={externalCapabilitiesEnabled}
                getRuntime={getRuntime}
                onInsertData={onInsertData}
                onOpenWorkbench={onOpenWorkbench}
                showAlert={showAlert}
                onRequestClose={() => onOpenChange(false)}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default ToolsPanel;
