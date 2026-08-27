import type { EffectDisposer } from "../../../kernel/types";
import type {
  AgentToolApprovalDecision,
  AgentToolApprovalReason,
  AgentToolApprovalRequest,
} from "../../../domain/agents/contracts";

export interface ToolApprovalResolution {
  readonly decision: AgentToolApprovalDecision;
  readonly reason: AgentToolApprovalReason;
}

interface PendingToolApproval {
  readonly request: AgentToolApprovalRequest;
  readonly settle: (
    decision: AgentToolApprovalDecision,
    reason: AgentToolApprovalReason,
  ) => void;
}

/** 管理一次性审批的 UI 宿主、超时与中止；不持有 Tool 执行实现或 Journal。 */
export class ToolApprovalCoordinator {
  private readonly listeners = new Set<(request: AgentToolApprovalRequest) => void>();
  private readonly pending = new Map<string, PendingToolApproval>();

  listPending(): AgentToolApprovalRequest[] {
    return [...this.pending.values()]
      .map((approval) => structuredClone(approval.request))
      .sort((left, right) => left.expiresAt - right.expiresAt);
  }

  subscribe(listener: (request: AgentToolApprovalRequest) => void): EffectDisposer {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.rejectAll("host-unavailable");
    };
  }

  resolve(approvalId: string, decision: AgentToolApprovalDecision): boolean {
    if (decision !== "allow" && decision !== "deny") return false;
    const approval = this.pending.get(approvalId);
    if (!approval) return false;
    approval.settle(decision, "user");
    return true;
  }

  request(
    request: AgentToolApprovalRequest,
    signal: AbortSignal,
  ): Promise<ToolApprovalResolution> {
    if (this.listeners.size === 0) {
      return Promise.resolve({ decision: "deny", reason: "host-unavailable" });
    }
    if (signal.aborted) {
      return Promise.resolve({ decision: "deny", reason: "cancelled" });
    }
    return new Promise<ToolApprovalResolution>((resolve) => {
      let active = true;
      const onAbort = () => settle("deny", "cancelled");
      const timeout = setTimeout(
        () => settle("deny", "timeout"),
        Math.max(0, request.expiresAt - Date.now()),
      );
      const settle = (decision: AgentToolApprovalDecision, reason: AgentToolApprovalReason) => {
        if (!active) return;
        active = false;
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
        this.pending.delete(request.id);
        resolve({ decision, reason });
      };
      this.pending.set(request.id, { request, settle });
      signal.addEventListener("abort", onAbort, { once: true });
      // 覆盖首次检查与事件监听注册之间发生的中止，避免审批悬挂到超时。
      if (signal.aborted) {
        settle("deny", "cancelled");
        return;
      }
      let delivered = false;
      for (const listener of this.listeners) {
        try {
          listener(structuredClone(request));
          delivered = true;
        } catch {
          // 单个 UI 订阅者异常不能放宽审批；没有可用宿主时统一 fail-closed。
        }
      }
      if (!delivered) settle("deny", "host-unavailable");
    });
  }

  destroy(): void {
    this.rejectAll("host-unavailable");
    this.listeners.clear();
  }

  private rejectAll(reason: AgentToolApprovalReason): void {
    for (const approval of [...this.pending.values()]) approval.settle("deny", reason);
  }
}
