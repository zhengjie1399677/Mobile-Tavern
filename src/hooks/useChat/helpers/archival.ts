/**
 * 故事年表边界一致性的纯函数工具。
 *
 * lastSummarizedMessageId 仍被 MemorySummary 用于计算未总结消息的起点；
 * 消息被重发/删除截断后必须同步维护边界与年表卡片，避免边界悬空导致
 * 总结服务回退失败、把已归档内容从头重复总结。
 */

import type { Message, SummaryCard } from "../../../types";

export interface ReconciledSummaryBoundary {
  summaries: SummaryCard[];
  lastSummarizedMessageId?: string;
}

/**
 * 消息被重发/删除截断后，同步维护年表卡片与最后总结位置。
 *
 * - 只保留 lastMessageId 仍被消息覆盖的年表卡片（lastMessageId 缺失的旧数据卡片保留，但不作为边界依据）；
 * - 若原边界消息已不在保留消息中，回退到最后一张保留卡片的边界；
 * - 原边界仍有效时保持不变，避免无谓的状态扰动。
 */
export function reconcileSummaryBoundary(
  messages: Message[],
  summaries: SummaryCard[] | undefined,
  previousBoundary: string | undefined
): ReconciledSummaryBoundary {
  const retainedIds = new Set(messages.map((m) => m.id));
  const kept = (summaries || []).filter(
    (s) => !s.lastMessageId || retainedIds.has(s.lastMessageId)
  );
  let boundary = previousBoundary;
  if (boundary && !retainedIds.has(boundary)) {
    boundary = [...kept]
      .reverse()
      .find((s) => s.lastMessageId && retainedIds.has(s.lastMessageId))
      ?.lastMessageId;
  }
  return { summaries: kept, lastSummarizedMessageId: boundary };
}
