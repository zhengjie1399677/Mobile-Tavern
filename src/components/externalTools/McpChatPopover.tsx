/**
 * 聊天界面里的 MCP 气泡弹层（Popover）。
 *
 * 取代此前的全屏底部面板：
 *   - 触发按钮就在输入框左侧，点开是锚定在按钮上的气泡，不再被虚拟键盘遮挡；
 *   - 面板内直接做 MCP 设置：来源启停、连通状态、工具清单；
 *   - 选中工具后用输入框草稿自动匹配主参数并显式调用，结果送回对话；
 *   - 高级管理仍跳工作台「扩展能力」，聊天内只保留高频操作。
 */
import React from "react";
import { Popover } from "@base-ui/react/popover";
import {
  ChevronDown,
  ChevronRight,
  Check,
  Loader2,
  Plug,
  Power,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import { Switch } from "../../../components/ui/switch";
import { externalSourceUseCases } from "../../application/externalSources/externalSourceUseCases";
import { syncExternalSourceToolMounts } from "../../application/useCases/externalSourceToolMounting";
import { KernelServices, type IExternalSourceRuntimeService } from "../../application/serviceContracts";
import { useOptionalKernel } from "../../contexts/KernelContext";
import type { ExternalToolDescriptor } from "../../domain/externalSources/contracts";
import {
  resolvePrimaryArgumentKey,
  stringifyExternalToolResult,
  type ExternalToolInvocationPayload,
  type ExternalToolInvocationTarget,
} from "./externalToolInvocation";

interface McpChatPopoverProps {
  /** 当前输入框草稿：用于自动匹配工具与预填查询。 */
  readonly draftText?: string;
  /** 受控打开状态（`/tool` 命令需要主动打开）。 */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly getRuntime: () => IExternalSourceRuntimeService | null;
  readonly onConfirm: (payload: ExternalToolInvocationPayload) => Promise<void>;
  readonly onOpenWorkbench: () => void;
  readonly showAlert: (message: string, title?: string) => Promise<void> | void;
}

interface SourceRow {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly connected: boolean;
  readonly tools: readonly ExternalToolDescriptor[];
}

export const McpChatPopover: React.FC<McpChatPopoverProps> = ({
  draftText,
  open,
  onOpenChange,
  getRuntime,
  onConfirm,
  onOpenWorkbench,
  showAlert,
}) => {
  const kernel = useOptionalKernel();
  const [rows, setRows] = React.useState<SourceRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<ExternalToolInvocationTarget | null>(null);
  const [query, setQuery] = React.useState("");
  const [executing, setExecuting] = React.useState(false);
  const [togglingId, setTogglingId] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const runtime = getRuntime();
      const sources = await externalSourceUseCases.list();
      const next: SourceRow[] = sources.map((source) => {
        const snapshot = runtime?.getSnapshot(source.id) ?? null;
        return {
          id: source.id,
          name: source.displayName,
          enabled: source.enabled,
          connected: Boolean(snapshot),
          tools: snapshot?.tools ?? [],
        };
      });
      setRows(next);
      // 打开时若草稿里出现了某个工具名 / 来源名，直接展开该来源，减少一次点击。
      const lowered = (draftText ?? "").trim().toLowerCase();
      if (lowered) {
        const matched = next.find((row) =>
          lowered.includes(row.name.toLowerCase())
          || row.tools.some((tool) =>
            lowered.includes(tool.localName.toLowerCase())
            || lowered.includes(tool.qualifiedName.toLowerCase()),
          ),
        );
        if (matched) setExpandedId(matched.id);
      }
    } catch (error: unknown) {
      console.warn("[McpChatPopover] 读取 MCP 来源失败", error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [draftText, getRuntime]);

  React.useEffect(() => {
    if (!open) return;
    void reload();
  }, [open, reload]);

  React.useEffect(() => {
    if (open) return;
    // 关闭后清掉临时选择，避免下次打开残留上一次的调用意图。
    setSelected(null);
    setQuery("");
    setExecuting(false);
  }, [open]);

  const handleToggleSource = async (row: SourceRow, enabled: boolean) => {
    if (togglingId) return;
    setTogglingId(row.id);
    try {
      await externalSourceUseCases.setEnabled(row.id, enabled);
      const runtime = getRuntime();
      if (runtime) await runtime.reload();
      if (kernel) {
        try {
          syncExternalSourceToolMounts({ kernel, sourceId: row.id, enabled });
        } catch (error: unknown) {
          console.warn("[McpChatPopover] 同步工具挂载失败", error);
        }
      }
      await reload();
    } catch (error: unknown) {
      await showAlert(
        `${enabled ? "启用" : "停用"} ${row.name} 失败：${error instanceof Error ? error.message : String(error)}`,
        "MCP 设置",
      );
    } finally {
      setTogglingId(null);
    }
  };

  const selectTool = (row: SourceRow, tool: ExternalToolDescriptor) => {
    setSelected({
      sourceId: row.id,
      sourceName: row.name,
      tool,
    });
    setQuery((draftText ?? "").trim());
  };

  const handleInvoke = async () => {
    if (!selected || executing) return;
    const runtime = getRuntime();
    if (!runtime) {
      await showAlert("外部能力运行时未就绪，无法调用。", "调用失败");
      return;
    }
    const primaryKey = resolvePrimaryArgumentKey(selected.tool.inputSchema);
    const trimmed = query.trim();
    const input: Record<string, unknown> = primaryKey ? { [primaryKey]: trimmed } : {};
    setExecuting(true);
    try {
      const response = await runtime.testCallTool(
        selected.sourceId,
        selected.tool.localName,
        input,
      );
      await onConfirm({
        target: selected,
        input,
        query: trimmed,
        resultText: stringifyExternalToolResult(response.result),
        durationMs: response.durationMs,
      });
      onOpenChange(false);
    } catch (error: unknown) {
      await showAlert(
        `调用 ${selected.tool.localName} 失败：${error instanceof Error ? error.message : String(error)}`,
        "调用失败",
      );
    } finally {
      setExecuting(false);
    }
  };

  const enabledCount = rows.filter((row) => row.enabled).length;

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        aria-label="MCP 能力"
        title="MCP 能力"
        className={`flex size-[38px] shrink-0 items-center justify-center rounded-xl border transition-all active:scale-95 ${
          open
            ? "border-primary/40 bg-primary/15 text-primary"
            : "border-border/80 bg-input/30 text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        <Plug className="size-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="top"
          align="start"
          sideOffset={10}
          collisionPadding={10}
          className="z-[1300]"
        >
          <Popover.Popup
            aria-label="MCP 能力面板"
            className="flex max-h-[min(58dvh,26rem)] w-[min(21rem,calc(100vw-1.25rem))] flex-col overflow-hidden rounded-2xl border border-border/80 bg-popover/97 text-popover-foreground shadow-2xl backdrop-blur-xl outline-none animate-in fade-in zoom-in-95 duration-150"
          >
            <header className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-lg bg-primary/12 text-primary">
                  <Sparkles className="size-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-foreground">MCP 能力</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {loading ? "读取中…" : `${enabledCount}/${rows.length} 已启用 · 点工具直接调用`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="刷新 MCP 状态"
                onClick={() => void reload()}
                className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
              >
                <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
              {!loading && rows.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
                  <Plug className="size-5 text-muted-foreground/50" />
                  <p className="text-[11px] text-muted-foreground">
                    还没有接入 MCP 来源
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenChange(false);
                      onOpenWorkbench();
                    }}
                    className="rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/15 active:scale-95"
                  >
                    去工作台接入
                  </button>
                </div>
              ) : (
                <div className="space-y-1">
                  {rows.map((row) => {
                    const expanded = expandedId === row.id;
                    const selectedHere = selected?.sourceId === row.id;
                    return (
                      <div
                        key={row.id}
                        className={`overflow-hidden rounded-xl border transition-colors ${
                          selectedHere ? "border-primary/30 bg-primary/5" : "border-border/50 bg-card/40"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => setExpandedId(expanded ? null : row.id)}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            aria-expanded={expanded}
                          >
                            <span
                              className={`size-1.5 shrink-0 rounded-full ${
                                !row.enabled
                                  ? "bg-muted-foreground/40"
                                  : row.connected
                                    ? "bg-emerald-400"
                                    : "bg-amber-400"
                              }`}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[11.5px] font-semibold text-foreground">
                                {row.name}
                              </span>
                              <span className="block truncate text-[9.5px] text-muted-foreground">
                                {!row.enabled
                                  ? "已停用"
                                  : row.connected
                                    ? `${row.tools.length} 个工具`
                                    : "已启用 · 未连通"}
                              </span>
                            </span>
                            {expanded
                              ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                              : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
                          </button>
                          <Switch
                            aria-label={`${row.enabled ? "停用" : "启用"} ${row.name}`}
                            checked={row.enabled}
                            onCheckedChange={(value: boolean) => void handleToggleSource(row, value)}
                            className="data-[state=checked]:bg-primary h-4 w-7 shrink-0 [&_span]:h-3 [&_span]:w-3"
                          />
                        </div>

                        {expanded && row.enabled && (
                          <div className="space-y-1 border-t border-border/40 bg-black/15 px-2 py-1.5">
                            {row.tools.length === 0 ? (
                              <p className="px-1 py-1 text-[10px] text-muted-foreground">
                                {row.connected ? "该来源未暴露工具" : "尚未连通，稍后重试或到工作台查看诊断"}
                              </p>
                            ) : row.tools.map((tool) => {
                              const active = selected?.tool.qualifiedName === tool.qualifiedName;
                              return (
                                <button
                                  key={tool.qualifiedName}
                                  type="button"
                                  onClick={() => selectTool(row, tool)}
                                  className={`w-full rounded-lg px-2 py-1.5 text-left transition-colors ${
                                    active ? "bg-primary/15 text-primary" : "hover:bg-muted/70"
                                  }`}
                                >
                                  <span className="block truncate text-[11px] font-medium">
                                    {tool.localName}
                                  </span>
                                  <span className="line-clamp-1 block text-[9.5px] text-muted-foreground">
                                    {tool.description || "无描述"}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {selected && (
              <div className="space-y-2 border-t border-border/60 bg-card/60 px-3 py-2.5">
                <p className="truncate text-[10px] font-semibold text-primary">
                  {selected.sourceName} / {selected.tool.localName}
                </p>
                <textarea
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  rows={2}
                  placeholder={resolvePrimaryArgumentKey(selected.tool.inputSchema)
                    ? `输入查询内容（${resolvePrimaryArgumentKey(selected.tool.inputSchema)}）`
                    : "该工具没有可识别的文本参数，可直接调用"}
                  className="w-full resize-none rounded-lg border border-border/70 bg-background/80 px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-primary/50"
                />
                <button
                  type="button"
                  disabled={executing}
                  onClick={() => void handleInvoke()}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary/15 py-1.5 text-[11px] font-bold text-primary transition-colors hover:bg-primary/25 active:scale-[0.99] disabled:opacity-50"
                >
                  {executing
                    ? <Loader2 className="size-3.5 animate-spin" />
                    : <Send className="size-3.5" />}
                  {executing ? "调用中…" : "调用并送入对话"}
                </button>
              </div>
            )}

            <footer className="flex items-center justify-between border-t border-border/60 px-3 py-2">
              <span className="flex items-center gap-1 text-[9.5px] text-muted-foreground">
                <Check className="size-3" />
                结果会作为上下文进入当前会话
              </span>
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onOpenWorkbench();
                }}
                className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Power className="size-3" />
                工作台管理
              </button>
            </footer>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default McpChatPopover;
