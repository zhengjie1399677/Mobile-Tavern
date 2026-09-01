import type {
  CompatibilityWorldInfoResolverRequest,
} from "../../application/compatibility/contracts";
import type { LorebookEntry, Message } from "../../types";
import {
  evaluateVariableCondition,
  type VariableConditionContext,
} from "../../domain/conditions";

const DEFAULT_PROMPT_BUDGET_CHARS = 6000;
const DEFAULT_SCAN_CHARS = 8000;

type SelectiveLogic = "AND_ANY" | "AND_ALL" | "NOT_ANY" | "NOT_ALL" | "NONE";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sourceValue(entry: LorebookEntry, key: string): unknown {
  const source = asRecord(entry.sourceMetadata);
  if (source[key] !== undefined) return source[key];
  return asRecord(source.extensions)[key];
}

function sourceBoolean(entry: LorebookEntry, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = sourceValue(entry, key);
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function sourceNumber(entry: LorebookEntry, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = sourceValue(entry, key);
    const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function sourceString(entry: LorebookEntry, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = sourceValue(entry, key);
    if (typeof value === "string") return value;
  }
  return undefined;
}

function isPotentiallyCatastrophicRegex(pattern: string): boolean {
  return /(\([^\)]*[+*][^\)]*\)[^\)]*[+*])|(\[[^\]]*[+*\][^\)]*[+*])/.test(pattern);
}

function selectiveLogic(entry: LorebookEntry): SelectiveLogic {
  const raw = sourceValue(entry, "selectiveLogic") ?? entry.selectiveLogic;
  if (typeof raw === "number") {
    return ({ 1: "AND_ANY", 2: "AND_ALL", 3: "NOT_ANY", 4: "NOT_ALL" } as const)[raw] ?? "NONE";
  }
  if (typeof raw !== "string") return "NONE";
  const normalized = raw.toUpperCase();
  return normalized === "AND_ANY" || normalized === "AND_ALL" ||
    normalized === "NOT_ANY" || normalized === "NOT_ALL"
    ? normalized
    : "NONE";
}

function matchesKey(key: string, entry: LorebookEntry, scanText: string): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;
  const caseSensitive = sourceBoolean(entry, "case_sensitive", "caseSensitive") ?? entry.caseSensitive ?? false;
  const useRegex = sourceBoolean(entry, "use_regex", "useRegex") ?? entry.useRegex ?? false;
  if (!useRegex) {
    return caseSensitive
      ? scanText.includes(trimmed)
      : scanText.toLocaleLowerCase().includes(trimmed.toLocaleLowerCase());
  }
  try {
    if (isPotentiallyCatastrophicRegex(trimmed)) {
      return caseSensitive
        ? scanText.includes(trimmed)
        : scanText.toLocaleLowerCase().includes(trimmed.toLocaleLowerCase());
    }
    const slashMatch = trimmed.match(/^\/(.+)\/([dgimsuvy]*)$/i);
    const pattern = slashMatch?.[1] ?? trimmed;
    const sourceFlags = slashMatch?.[2] ?? "";
    const flags = caseSensitive ? sourceFlags.replace(/i/g, "") : sourceFlags.includes("i") ? sourceFlags : `${sourceFlags}i`;
    return new RegExp(pattern, flags).test(scanText);
  } catch {
    return caseSensitive
      ? scanText.includes(trimmed)
      : scanText.toLocaleLowerCase().includes(trimmed.toLocaleLowerCase());
  }
}

function scanTextFor(messages: readonly Message[], userInput: string, depth: number): string {
  const recentMessages = depth > 0 ? messages.slice(-depth) : [];
  const text = `${userInput}\n${recentMessages.map((message) => message.content).join("\n")}`;
  return text.length > DEFAULT_SCAN_CHARS ? text.slice(-DEFAULT_SCAN_CHARS) : text;
}

function contributesToRecursion(entry: LorebookEntry): boolean {
  return !(sourceBoolean(entry, "exclude_recursion", "excludeRecursion") === true ||
    sourceBoolean(entry, "prevent_recursion", "preventRecursion") === true);
}

function passesSecondaryKeys(entry: LorebookEntry, match: (key: string) => boolean): boolean {
  const keys = entry.secondary_keys ?? [];
  if (keys.length === 0) return true;
  const matched = keys.map(match);
  switch (selectiveLogic(entry)) {
    case "AND_ANY": return matched.some(Boolean);
    case "AND_ALL": return matched.every(Boolean);
    case "NOT_ANY": return !matched.some(Boolean);
    case "NOT_ALL": return !matched.every(Boolean);
    default: return true;
  }
}

function entryOrder(entry: LorebookEntry): number {
  return sourceNumber(entry, "order") ?? entry.order ?? 100;
}

/**
 * SillyTavern World Info 兼容解析器。
 * 该文件只属于 Compatibility Runtime；通用 Prompt 层不解释 sourceMetadata。
 */
export function resolveSillyTavernWorldInfo(
  request: CompatibilityWorldInfoResolverRequest,
): readonly LorebookEntry[] {
  if (request.entries.length === 0) return [];

  const entries = request.entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => entryOrder(right.entry) - entryOrder(left.entry) || left.index - right.index)
    .map(({ entry }) => entry);
  const activeEntries: LorebookEntry[] = [];
  const activeIds = new Set<string>();
  const scanCache = new Map<number, string>();
  let recursionText = "";
  let pass = 0;
  let triggered = true;
  const maxPasses = Math.max(1, request.maxRecursionDepth ?? 3);
  const conditionContext = (request.conditionContext ?? {}) as VariableConditionContext;

  const getScanText = (depth: number): string => {
    const base = scanCache.get(depth) ?? scanTextFor(request.messages, request.userInput, depth);
    scanCache.set(depth, base);
    return recursionText ? `${base}\n${recursionText}` : base;
  };

  while (triggered && pass < maxPasses) {
    triggered = false;
    pass += 1;
    for (const entry of entries) {
      if (!entry.enabled || !entry.content || activeIds.has(entry.id)) continue;
      if (!evaluateVariableCondition(entry.condition, conditionContext)) continue;

      const delay = sourceNumber(entry, "delay_until_recursion", "delayUntilRecursion") ?? 0;
      if (delay > pass) continue;

      const isConstant = entry.constant || sourceBoolean(entry, "constant_active") === true;
      const scanDepth = sourceNumber(entry, "scan_depth", "scanDepth") ?? entry.scanDepth ?? 10;
      const scanText = getScanText(scanDepth);
      const match = (key: string) => matchesKey(key, entry, scanText);
      if (!isConstant && (scanDepth === 0 || !entry.keys.some(match) || !passesSecondaryKeys(entry, match))) continue;

      const useProbability = sourceBoolean(entry, "useProbability", "use_probability") ?? true;
      const probability = sourceNumber(entry, "probability") ?? entry.probability ?? 100;
      if (useProbability && probability < 100 && Math.random() * 100 > probability) continue;

      activeEntries.push(entry);
      activeIds.add(entry.id);
      if (contributesToRecursion(entry)) recursionText += `\n${entry.content}`;
      triggered = true;
    }
  }

  let budgetUsed = 0;
  return activeEntries.filter((entry) => {
    const ignoreBudget = sourceBoolean(entry, "ignore_budget", "ignoreBudget") === true;
    if (ignoreBudget) return true;
    const length = entry.content.length;
    if (length > DEFAULT_PROMPT_BUDGET_CHARS || budgetUsed + length > DEFAULT_PROMPT_BUDGET_CHARS) return false;
    budgetUsed += length;
    return true;
  });
}
