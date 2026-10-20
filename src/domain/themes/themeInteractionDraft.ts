/**
 * 主题交互草稿的纯函数。
 *
 * 工作室的权威数据仍是 `interactionSource` 字符串；可视化编辑器在此基础上
 * 解析/序列化结构化配置，并生成稳定、合法的默认 ID。
 */

import {
  parseThemeInteractionConfigDetailed,
  type ThemeInteractionConfig,
} from "./themeInteractionContract";

export interface ThemeInteractionSourceParseResult {
  success: boolean;
  errors: string[];
  config?: ThemeInteractionConfig;
}

/** 解析 `{ media, state, interactions }` 源；错误保留契约的路径前缀。 */
export function parseThemeInteractionSource(
  source: string,
): ThemeInteractionSourceParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, errors: [`交互规则 JSON 无法解析：${message}`] };
  }
  const parsed = parseThemeInteractionConfigDetailed(raw);
  return {
    success: parsed.success,
    errors: parsed.errors,
    config: parsed.config,
  };
}

export function serializeThemeInteractionSource(config: ThemeInteractionConfig): string {
  return JSON.stringify(config, null, 2);
}

export function isThemeInteractionConfigEmpty(config: ThemeInteractionConfig): boolean {
  return Object.keys(config.media).length === 0 &&
    Object.keys(config.state).length === 0 &&
    config.interactions.length === 0;
}

/** 自动 schema：只有存在媒体、状态或规则时才需要 Theme 1.1。 */
export function deriveThemeInteractionSchemaVersion(
  config: ThemeInteractionConfig,
): "1.0" | "1.1" {
  return isThemeInteractionConfigEmpty(config) ? "1.0" : "1.1";
}

/** 与运行时一致：每个状态贡献一个 `key-value` token。 */
export function getDefaultThemeStateTokens(config: ThemeInteractionConfig): string[] {
  const tokens = new Set<string>();
  for (const [key, definition] of Object.entries(config.state)) {
    tokens.add(`${key}-${definition.default}`);
  }
  return [...tokens].sort();
}

function normalizeIdentifierBase(base: string, allowDot: boolean): string {
  const pattern = allowDot ? /[^a-z0-9.-]/g : /[^a-z0-9-]/g;
  const normalized = base.toLowerCase().replace(pattern, "-").replace(/^[^a-z]+/, "");
  return normalized || "item";
}

function createUniqueIdentifier(
  base: string,
  existing: Iterable<string>,
  maxLength: number,
  allowDot: boolean,
): string {
  const taken = new Set(existing);
  const normalized = normalizeIdentifierBase(base, allowDot).slice(0, Math.max(1, maxLength - 4));
  for (let index = 1; index < 10_000; index += 1) {
    const suffix = index === 1 ? "" : `-${index}`;
    const candidate = `${normalized}${suffix}`.slice(0, maxLength);
    if (!taken.has(candidate)) return candidate;
  }
  return `${normalized}-${Date.now()}`.slice(0, maxLength);
}

export function createThemeMediaId(config: ThemeInteractionConfig): string {
  return createUniqueIdentifier("media", Object.keys(config.media), 64, true);
}

export function createThemeStateKey(
  config: ThemeInteractionConfig,
  base = "state",
): string {
  return createUniqueIdentifier(base, Object.keys(config.state), 40, false);
}

export function createThemeRuleId(config: ThemeInteractionConfig): string {
  return createUniqueIdentifier(
    "rule",
    config.interactions.map(rule => rule.id),
    64,
    true,
  );
}
