/**
 * 输出长度（`max_tokens` / `max_completion_tokens`）的出厂默认、可选上限与提示词保底预算。
 *
 * 单一来源：出厂预设、采样界面、预设实体校验、Agent Profile 采样校验与提示词预算都从
 * 这里取值，避免多处各自写死数字后漂移（历史缺陷：采样滑杆上限 150000 与实体校验
 * 1000000 长期不一致，滑杆拖动还会把预设 ID 冲掉）。
 *
 * 语义取舍：模型侧的上下文窗口由「提示词 + 输出」共同占用。输出上限放开后，
 * `上下文 − 输出` 可能被压到 1 token，历史、世界书与记忆区块会被整段丢掉，
 * 因此这里把「输出预留」限制在上下文窗口减掉保底提示词预算的范围内。
 */

/** 出厂默认输出上限：十万 token。 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 100_000;

/** 可选输出上限：一百万 token（Gemini 4 已支持，其他厂商预计跟进）。 */
export const MAX_OUTPUT_TOKENS = 1_000_000;

/** 无论输出上限调到多大，提示词至少保留的 token 预算。 */
export const MIN_PROMPT_TOKEN_BUDGET = 4_096;

export interface ContextBudgetSplit {
  /** 从上下文窗口里为输出预留的 token 数（不超过 `上下文 − 保底提示词预算`）。 */
  outputReservation: number;
  /** 留给提示词（系统提示、历史、世界书、记忆）的 token 预算，至少为 1。 */
  promptBudget: number;
}

/**
 * 把上下文窗口切成「输出预留 + 提示词预算」。
 *
 * - 请求的输出上限小于上下文窗口时按原值预留，与既有 `上下文 − maxTokens` 语义一致；
 * - 输出上限大到会吃掉整个上下文时，只预留 `上下文 − MIN_PROMPT_TOKEN_BUDGET`，
 *   避免提示词预算塌到 1 token（历史/世界书被静默丢光）；
 * - 上下文窗口本身小于保底预算时，整个窗口都给提示词，不做输出预留。
 */
export function splitContextBudget(
  contextLimit: number,
  requestedOutputTokens: number,
): ContextBudgetSplit {
  const limit = Number.isFinite(contextLimit) && contextLimit > 0
    ? Math.floor(contextLimit)
    : 0;
  const requested = Number.isFinite(requestedOutputTokens)
    ? Math.max(0, Math.floor(requestedOutputTokens))
    : 0;
  const maxReservation = Math.max(0, limit - MIN_PROMPT_TOKEN_BUDGET);
  const outputReservation = Math.min(requested, maxReservation);
  return {
    outputReservation,
    promptBudget: Math.max(1, limit - outputReservation),
  };
}
