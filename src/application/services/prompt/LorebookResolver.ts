import type { LorebookEntry, Message } from "../../../types";
import { Logger } from "../../../utils/logger";
import { evaluateVariableCondition, type VariableConditionContext } from "../../../domain/conditions";

const logger = Logger.create("LorebookResolver");

const PROMPT_BUDGET_CHARS = 6000;
const MAX_SCAN_CHARS = 8000;
/** 与 SillyTavern `world_info_depth` 默认值一致：未声明 scanDepth 时只扫最近 2 条消息。 */
const DEFAULT_SCAN_DEPTH = 2;

function normalizeKeys(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((key): key is string => typeof key === "string").map((key) => key.trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw.split(",").map((key) => key.trim()).filter(Boolean);
  }
  return [];
}

function matchesKey(
  key: string,
  isRegex: boolean,
  isCaseSensitive: boolean,
  scanText: string
): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;
  if (isRegex) {
    const unsafe = /(\([^\)]*[\+\*]\)[^\)]*[\+\*])/.test(trimmed) ||
      /(\[[^\]]*[\+\*]\][^\]]*[\+\*])/.test(trimmed);
    if (unsafe) {
      logger.warn("Potential ReDoS pattern skipped in regex key matching", { pattern: trimmed });
      return isCaseSensitive
        ? scanText.includes(trimmed)
        : scanText.toLowerCase().includes(trimmed.toLowerCase());
    }
    try {
      let pattern = trimmed;
      let flags = isCaseSensitive ? "" : "i";
      const regexMatch = trimmed.match(/^\/(.+)\/([dgimsuy]*)$/i);
      if (regexMatch) {
        pattern = regexMatch[1];
        const rawFlags = regexMatch[2];
        flags = isCaseSensitive
          ? rawFlags.replace(/i/g, "")
          : rawFlags.toLowerCase().includes("i") ? rawFlags : `${rawFlags}i`;
      }
      return new RegExp(pattern, flags).test(scanText);
    } catch {
      return isCaseSensitive
        ? scanText.includes(trimmed)
        : scanText.toLowerCase().includes(trimmed.toLowerCase());
    }
  }
  return isCaseSensitive
    ? scanText.includes(trimmed)
    : scanText.toLowerCase().includes(trimmed.toLowerCase());
}

/** 世界书触发、递归扫描与预算裁剪的独立领域算法。 */
export function resolveTriggeredLorebookEntries(
  messages: Message[],
  userInput: string,
  entries: LorebookEntry[],
  maxRecursionDepth = 3,
  conditionContext: VariableConditionContext = {},
): LorebookEntry[] {
  if (!entries?.length) return [];

  const activeEntries: LorebookEntry[] = [];
  const activeIds = new Set<string>();
  const scanTextCache = new Map<number, string>();
  let recursionTextAppend = "";
  let currentPass = 0;
  let newTriggeredInLastPass = true;

  const getScanText = (depth: number): string => {
    let baseText = scanTextCache.get(depth);
    if (baseText === undefined) {
      const scanMessages = messages ? messages.slice(-depth) : [];
      baseText = `${userInput}\n${scanMessages.map((message) => message.content).join("\n")}`;
      if (baseText.length > MAX_SCAN_CHARS) baseText = baseText.slice(-MAX_SCAN_CHARS);
      scanTextCache.set(depth, baseText);
    }
    return recursionTextAppend ? `${baseText}\n${recursionTextAppend}` : baseText;
  };

  while (newTriggeredInLastPass && currentPass < maxRecursionDepth) {
    newTriggeredInLastPass = false;
    currentPass++;

    for (const entry of entries) {
      if (!entry.enabled || !entry.content || activeIds.has(entry.id)) continue;
      if (!evaluateVariableCondition(entry.condition, conditionContext)) continue;

      if (entry.constant) {
        activeEntries.push(entry);
        activeIds.add(entry.id);
        recursionTextAppend += `\n${entry.content}`;
        newTriggeredInLastPass = true;
        continue;
      }

      const scanDepth = entry.scanDepth ?? DEFAULT_SCAN_DEPTH;
      if (scanDepth === 0) continue;
      const scanText = getScanText(scanDepth);
      const match = (key: string) =>
        matchesKey(key, !!entry.useRegex, !!entry.caseSensitive, scanText);
      if (!(entry.keys || []).some(match)) continue;

      const secondaryKeys = normalizeKeys(entry.secondary_keys);
      if (secondaryKeys.length > 0) {
        // 未声明策略时按 ST 默认的 AND ANY，与编辑器里展示的默认值保持一致；
        // 用户显式选择 NONE 时仍然表示「次关键词不参与判定」。
        const logic = entry.selectiveLogic ?? "AND_ANY";
        const matched = secondaryKeys.map(match);
        const secondaryMatched =
          logic === "NONE" ? true
            : logic === "AND_ALL" ? matched.every(Boolean)
              : logic === "NOT_ANY" ? !matched.some(Boolean)
                : logic === "NOT_ALL" ? !matched.every(Boolean)
                  : matched.some(Boolean);
        if (!secondaryMatched) continue;
      }

      const probability = entry.probability ?? 100;
      if (probability < 100 && Math.random() * 100 > probability) continue;

      activeEntries.push(entry);
      activeIds.add(entry.id);
      recursionTextAppend += `\n${entry.content}`;
      newTriggeredInLastPass = true;
    }
  }

  let currentLength = 0;
  return activeEntries.filter((entry) => {
    const length = entry.content?.length ?? 0;
    if (length > PROMPT_BUDGET_CHARS) {
      logger.warn(
        `Lorebook entry alone exceeds prompt budget limit, skipped`,
        { entryId: entry.id, length, budget: PROMPT_BUDGET_CHARS }
      );
      return false;
    }
    if (currentLength + length > PROMPT_BUDGET_CHARS) {
      logger.warn(
        `Lorebook entry skipped due to prompt budget limit`,
        { entryId: entry.id, budget: PROMPT_BUDGET_CHARS }
      );
      return false;
    }
    currentLength += length;
    return true;
  });
}
