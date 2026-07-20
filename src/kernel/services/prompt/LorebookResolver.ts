import type { LorebookEntry, Message } from "../../../types";

const PROMPT_BUDGET_CHARS = 6000;
const MAX_SCAN_CHARS = 8000;

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
      console.warn("Potential ReDoS pattern skipped in regex key matching:", trimmed);
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
  maxRecursionDepth = 3
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

      if (entry.constant) {
        activeEntries.push(entry);
        activeIds.add(entry.id);
        recursionTextAppend += `\n${entry.content}`;
        newTriggeredInLastPass = true;
        continue;
      }

      const scanDepth = entry.scanDepth ?? 10;
      if (scanDepth === 0) continue;
      const scanText = getScanText(scanDepth);
      const match = (key: string) =>
        matchesKey(key, !!entry.useRegex, !!entry.caseSensitive, scanText);
      if (!(entry.keys || []).some(match)) continue;

      const secondaryKeys = entry.secondary_keys || [];
      const logic = entry.selectiveLogic || "NONE";
      let secondaryMatched = true;
      if (logic !== "NONE" && secondaryKeys.length > 0) {
        if (logic === "AND_ANY") secondaryMatched = secondaryKeys.some(match);
        else if (logic === "AND_ALL") secondaryMatched = secondaryKeys.every(match);
        else if (logic === "NOT_ANY") secondaryMatched = !secondaryKeys.some(match);
      }
      if (!secondaryMatched) continue;

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
      console.warn(
        `[PromptService] Lorebook entry "${entry.id}" alone exceeds prompt budget limit of ${PROMPT_BUDGET_CHARS} chars, skipped.`
      );
      return false;
    }
    if (currentLength + length > PROMPT_BUDGET_CHARS) {
      console.warn(
        `[PromptService] Lorebook entry "${entry.id}" skipped due to prompt budget limit (${PROMPT_BUDGET_CHARS} chars)`
      );
      return false;
    }
    currentLength += length;
    return true;
  });
}
