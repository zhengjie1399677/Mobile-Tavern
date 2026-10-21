/**
 * 聊天输入区的统一「工具」面板。
 *
 * 背景（2026-10-21 回归修复）：此前「工具」气泡只列输入框命令，`/tool` 又被改写成打开
 * MCP 气泡，导致两个入口功能重复、而模型真正可用的 Tool 在聊天里根本不可见。
 * 现在合并为一个面板的两个分区：
 *
 *   - 自动调用：`resolveSessionEnabledToolNames` 解析出的、模型本轮真正能调用的 Tool（只读）；
 *   - 手动调用：插件注册的输入框命令（可执行）+ 外部能力（MCP）工具（可执行、只回填草稿）。
 *
 * 边界：本组件只做展示与交互；命令过滤按 `owner` 前缀数据驱动，不再维护硬编码工具名白名单。
 */
import React from "react";
import { Popover } from "@base-ui/react/popover";
import {
  Wrench,
  X,
  Search,
  ChevronRight,
  Sparkles,
  ShieldAlert,
  Cpu,
  Plug,
} from "lucide-react";
import { useMobileBackHandler } from "../../../hooks/useMobileBackHandler";
import { useTranslation } from "../../../contexts/LanguageContext";
import type { ComposerCommandDescriptor } from "@/src/domain/composer/contracts";
import type { IExternalSourceRuntimeService } from "@/src/application/serviceContracts";
import { McpPanelContent } from "../../../components/externalTools/McpPanelContent";

export type ToolsPanelTab = "auto" | "manual";

/** 面板展示用的 Tool 摘要：只取公开的展示字段，不携带执行实现。 */
export interface SessionModelToolSummary {
  readonly name: string;
  readonly description: string;
  readonly riskLevel: "low" | "medium" | "high";
  readonly sideEffect: string;
  readonly policy: "allow" | "deny" | "ask";
}

interface ToolsPanelProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** 打开时定位的分区；`/tool` 进自动调用，`/mcp` 进手动调用。 */
  readonly initialTab: ToolsPanelTab;
  readonly disabled?: boolean;
  readonly draftText: string;
  readonly modelTools: readonly SessionModelToolSummary[];
  readonly availableCommands: readonly ComposerCommandDescriptor[];
  readonly onSelectCommand: (command: ComposerCommandDescriptor) => void;
  readonly onInsertData: (data: string) => void;
  readonly onOpenWorkbench: () => void;
  readonly showAlert: (message: string, title?: string) => Promise<void> | void;
  readonly getRuntime: () => IExternalSourceRuntimeService | null;
  readonly externalCapabilitiesEnabled: boolean;
}

/** 工具命令：插件注册的输入框命令由 `tool-plugin/<id>` 归属，宿主内置命令不进入本分区。 */
const TOOL_COMMAND_OWNER_PREFIX = "tool-plugin/";

function riskLabel(risk: SessionModelToolSummary["riskLevel"]): string {
  return risk === "high" ? "高风险" : risk === "medium" ? "中风险" : "低风险";
}

function policyLabel(policy: SessionModelToolSummary["policy"]): string {
  if (policy === "ask") return "需确认";
  if (policy === "deny") return "禁止";
  return "自动放行";
}

export function ToolsPanel({
  open,
  onOpenChange,
  initialTab,
  disabled = false,
  draftText,
  modelTools,
  availableCommands,
  onSelectCommand,
  onInsertData,
  onOpenWorkbench,
  showAlert,
  getRuntime,
  externalCapabilitiesEnabled,
}: ToolsPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const [tab, setTab] = React.useState<ToolsPanelTab>(initialTab);
  const [filterText, setFilterText] = React.useState("");

  useMobileBackHandler(open, () => {
    onOpenChange(false);
    return true;
  }, 960);

  // 每次打开都按入口定位，避免沿用上一次停留的分区。
  React.useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  React.useEffect(() => {
    if (open) return;
    setFilterText("");
  }, [open]);

  const toolCommands = React.useMemo(
    () => availableCommands.filter((command) => command.owner.startsWith(TOOL_COMMAND_OWNER_PREFIX)),
    [availableCommands],
  );

  const filteredModelTools = React.useMemo(() => {
    const term = filterText.trim().toLowerCase();
    if (!term) return modelTools;
    return modelTools.filter((tool) =>
      tool.name.toLowerCase().includes(term) || tool.description.toLowerCase().includes(term));
  }, [filterText, modelTools]);

  const filteredCommands = React.useMemo(() => {
    const term = filterText.trim().toLowerCase();
    if (!term) return toolCommands;
    return toolCommands.filter((command) =>
      command.name.toLowerCase().includes(term)
      || (command.label?.toLowerCase().includes(term) ?? false)
      || (command.description?.toLowerCase().includes(term) ?? false));
  }, [filterText, toolCommands]);

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        aria-label={t("quick_actions.tools_btn") || "工具"}
        title={t("quick_actions.tools_btn") || "工具"}
        disabled={disabled}
        className={`flex h-8 flex-1 min-w-0 items-center justify-center gap-1.5 rounded-lg px-1.5 transition-colors disabled:opacity-40 ${
          open
            ? "bg-primary/12 text-primary"
            : "text-muted-foreground hover:bg-muted/60 hover:text-primary"
        }`}
      >
        <Wrench className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate text-xs font-medium">{t("quick_actions.tools_btn") || "工具"}</span>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={10}
          className="z-[1300]"
        >
          <Popover.Popup
            aria-label="工具面板"
            className="flex max-h-[min(62dvh,28rem)] w-[min(22rem,calc(100vw-1.25rem))] flex-col overflow-hidden rounded-2xl border border-border/80 bg-popover text-popover-foreground shadow-2xl backdrop-blur-xl outline-none animate-in fade-in zoom-in-95 duration-150"
          >
            <header className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-lg bg-primary/12 text-primary">
                  <Wrench className="size-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-foreground">
                    {t("quick_actions.tools_title") || "工具"}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {modelTools.length} 个自动调用 · {toolCommands.length} 个手动命令
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="关闭工具面板"
                onClick={() => onOpenChange(false)}
                className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
              >
                <X className="size-3.5" />
              </button>
            </header>

            <div role="tablist" aria-label="工具分区" className="flex shrink-0 gap-1 border-b border-border/50 px-2 py-1.5">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "auto"}
                onClick={() => setTab("auto")}
                className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${
                  tab === "auto" ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-muted/60"
                }`}
              >
                <Cpu className="size-3.5" />
                自动调用
                <span className="font-mono text-[9.5px] opacity-70">{modelTools.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "manual"}
                onClick={() => setTab("manual")}
                className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${
                  tab === "manual" ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-muted/60"
                }`}
              >
                <Plug className="size-3.5" />
                手动调用
                <span className="font-mono text-[9.5px] opacity-70">{toolCommands.length}</span>
              </button>
            </div>

            {(tab === "auto" ? modelTools.length : toolCommands.length) > 0 && (
              <div className="shrink-0 border-b border-border/50 px-2.5 py-1.5">
                <div className="relative flex items-center">
                  <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    value={filterText}
                    onChange={(event) => setFilterText(event.target.value)}
                    placeholder={t("quick_actions.tools_filter_placeholder") || "搜索工具或命令…"}
                    className="h-7 w-full rounded-lg bg-muted/50 pl-8 pr-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:bg-background focus:outline-hidden focus:ring-1 focus:ring-primary/40"
                  />
                </div>
              </div>
            )}

            {tab === "auto" ? (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
                {filteredModelTools.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-1 px-3 py-6 text-center text-muted-foreground">
                    <Cpu className="h-5 w-5 opacity-40" />
                    <p className="text-[11px] font-medium">当前会话没有可用工具</p>
                    <p className="text-[10px] opacity-80">
                      工具由 Agent Profile 与已启用的插件决定；新建会话后生效。
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="px-1.5 pt-0.5 text-[9.5px] text-muted-foreground">
                      由模型按需自动调用，不需要手动触发
                    </p>
                    {filteredModelTools.map((tool) => (
                      <div
                        key={tool.name}
                        className="rounded-xl border border-border/50 bg-card/40 px-2 py-1.5"
                      >
                        <div className="flex items-center gap-1.5">
                          <Sparkles className="size-3 shrink-0 text-primary" />
                          <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] font-semibold text-foreground">
                            {tool.name}
                          </span>
                          <span
                            className={`shrink-0 rounded px-1 text-[9px] ${
                              tool.riskLevel === "high"
                                ? "bg-rose-500/12 text-rose-300"
                                : tool.riskLevel === "medium"
                                  ? "bg-amber-500/12 text-amber-300"
                                  : "bg-emerald-500/12 text-emerald-300"
                            }`}
                          >
                            {riskLabel(tool.riskLevel)}
                          </span>
                          <span className="shrink-0 rounded bg-muted px-1 text-[9px] text-muted-foreground">
                            {policyLabel(tool.policy)}
                          </span>
                        </div>
                        {tool.description && (
                          <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
                            {tool.description}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="max-h-[38%] shrink-0 overflow-y-auto overscroll-contain border-b border-border/50 p-1.5">
                  <p className="flex items-center gap-1 px-1 pb-1 text-[9.5px] font-semibold text-muted-foreground">
                    <Wrench className="size-3" />
                    插件命令（执行后回填输入框）
                  </p>
                  {filteredCommands.length === 0 ? (
                    <p className="px-1 py-2 text-[10px] text-muted-foreground">
                      还没有可用的插件命令。到工作台安装并启用 Tool 插件后出现。
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {filteredCommands.map((command) => (
                        <button
                          key={command.name}
                          type="button"
                          onClick={() => {
                            onSelectCommand(command);
                            onOpenChange(false);
                          }}
                          className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/70 active:scale-[0.99]"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11px] font-semibold text-foreground">
                              {command.label || command.name}
                              <span className="ml-1 font-mono text-[9.5px] font-normal text-muted-foreground">
                                /{command.name}
                              </span>
                            </span>
                            {command.description && (
                              <span className="mt-0.5 line-clamp-1 block text-[10px] leading-tight text-muted-foreground">
                                {command.description}
                              </span>
                            )}
                          </span>
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 group-hover:text-foreground" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex min-h-0 flex-1 flex-col">
                  {!externalCapabilitiesEnabled && (
                    <p className="flex items-center gap-1 px-3 py-1 text-[9.5px] text-amber-300/90">
                      <ShieldAlert className="size-3" />
                      外部能力总开关关闭时，下方 MCP 分区不可用
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
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export default ToolsPanel;
