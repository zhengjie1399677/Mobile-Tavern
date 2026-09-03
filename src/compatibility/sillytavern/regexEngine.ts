/**
 * SillyTavern 正则引擎（Compatibility Runtime 专用）
 * 
 * 对齐 SillyTavern 官方扩展 public/scripts/extensions/regex/engine.js：
 * 1. 1000 容量的 LRU 正则编译缓存（RegexProvider）与 lastIndex 安全重置；
 * 2. 宏替换模式支持（0: NONE, 1: RAW, 2: ESCAPED 安全转义）；
 * 3. 捕获组与裁剪增强（$1, $<name>, {{match}}, trimStrings）；
 * 4. 深度区间过滤（minDepth / maxDepth）与编辑态检测（runOnEdit）；
 * 5. 生效位置分流（1: 用户输入, 2: AI 输出, 3: 斜杠命令, 5: 世界书, 6: 思维链）。
 */

export const enum SubstituteFindRegex {
  NONE = 0,
  RAW = 1,
  ESCAPED = 2,
}

export const enum RegexPlacement {
  MD_DISPLAY = 0,
  USER_INPUT = 1,
  AI_OUTPUT = 2,
  SLASH_COMMAND = 3,
  WORLD_INFO = 5,
  REASONING = 6,
}

export interface RegexEngineScript {
  id?: string;
  scriptName?: string;
  findRegex?: string;
  replaceString?: string;
  disabled?: boolean;
  placement?: number[] | number;
  runOnEdit?: boolean;
  markdownOnly?: boolean;
  promptOnly?: boolean;
  substituteRegex?: number;
  minDepth?: number | null;
  maxDepth?: number | null;
  trimStrings?: string[];
}

export interface RegexExecutionOptions {
  isAiMessage?: boolean;
  charName?: string;
  userName?: string;
  mode?: "render" | "prompt" | "store" | "display";
  placement?: number;
  depth?: number;
  isEdit?: boolean;
  signal?: AbortSignal;
}

/**
 * 构造标准的 AbortError，兼容缺失 DOMException 的测试与运行环境
 */
function createAbortError(message = "Regex execution was aborted"): DOMException {
  if (typeof DOMException !== "undefined") {
    return new DOMException(message, "AbortError");
  }
  const err = new Error(message);
  (err as { name?: string }).name = "AbortError";
  return err as unknown as DOMException;
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

/**
 * 正则宏安全转义函数：对宏展开文本中的正则元字符进行严格转义，
 * 防止角色名或用户名中的括号、加号、点等特殊符号破坏 RegExp 语法。
 */
export function sanitizeRegexMacro(x: string): string {
  if (!x || typeof x !== "string") return "";
  return x.replace(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/g, (s) => {
    switch (s) {
      case "\n": return "\\n";
      case "\r": return "\\r";
      case "\t": return "\\t";
      case "\v": return "\\v";
      case "\f": return "\\f";
      case "\0": return "\\0";
      default: return "\\" + s;
    }
  });
}

/**
 * 编译解析字符串为 RegExp 实例
 */
export function parseRegexFromString(input: string): RegExp | null {
  try {
    const match = input.match(/^\/(.*)\/([gimsuy]*)$/s);
    if (match) {
      return new RegExp(match[1], match[2]);
    }
    return new RegExp(input, "gi");
  } catch {
    return null;
  }
}

/**
 * LRU 正则实例缓存池
 */
export class RegexProvider {
  private cache = new Map<string, RegExp>();
  private readonly maxSize: number;

  static readonly instance = new RegexProvider(1000);

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  get(regexString: string): RegExp | null {
    if (!regexString) return null;
    const isCached = this.cache.has(regexString);
    const regex = isCached ? this.cache.get(regexString)! : parseRegexFromString(regexString);

    if (!regex) return null;

    if (isCached) {
      // LRU: 移动到末尾
      this.cache.delete(regexString);
      this.cache.set(regexString, regex);
    } else {
      if (this.cache.size >= this.maxSize) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey !== undefined) this.cache.delete(firstKey);
      }
      this.cache.set(regexString, regex);
    }

    if (regex.global || regex.sticky) {
      regex.lastIndex = 0;
    }

    return regex;
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

/**
 * 参数宏替换
 */
function substituteMacros(
  text: string,
  params: { charName?: string; userName?: string },
  sanitize = false,
): string {
  const rawChar = params.charName || "";
  const rawUser = params.userName || "user";

  const finalChar = sanitize ? sanitizeRegexMacro(rawChar) : rawChar;
  const finalUser = sanitize ? sanitizeRegexMacro(rawUser) : rawUser;

  return text
    .replace(/\{\{char\}\}/gi, finalChar)
    .replace(/<BOT>/gi, finalChar)
    .replace(/\{\{user\}\}/gi, finalUser)
    .replace(/<USER>/gi, finalUser);
}

/**
 * 从匹配组中剔除 trimStrings 所指定的字符串
 */
function filterTrimStrings(
  rawString: string,
  trimStrings?: readonly string[],
  params?: { charName?: string; userName?: string },
): string {
  if (!trimStrings || trimStrings.length === 0) return rawString;
  let result = rawString;
  for (const trim of trimStrings) {
    if (!trim) continue;
    const subTrim = params ? substituteMacros(trim, params, false) : trim;
    if (subTrim) {
      result = result.replaceAll(subTrim, "");
    }
  }
  return result;
}

/**
 * 运行单条正则脚本
 */
export function runRegexScript(
  script: RegexEngineScript,
  rawString: string,
  params: { charName?: string; userName?: string } = {},
): string {
  if (!script || script.disabled || !script.findRegex || !rawString) {
    return rawString;
  }

  const substituteMode = Number(script.substituteRegex ?? SubstituteFindRegex.RAW);
  let regexString = script.findRegex;

  switch (substituteMode) {
    case SubstituteFindRegex.NONE:
      break;
    case SubstituteFindRegex.RAW:
      regexString = substituteMacros(regexString, params, false);
      break;
    case SubstituteFindRegex.ESCAPED:
      regexString = substituteMacros(regexString, params, true);
      break;
    default:
      regexString = substituteMacros(regexString, params, false);
      break;
  }

  const regex = RegexProvider.instance.get(regexString);
  if (!regex) return rawString;

  const replaceTemplate = (script.replaceString ?? "").replace(/\{\{match\}\}/gi, "$0");

  try {
    return rawString.replace(regex, (...args: unknown[]) => {
      const match = args[0] as string;
      const groups = args[args.length - 1] as Record<string, string> | undefined;

      const replacedWithGroups = replaceTemplate.replace(
        /\$(\d+)|\$<([^>]+)>/g,
        (fullGroupMatch, numStr?: string, groupName?: string) => {
          let matchedContent: string | undefined;

          if (numStr !== undefined) {
            const index = Number(numStr);
            if (index === 0) {
              matchedContent = match;
            } else if (index < args.length - 2) {
              matchedContent = args[index] as string | undefined;
            }
          } else if (groupName && groups && typeof groups === "object") {
            matchedContent = groups[groupName];
          }

          if (matchedContent === undefined) return "";
          return filterTrimStrings(matchedContent, script.trimStrings, params);
        },
      );

      return substituteMacros(replacedWithGroups, params, false);
    });
  } catch (err) {
    console.warn("[runRegexScript] 执行正则替换失败:", script.scriptName, err);
    return rawString;
  }
}

/**
 * 完整正则管道流执行
 */
export function applySillyTavernRegexEngine(
  text: string,
  scripts: readonly RegexEngineScript[],
  options: RegexExecutionOptions = {},
): string {
  if (!text || !scripts || scripts.length === 0) return text;

  const {
    isAiMessage,
    charName = "",
    userName = "user",
    mode,
    placement: explicitPlacement,
    depth,
    isEdit = false,
    signal,
  } = options;

  let processed = text;
  const targetPlacement = explicitPlacement ?? (isAiMessage === true ? 2 : isAiMessage === false ? 1 : null);

  for (const script of scripts) {
    if (!script || script.disabled) continue;
    checkAborted(signal);

    // 1. 模式过滤（render: markdownOnly + 通用; prompt: promptOnly + 通用; store: 仅通用）
    if (mode === "store") {
      if (script.promptOnly || script.markdownOnly) continue;
    } else if (mode === "prompt") {
      if (script.markdownOnly) continue;
    } else {
      if (script.promptOnly) continue;
    }

    // 2. 编辑态过滤
    if (isEdit && script.runOnEdit === false) {
      continue;
    }

    // 3. 深度范围过滤（minDepth <= depth <= maxDepth）
    if (typeof depth === "number" && !Number.isNaN(depth)) {
      if (
        script.minDepth !== undefined &&
        script.minDepth !== null &&
        !Number.isNaN(script.minDepth) &&
        script.minDepth >= 0 &&
        depth < script.minDepth
      ) {
        continue;
      }
      if (
        script.maxDepth !== undefined &&
        script.maxDepth !== null &&
        !Number.isNaN(script.maxDepth) &&
        script.maxDepth >= 0 &&
        depth > script.maxDepth
      ) {
        continue;
      }
    }

    // 4. 生效位置过滤（placement）
    const scriptPlacement = script.placement;
    if (scriptPlacement !== undefined && scriptPlacement !== null) {
      const allowedPlacements = Array.isArray(scriptPlacement) ? scriptPlacement : [scriptPlacement];
      if (allowedPlacements.length > 0 && targetPlacement !== null) {
        if (!allowedPlacements.includes(targetPlacement)) {
          continue;
        }
      }
    }

    processed = runRegexScript(script, processed, { charName, userName });
  }

  return processed;
}
