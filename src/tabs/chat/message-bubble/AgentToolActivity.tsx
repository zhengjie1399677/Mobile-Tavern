import React from "react";
import { AlertTriangle, Check, ShieldAlert, X } from "lucide-react";
import type {
  AgentJournalEvent,
  AgentToolApprovalRequest,
} from "../../../domain/agents/contracts";
import type { IAgentRuntimeService } from "../../../application/serviceContracts";
import { KernelServices } from "../../../application/serviceContracts";
import { useOptionalKernel } from "../../../contexts/KernelContext";
import ToolCallBlock from "./ToolCallBlock";

interface AgentToolActivityProps {
  sessionId: string;
}

const MAX_HISTORY_EVENTS = 120;

export function AgentToolActivity({ sessionId }: AgentToolActivityProps): React.JSX.Element | null {
  const kernel = useOptionalKernel();
  const [pending, setPending] = React.useState<AgentToolApprovalRequest[]>([]);
  const [events, setEvents] = React.useState<AgentJournalEvent[]>([]);

  React.useEffect(() => {
    if (!kernel?.hasService(KernelServices.AgentRuntime)) {
      setPending([]);
      setEvents([]);
      return;
    }
    const runtime = kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime);
    let active = true;
    const refreshPending = () => {
      if (!active) return;
      setPending(runtime.listPendingToolApprovals().filter((request) => request.sessionId === sessionId));
    };
    const refreshEvents = async () => {
      const next = await runtime.listJournalBySession(sessionId);
      if (!active) return;
      setEvents(next.slice(-MAX_HISTORY_EVENTS));
    };
    refreshPending();
    void refreshEvents();
    const disposeApprovals = runtime.subscribeToolApprovals((request) => {
      if (request.sessionId === sessionId) refreshPending();
    });
    const disposeJournal = runtime.subscribeJournal((changedSessionId) => {
      if (changedSessionId !== sessionId) return;
      refreshPending();
      void refreshEvents();
    });
    return () => {
      active = false;
      void disposeJournal();
      void disposeApprovals();
    };
  }, [kernel, sessionId]);

  const resolve = React.useCallback((approvalId: string, decision: "allow" | "deny") => {
    if (!kernel?.hasService(KernelServices.AgentRuntime)) return;
    const runtime = kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime);
    runtime.resolveToolApproval(approvalId, decision);
    setPending(runtime.listPendingToolApprovals().filter((request) => request.sessionId === sessionId));
  }, [kernel, sessionId]);

  const toolEvents = events.filter((event) => event.type.startsWith("tool."));
  if (pending.length === 0 && toolEvents.length === 0) return null;

  return (
    <div className="space-y-2 px-1" data-ui="agent-tool-activity">
      {pending.map((request) => (
        <ToolApprovalCard key={request.id} request={request} onResolve={resolve} />
      ))}
      <ToolCallBlock events={toolEvents} />
    </div>
  );
}

interface ToolApprovalCardProps {
  request: AgentToolApprovalRequest;
  onResolve: (approvalId: string, decision: "allow" | "deny") => void;
}

function ToolApprovalCard({ request, onResolve }: ToolApprovalCardProps): React.JSX.Element {
  return (
    <section
      className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 shadow-sm"
      aria-label={`等待审批：${request.toolName}`}
      data-ui="tool-approval-card"
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 rounded-lg bg-amber-500/15 p-1.5 text-amber-600 dark:text-amber-400">
          <ShieldAlert className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <strong className="font-mono text-xs text-foreground">{request.toolName}</strong>
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:text-amber-300">
              {riskLabel(request.riskLevel)} · {effectLabel(request.sideEffect)} · {scopeLabel(request.executionScope)}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{request.description}</p>
          <div className="mt-2 rounded-lg border border-border/50 bg-background/60 p-2">
            <div className="mb-1 flex items-center gap-1 text-[9px] font-semibold text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3 w-3" /> 即将执行的参数
            </div>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-foreground/85">
              {formatArguments(request.arguments)}
            </pre>
          </div>
          <p className="mt-1.5 text-[9px] text-muted-foreground">
            本次授权仅对这一条 Tool Call 有效；取消、超时或关闭页面都会拒绝执行。
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onResolve(request.id, "deny")}
          className="flex items-center justify-center gap-1 rounded-lg border border-border bg-background/70 px-3 py-2 text-[11px] font-semibold text-foreground hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" /> 拒绝一次
        </button>
        <button
          type="button"
          onClick={() => onResolve(request.id, "allow")}
          className="flex items-center justify-center gap-1 rounded-lg bg-amber-600 px-3 py-2 text-[11px] font-semibold text-white hover:bg-amber-700"
        >
          <Check className="h-3.5 w-3.5" /> 允许一次
        </button>
      </div>
    </section>
  );
}

function formatArguments(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "{}";
  } catch {
    return String(value);
  }
}

function riskLabel(risk: AgentToolApprovalRequest["riskLevel"]): string {
  if (risk === "high") return "高风险";
  if (risk === "medium") return "中风险";
  return "低风险";
}

function scopeLabel(scope: AgentToolApprovalRequest["executionScope"]): string {
  const labels: Record<AgentToolApprovalRequest["executionScope"], string> = {
    turn: "当前轮次",
    session: "本地会话",
    memory: "长期记忆",
    character: "角色数据",
    external: "外部服务",
  };
  return labels[scope];
}

function effectLabel(effect: AgentToolApprovalRequest["sideEffect"]): string {
  const labels: Record<AgentToolApprovalRequest["sideEffect"], string> = {
    none: "无副作用",
    "local-write": "写入本地数据",
    external: "访问外部服务",
    irreversible: "不可逆操作",
  };
  return labels[effect];
}

export default React.memo(AgentToolActivity);
