/**
 * 故事年表边界一致性的纯函数工具。
 *
 * lastSummarizedMessageId 仍被 MemorySummary 用于计算未总结消息的起点；
 * 消息被重发/删除截断后必须同步维护边界与年表卡片，避免边界悬空导致
 * 总结服务回退失败、把已归档内容从头重复总结。
 */

import type { SummaryCard } from "../../../types";

export interface ReconciledSummaryBoundary {
  summaries: SummaryCard[];
  lastSummarizedMessageId?: string;
}

/**
 * 消息被重发/删除截断后，同步维护年表卡片与最后总结位置。
 *
 * - 移除 lastMessageId 落在被删除/被覆盖分支中的年表卡片；
 * - 归档边界回退到最后一张保留卡片的 lastMessageId。
 */
export function reconcileSummaryBoundary(
  removedMessageIds: string[],
  summaries: SummaryCard[] | undefined,
  previousBoundary?: string
): ReconciledSummaryBoundary {
  const removed = new Set(removedMessageIds);
  const kept = (summaries || []).filter(
    (s) => !s.lastMessageId || !removed.has(s.lastMessageId)
  );
  // 仅在原边界确实被删除/覆盖时才回退；否则保持原值（不主动创建边界）。
  // 不再依赖内存中的 retained 消息集合，避免懒加载时把更早的年表卡片误删。
  let boundary = previousBoundary;
  if (boundary && removed.has(boundary)) {
    boundary = [...kept]
      .reverse()
      .find((s) => s.lastMessageId)
      ?.lastMessageId;
  }
  return { summaries: kept, lastSummarizedMessageId: boundary };
}
