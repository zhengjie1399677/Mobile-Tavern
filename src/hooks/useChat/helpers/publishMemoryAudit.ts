/**
 * 发布本轮记忆审计快照（仅当前聊天运行时，不写入会话）。
 *
 * 抽出以给 useSendMessage 留出行数余量；逻辑与原内联实现一致：
 * 以最终 Prompt 编排轨迹为准构建快照，优先发布新接口，否则回落旧接口。
 */
import type { ChatSession, UserSettings } from "../../../types";
import type { PromptCompositionTrace } from "../../../domain/prompt-composition";
import { buildMemoryAuditSnapshot } from "../../../application/services/memory/MemoryAudit";
import type { MemoryAuditSnapshot, RecalledMessage } from "../../../application/services/memory/types";
import type { ContextContribution } from "../../../domain/contextSources/contracts";

export interface PublishMemoryAuditPorts {
  readonly publishMemoryAudit?: (snapshot: MemoryAuditSnapshot) => void;
  /** 迁移期兼容旧消费方；新代码应使用 publishMemoryAudit。 */
  readonly publishRecalledMemories?: (
    sessionId: string,
    items: MemoryAuditSnapshot["recalled"],
  ) => void;
  readonly estimateTokens: (content: string) => number;
}

export function publishTurnMemoryAudit(
  ports: PublishMemoryAuditPorts,
  input: {
    readonly session: ChatSession;
    readonly query: string;
    readonly recalled: RecalledMessage[];
    readonly settings: UserSettings;
    readonly traces?: readonly PromptCompositionTrace[];
    readonly contextContributions?: readonly ContextContribution[];
  },
): void {
  const snapshot = buildMemoryAuditSnapshot({
    session: input.session,
    query: input.query,
    recalled: input.recalled,
    settings: input.settings,
    traces: input.traces ? [...input.traces] : undefined,
    ...(input.contextContributions ? { contextContributions: input.contextContributions } : {}),
    estimateTokens: ports.estimateTokens,
  });
  if (ports.publishMemoryAudit) ports.publishMemoryAudit(snapshot);
  else ports.publishRecalledMemories?.(input.session.id, input.recalled);
}
