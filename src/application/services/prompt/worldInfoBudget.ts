import type { UserSettings } from "../../../types";
import { resolveWorldInfoBudgetChars } from "../../../domain/lorebookBudget";
import { ModelCapabilityRegistry } from "../llmCompatibility";

/**
 * 世界书注入预算（字符）：按当前模型上下文窗口推导，语义对齐 SillyTavern 的
 * `world_info_budget`（默认占上下文 25%）。历史实现写死 6000 字符，会让下载卡的
 * 常驻条目吃光预算、命中关键词的条目被整批丢弃。
 */
export function resolveWorldInfoBudgetForSettings(settings: UserSettings): number {
  const caps = ModelCapabilityRegistry.getCapabilities(
    (settings.api?.modelName || "").toLowerCase(),
    settings.api?.baseUrl,
  );
  const contextWindow = settings.api?.contextLimit || caps.contextWindow || undefined;
  return resolveWorldInfoBudgetChars(contextWindow);
}
