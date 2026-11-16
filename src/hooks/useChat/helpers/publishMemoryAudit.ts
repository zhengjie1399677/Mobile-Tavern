/**
 * 发布本轮记忆审计快照（仅当前聊天运行时，不写入会话）。
 *
 * 转发到应用层统一实现 `publishTurnMemoryAuditSnapshot`，保持 Hook 侧兼容导入不重复。
 */
import type { ChatSession, UserSettings } from "../../../types";
import {
  publishTurnMemoryAuditSnapshot,
  type PublishTurnMemoryAuditPorts,
} from "../../../application/useCases/chatTurnExecution";
import type { RecalledMessage } from "../../../application/services/memory/types";
import type { ContextContribution } from "../../../domain/contextSources/contracts";

export type PublishMemoryAuditPorts = PublishTurnMemoryAuditPorts;

export function publishTurnMemoryAudit(
  ports: PublishTurnMemoryAuditPorts,
  input: {
    readonly session: ChatSession;
    readonly query: string;
    readonly recalled: RecalledMessage[];
    readonly settings: UserSettings;
    readonly contextContributions?: readonly ContextContribution[];
  },
): void {
  publishTurnMemoryAuditSnapshot(ports, input);
}
