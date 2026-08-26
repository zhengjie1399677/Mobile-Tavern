import React from "react";
import { Wrench, ChevronDown, ChevronUp, CheckCircle2, AlertCircle, Loader2, Terminal } from "lucide-react";
import type { AgentJournalEvent } from "@/src/domain/agents/contracts";
import { useTranslation } from "../../../contexts/LanguageContext";

interface ToolCallBlockProps {
  events?: readonly AgentJournalEvent[];
}

const MAX_PAYLOAD_LENGTH = 1500;

function formatJsonPayload(data: unknown): string {
  if (data === undefined || data === null) return "";
  try {
    const raw = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    if (raw.length > MAX_PAYLOAD_LENGTH) {
      return raw.slice(0, MAX_PAYLOAD_LENGTH) + `\n... [数据已截断 (${raw.length} 字符)]`;
    }
    return raw;
  } catch (_) {
    return String(data);
  }
}

export function ToolCallBlock({ events }: ToolCallBlockProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = React.useState(false);

  const toolEvents = React.useMemo(() => {
    if (!events || events.length === 0) return [];
    return events.filter(
      (evt) => evt.type === "tool.called" || evt.type === "tool.result" || evt.type === "tool.failed"
    );
  }, [events]);

  if (toolEvents.length === 0) return null;

  // Group events by callId
  const callsMap = new Map<string, {
    callId: string;
    toolName: string;
    arguments?: unknown;
    result?: unknown;
    error?: string;
    status: "running" | "completed" | "failed";
  }>();

  for (const evt of toolEvents) {
    if (evt.type === "tool.called") {
      callsMap.set(evt.callId, {
        callId: evt.callId,
        toolName: evt.toolName,
        arguments: evt.arguments,
        status: "running",
      });
    } else if (evt.type === "tool.result") {
      const existing = callsMap.get(evt.callId);
      if (existing) {
        existing.result = evt.result;
        existing.status = "completed";
      }
    } else if (evt.type === "tool.failed") {
      const existing = callsMap.get(evt.callId);
      if (existing) {
        existing.error = evt.errorMessage;
        existing.status = "failed";
      }
    }
  }

  const calls = Array.from(callsMap.values());
  if (calls.length === 0) return null;

  const totalCalls = calls.length;
  const runningCount = calls.filter((c) => c.status === "running").length;
  const failedCount = calls.filter((c) => c.status === "failed").length;

  return (
    <div className="my-2 rounded-xl border border-primary/20 bg-primary/5 p-2.5 text-xs text-foreground/90 shadow-sm transition-all">
      <div
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex items-center justify-between cursor-pointer select-none"
      >
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 text-primary">
            {runningCount > 0 ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wrench className="h-3.5 w-3.5" />
            )}
          </div>
          <span className="font-semibold text-foreground/90 text-[11px] font-mono">
            {runningCount > 0
              ? t("message_bubble.tool_executing", { current: String(runningCount), total: String(totalCalls) })
              : t("message_bubble.tool_called", { total: String(totalCalls) })}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {failedCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-rose-500 font-medium bg-rose-500/10 px-1.5 py-0.5 rounded">
              <AlertCircle className="w-3 h-3" /> {t("message_bubble.tool_failed", { count: String(failedCount) })}
            </span>
          )}
          {runningCount === 0 && failedCount === 0 && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-500 font-medium bg-emerald-500/10 px-1.5 py-0.5 rounded">
              <CheckCircle2 className="w-3 h-3" /> {t("message_bubble.tool_completed")}
            </span>
          )}
          <button type="button" className="text-muted-foreground hover:text-foreground">
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-2.5 space-y-2 border-t border-primary/15 pt-2 animate-in fade-in slide-in-from-top-1 duration-150">
          {calls.map((call) => (
            <div key={call.callId} className="rounded-lg border border-border/50 bg-background/60 p-2 text-[11px] font-mono space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-bold text-primary flex items-center gap-1">
                  <Terminal className="w-3 h-3" /> {call.toolName}
                </span>
                <span className="text-muted-foreground text-[9px]">{call.status}</span>
              </div>
              {Boolean(call.arguments) && (
                <div className="text-[10px] text-muted-foreground bg-muted/40 p-1.5 rounded overflow-x-auto">
                  <span className="text-[9px] font-sans font-semibold text-muted-foreground/80 block mb-0.5">{t("message_bubble.tool_input")}</span>
                  <pre className="whitespace-pre-wrap leading-tight max-h-48 overflow-y-auto custom-scrollbar">{formatJsonPayload(call.arguments)}</pre>
                </div>
              )}
              {Boolean(call.result) && (
                <div className="text-[10px] text-foreground/90 bg-emerald-500/5 border border-emerald-500/20 p-1.5 rounded overflow-x-auto">
                  <span className="text-[9px] font-sans font-semibold text-emerald-600 dark:text-emerald-400 block mb-0.5">{t("message_bubble.tool_result")}</span>
                  <pre className="whitespace-pre-wrap leading-tight max-h-48 overflow-y-auto custom-scrollbar">{formatJsonPayload(call.result)}</pre>
                </div>
              )}
              {Boolean(call.error) && (
                <div className="text-[10px] text-rose-500 bg-rose-500/10 p-1.5 rounded">
                  <span className="font-sans font-semibold block mb-0.5">{t("message_bubble.tool_error")}</span>
                  <span>{call.error}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default React.memo(ToolCallBlock);
