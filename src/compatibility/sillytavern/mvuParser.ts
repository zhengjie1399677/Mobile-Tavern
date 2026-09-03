/** SillyTavern Compatibility Runtime 的 MVU 解析入口。 */
import {
  applySillyTavernRegexEngine,
  type RegexEngineScript,
} from "./regexEngine";

export * from "../../utils/tavernHelper/mvuParser";

function collectRegexScripts(input: unknown): unknown[] {
  const values = Array.isArray(input)
    ? input
    : input && typeof input === "object"
      ? Object.values(input)
      : [];
  return values.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    const pattern = typeof record.findRegex === "string" ? record.findRegex : "";
    return isPotentiallyCatastrophicRegex(pattern)
      ? { ...record, findRegex: "(?!)" }
      : value;
  });
}

function isPotentiallyCatastrophicRegex(pattern: string): boolean {
  return /(\([^\)]*[+*][^\)]*\)[^\)]*[+*])|(\[[^\]]*[+*\][^\)]*[+*])/.test(pattern);
}

function regexIdentity(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id === "string" && record.id) return `id:${record.id}`;
  if (typeof record.scriptName === "string" && typeof record.findRegex === "string") {
    return `name:${record.scriptName}\u0000${record.findRegex}`;
  }
  return null;
}

function mergeRegexScripts(...sources: unknown[]): unknown[] {
  const merged: unknown[] = [];
  const identities = new Set<string>();
  for (const source of sources) {
    for (const script of collectRegexScripts(source)) {
      const identity = regexIdentity(script);
      if (identity && identities.has(identity)) continue;
      if (identity) identities.add(identity);
      merged.push(script);
    }
  }
  return merged;
}

export interface SillyTavernRegexTransformOptions {
  readonly globalRegexScripts?: readonly unknown[];
  readonly presetRegexScripts?: readonly unknown[];
  readonly depth?: number;
  readonly isEdit?: boolean;
  readonly placement?: number;
}

/**
 * 应用 SillyTavern 的 global → preset → character Regex 来源顺序。
 * 该编排只属于 Compatibility Runtime；通用文本处理不感知这些来源。
 */
export function applySillyTavernRegexScripts(
  text: string,
  character: unknown,
  isAiMessage?: boolean,
  charName?: string,
  userName?: string,
  mode?: "render" | "prompt" | "store",
  signal?: AbortSignal,
  options: SillyTavernRegexTransformOptions = {},
): string {
  if (!character || typeof character !== "object") return text;
  const characterRecord = character as Record<string, unknown>;
  const extensions = characterRecord.extensions && typeof characterRecord.extensions === "object" && !Array.isArray(characterRecord.extensions)
    ? characterRecord.extensions as Record<string, unknown>
    : {};
  const mergedScripts = mergeRegexScripts(
    options.globalRegexScripts,
    options.presetRegexScripts,
    extensions.regex_scripts,
  );
  return applySillyTavernRegexEngine(
    text,
    mergedScripts as readonly RegexEngineScript[],
    {
      isAiMessage,
      charName,
      userName,
      mode,
      signal,
      depth: options.depth,
      isEdit: options.isEdit,
      placement: options.placement,
    },
  );
}
