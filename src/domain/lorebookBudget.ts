/**
 * 世界书注入预算（字符）。
 *
 * SillyTavern 的 `world_info_budget` 默认值是**上下文的 25%**（`world_info_budget_cap` 默认 0，
 * 即不设额外上限），按 token 计量。本仓没有可用的 tokenizer，统一按「1 token ≈ 4 字符」折算，
 * 于是 25% · 4 = 1，字符预算在数值上等于上下文窗口的 token 数（32k 上下文 → 32000 字符）。
 *
 * 历史缺陷：预算曾是写死的 6000 字符，约为 32k 上下文的 1.5%，远低于 ST 语义；
 * 下载卡里常驻条目动辄数千字符，一次性吃光预算后**所有命中关键词的条目都会被静默丢弃**，
 * 表现为「只注入了常驻世界书，关键词条目怎么试都不触发」。
 */

/** 1 token 约等于的字符数（中英混排的保守估计）。 */
const CHARS_PER_TOKEN = 4;
/** SillyTavern `world_info_budget` 默认占比。 */
const DEFAULT_BUDGET_SHARE = 0.25;
/** 模型上下文窗口未知时的保守默认值。 */
const FALLBACK_CONTEXT_WINDOW = 32000;
/** 极小上下文模型也至少保留的字符预算，避免预算被折算成 0 后世界书全部失效。 */
const MIN_BUDGET_CHARS = 4000;

/**
 * 按上下文窗口推导世界书字符预算。
 * @param contextWindow 上下文窗口（token）；缺省或非法时按 32000 处理。
 */
export function resolveWorldInfoBudgetChars(contextWindow?: number): number {
  const window = typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0
    ? contextWindow
    : FALLBACK_CONTEXT_WINDOW;
  return Math.max(MIN_BUDGET_CHARS, Math.round(window * DEFAULT_BUDGET_SHARE * CHARS_PER_TOKEN));
}
