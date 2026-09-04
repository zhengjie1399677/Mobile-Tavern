import React from "react";
import { Loader2, Terminal } from "lucide-react";
import type { ToolPluginComposerCommand } from "@/src/domain/toolPlugins";

export interface ComposerCommandSuggestionsProps {
  suggestions: readonly ToolPluginComposerCommand[];
  selectedIndex: number;
  isExecuting: boolean;
  onSelectCommand: (command: ToolPluginComposerCommand) => void;
  onHoverIndex: (index: number) => void;
}

export const ComposerCommandSuggestions: React.FC<ComposerCommandSuggestionsProps> = ({
  suggestions,
  selectedIndex,
  isExecuting,
  onSelectCommand,
  onHoverIndex,
}) => {
  if (suggestions.length === 0) return null;

  return (
    <div
      data-ui="composer-command-suggestions"
      className="chat-composer-popover flex w-full max-w-3xl flex-col gap-1 rounded-2xl p-2 animate-fadeIn shadow-2xl border border-primary/20 backdrop-blur-xl"
    >
      <div className="flex items-center justify-between px-1.5 py-0.5 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground flex items-center gap-1.5">
          <Terminal className="size-3.5 text-primary" />
          斜杠命令
        </span>
        <span className="text-[10px] text-muted-foreground/80 font-mono">
          ↑↓ 切换 · Enter / 点击 选取 · Esc 取消
        </span>
      </div>
      <div className="max-h-60 overflow-y-auto space-y-0.5 pr-0.5">
        {suggestions.map((command, idx) => {
          const isSelected = idx === selectedIndex;
          return (
            <button
              key={`${command.pluginId}:${command.name}`}
              type="button"
              disabled={isExecuting}
              onClick={() => onSelectCommand(command)}
              onMouseEnter={() => onHoverIndex(idx)}
              className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${
                isSelected
                  ? "bg-primary/15 border border-primary/30 shadow-sm text-primary"
                  : "hover:bg-muted/50 border border-transparent text-foreground"
              } active:scale-[0.99] disabled:opacity-50`}
            >
              <span
                title={`/${command.name}`}
                className="w-24 max-w-[6rem] sm:w-28 sm:max-w-[7rem] shrink-0 font-mono text-xs sm:text-sm font-semibold text-primary truncate"
              >
                /{command.name}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-semibold">{command.label}</span>
                  {command.pluginId === "host.builtin" ? (
                    <span className="rounded bg-primary/10 px-1 py-0.2 text-[8px] font-medium text-primary">内置</span>
                  ) : (
                    <span className="rounded bg-muted px-1 py-0.2 text-[8px] font-medium text-muted-foreground font-mono">插件</span>
                  )}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">{command.description}</span>
              </span>
              {isExecuting && isSelected && (
                <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
