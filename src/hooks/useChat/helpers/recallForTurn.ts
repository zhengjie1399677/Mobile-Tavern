/**
 * 本轮记忆召回。
 *
 * 从 useSendMessage 抽出：该 Hook 已超过 1000 行硬上限，而召回逻辑本身与发送流程无关，
 * 只需记忆服务、设置与当前输入。失败与超时都降级为空结果并记录日志，不阻断发送。
 */
import { publicEnvironment } from "../../../config";
import type { MemoryServiceTyped } from "../../../application/services/memory";
import type { RecalledMessage } from "../../../application/services/memory/types";
import { recallWithTimeout } from "./streamHelpers";

interface RecallLogPort {
  info(message: string, detail?: unknown): void;
  warn(message: string, error?: unknown): void;
}

export interface RecallMemoriesForTurnParams {
  readonly memoryService: MemoryServiceTyped | undefined;
  /** 对应 settings.memory.enableRecall !== false。 */
  readonly enabled: boolean;
  readonly sessionId: string;
  readonly query: string;
  readonly topK: number;
  readonly timeoutMs?: number;
  readonly log?: RecallLogPort;
}

export async function recallMemoriesForTurn(
  params: RecallMemoriesForTurnParams,
): Promise<RecalledMessage[]> {
  if (!params.memoryService || !params.enabled) {
    if (publicEnvironment.isDevelopment) params.log?.warn("memoryService 未注入，跳过召回");
    return [];
  }
  try {
    const recalled = await recallWithTimeout(
      params.memoryService.getRecall().recall(params.sessionId, params.query, { topK: params.topK }),
      params.timeoutMs,
      "useSendMessage",
    );
    if (publicEnvironment.isDevelopment) {
      params.log?.info("记忆召回完成", { count: recalled.length, topK: params.topK });
    }
    return recalled as RecalledMessage[];
  } catch (error) {
    params.log?.warn("Memory recall failed", error);
    return [];
  }
}
