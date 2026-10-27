/**
 * 世界书（Lorebook）解析审计。
 *
 * 解析器在正常匹配流程中顺手把「为什么命中 / 为什么没被预算收下」写进这里，
 * 供 UI 的「本轮提示词」面板展示。审计对象只读消费，绝不参与匹配判定，
 * 也不写入会话持久化数据。
 */

/** 条目被注入的原因。 */
export type LorebookAuditTrigger = "constant" | "sticky" | "keyword";

export interface LorebookAuditHit {
  entryId: string;
  trigger: LorebookAuditTrigger;
  /** 关键词触发时命中的关键词原文；常驻 / Sticky 触发时缺省。 */
  matchedKey?: string;
}

export interface LorebookAuditBudgetDrop {
  entryId: string;
  /** 条目正文长度，用于解释「被预算挤掉」的具体规模。 */
  chars: number;
}

/** 单次解析过程中的审计收集器。 */
export interface LorebookAuditReport {
  /** 本次解析实际生效的预算（字符数）。 */
  budgetChars: number;
  /** 参与解析的候选条目总数（已排除禁用条目）。 */
  candidateCount: number;
  hits: LorebookAuditHit[];
  budgetDropped: LorebookAuditBudgetDrop[];
}

export function createLorebookAuditReport(
  budgetChars: number,
  candidateCount = 0,
): LorebookAuditReport {
  return {
    budgetChars,
    candidateCount,
    hits: [],
    budgetDropped: [],
  };
}

export function recordLorebookHit(report: LorebookAuditReport, hit: LorebookAuditHit): void {
  report.hits.push(hit);
}

export function recordLorebookBudgetDrop(
  report: LorebookAuditReport,
  entryId: string,
  chars: number,
): void {
  report.budgetDropped.push({ entryId, chars });
}
