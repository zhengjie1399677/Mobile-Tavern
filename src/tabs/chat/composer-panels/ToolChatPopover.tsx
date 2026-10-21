import React from "react";
import { Popover } from "@base-ui/react/popover";
import {
  Wrench,
  Search,
  FileText,
  Dices,
  CircleDot,
  Shuffle,
  AlignLeft,
  Clock,
  Sparkles,
  X,
  ChevronRight,
  Send,
} from "lucide-react";
import { useMobileBackHandler } from "../../../hooks/useMobileBackHandler";
import { useTranslation } from "../../../contexts/LanguageContext";
import type { ComposerCommandDescriptor } from "@/src/domain/composer/contracts";

interface ToolChatPopoverProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly disabled?: boolean;
  readonly availableCommands: readonly ComposerCommandDescriptor[];
  readonly onSelectCommand: (command: ComposerCommandDescriptor, prefillArg?: string) => void;
}

function getToolIcon(name: string): React.ComponentType<{ className?: string }> {
  switch (name) {
    case "search":
      return Search;
    case "fetch":
      return FileText;
    case "dice":
      return Dices;
    case "coin":
      return CircleDot;
    case "pick":
      return Shuffle;
    case "count":
      return AlignLeft;
    case "time":
      return Clock;
    default:
      return Sparkles;
  }
}

export function ToolChatPopover({
  open,
  onOpenChange,
  disabled = false,
  availableCommands,
  onSelectCommand,
}: ToolChatPopoverProps): React.JSX.Element {
  const { t } = useTranslation();
  const [filterText, setFilterText] = React.useState("");

  useMobileBackHandler(open, () => {
    onOpenChange(false);
    return true;
  }, 870);

  // 过滤掉普通对话控制命令（如 reroll, continue, new 等），只保留工具类命令
  const toolCommands = React.useMemo(() => {
    const builtinToolNames = new Set(["search", "fetch", "dice", "coin", "pick", "count", "time", "tool"]);
    return availableCommands.filter((cmd) => {
      const isTool = builtinToolNames.has(cmd.name) || cmd.owner.startsWith("tool-plugin");
      if (!isTool) return false;
      if (!filterText.trim()) return true;
      const term = filterText.trim().toLowerCase();
      return (
        cmd.name.toLowerCase().includes(term) ||
        (cmd.label && cmd.label.toLowerCase().includes(term)) ||
        (cmd.description && cmd.description.toLowerCase().includes(term))
      );
    });
  }, [availableCommands, filterText]);

  const handlePick = (cmd: ComposerCommandDescriptor) => {
    onSelectCommand(cmd);
    onOpenChange(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        aria-label="工具插件"
        title="工具插件"
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
            className="flex max-h-[70vh] w-[320px] max-w-[92vw] flex-col overflow-hidden rounded-2xl border border-border/80 bg-popover text-popover-foreground shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
          >
            {/* 头部 */}
            <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-primary" />
                <span className="text-xs font-bold text-foreground">
                  {t("quick_actions.tools_title") || "可用工具插件"}
                </span>
                <span className="rounded-full bg-primary/10 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-primary">
                  {toolCommands.length}
                </span>
              </div>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => onOpenChange(false)}
                className="flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground active:scale-95"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* 搜索过滤框 */}
            <div className="border-b border-border/50 px-2.5 py-2">
              <div className="relative flex items-center">
                <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder={t("quick_actions.tools_filter_placeholder") || "搜索工具或命令…"}
                  className="h-7 w-full rounded-lg bg-muted/50 pl-8 pr-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:bg-background focus:outline-hidden focus:ring-1 focus:ring-primary/40"
                />
              </div>
            </div>

            {/* 工具列表 */}
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
              {toolCommands.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
                  <Wrench className="h-6 w-6 opacity-40 mb-1" />
                  <p className="text-xs font-medium">
                    {t("quick_actions.tools_empty") || "暂无匹配的插件工具"}
                  </p>
                </div>
              ) : (
                toolCommands.map((cmd) => {
                  const Icon = getToolIcon(cmd.name);
                  return (
                    <button
                      key={cmd.name}
                      type="button"
                      onClick={() => handlePick(cmd)}
                      className="group flex w-full items-start gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-muted/70 active:scale-[0.99]"
                    >
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-foreground truncate">
                            {cmd.label || cmd.name}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground/75">
                            /{cmd.name}
                          </span>
                        </div>
                        {cmd.description && (
                          <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5 leading-tight">
                            {cmd.description}
                          </p>
                        )}
                      </div>
                      <div className="mt-1 shrink-0 text-muted-foreground/50 group-hover:text-foreground">
                        <ChevronRight className="h-3.5 w-3.5" />
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
