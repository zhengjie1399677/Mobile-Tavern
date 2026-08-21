/**
 * 将用户主题 CSS 限定到指定主题根节点。
 *
 * 这里不限制用户可命中的应用组件，只负责保证规则仅在对应 data-theme 激活时生效。
 * 分组型 at-rule 会递归处理；关键帧等声明型 at-rule 保持原样。
 */

/** 这些 at-rule 的块内容是声明或关键帧，不包含需要再次限定的普通选择器。 */
const DECLARATION_AT_RULE = /^@(?:-webkit-)?(?:keyframes)\b|^@(font-face|page|property|counter-style|font-feature-values|font-palette-values|view-transition)\b/i;

interface CssBoundary {
  index: number;
  token: ";" | "{";
}

function findNextBoundary(css: string, start: number): CssBoundary | null {
  let quote: "'" | '"' | null = null;
  let inComment = false;
  let parentheses = 0;
  let brackets = 0;

  for (let index = start; index < css.length; index += 1) {
    const char = css[index];
    const next = css[index + 1];

    if (inComment) {
      if (char === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(") parentheses += 1;
    else if (char === ")" && parentheses > 0) parentheses -= 1;
    else if (char === "[") brackets += 1;
    else if (char === "]" && brackets > 0) brackets -= 1;
    else if (parentheses === 0 && brackets === 0 && (char === ";" || char === "{")) {
      return { index, token: char };
    }
  }

  return null;
}

function findMatchingBrace(css: string, openIndex: number): number {
  let depth = 1;
  let quote: "'" | '"' | null = null;
  let inComment = false;

  for (let index = openIndex + 1; index < css.length; index += 1) {
    const char = css[index];
    const next = css[index + 1];

    if (inComment) {
      if (char === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      inComment = true;
      index += 1;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return css.length - 1;
}

function splitSelectorList(selectorList: string): string[] {
  const selectors: string[] = [];
  let start = 0;
  let quote: "'" | '"' | null = null;
  let inComment = false;
  let parentheses = 0;
  let brackets = 0;

  for (let index = 0; index < selectorList.length; index += 1) {
    const char = selectorList[index];
    const next = selectorList[index + 1];

    if (inComment) {
      if (char === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "*") {
      inComment = true;
      index += 1;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "(") {
      parentheses += 1;
    } else if (char === ")" && parentheses > 0) {
      parentheses -= 1;
    } else if (char === "[") {
      brackets += 1;
    } else if (char === "]" && brackets > 0) {
      brackets -= 1;
    } else if (char === "," && parentheses === 0 && brackets === 0) {
      selectors.push(selectorList.slice(start, index));
      start = index + 1;
    }
  }

  selectors.push(selectorList.slice(start));
  return selectors;
}

function scopeSingleSelector(rawSelector: string, scopeSelector: string): string {
  const leadingTrivia = rawSelector.match(/^(?:(?:\s+)|(?:\/\*[\s\S]*?\*\/))*/)?.[0] ?? "";
  const selector = rawSelector.slice(leadingTrivia.length).trim();
  if (!selector) return rawSelector;

  if (selector.startsWith(scopeSelector)) {
    return `${leadingTrivia}${selector}`;
  }

  if (/^:root(?=$|[.#[:\s>+~])/i.test(selector)) {
    return `${leadingTrivia}${selector.replace(/^:root/i, scopeSelector)}`;
  }

  if (/^html(?=$|[.#[:\s>+~])/i.test(selector)) {
    return `${leadingTrivia}${selector.replace(/^html/i, scopeSelector)}`;
  }

  return `${leadingTrivia}${scopeSelector} ${selector}`;
}

function scopeSelectorList(selectorList: string, scopeSelector: string): string {
  return splitSelectorList(selectorList)
    .map(selector => scopeSingleSelector(selector, scopeSelector))
    .join(",");
}

function withoutComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, "").trim();
}

function scopeCssRange(css: string, scopeSelector: string): string {
  let output = "";
  let cursor = 0;

  while (cursor < css.length) {
    const boundary = findNextBoundary(css, cursor);
    if (!boundary) {
      output += css.slice(cursor);
      break;
    }

    if (boundary.token === ";") {
      output += css.slice(cursor, boundary.index + 1);
      cursor = boundary.index + 1;
      continue;
    }

    const closeIndex = findMatchingBrace(css, boundary.index);
    const prelude = css.slice(cursor, boundary.index);
    const normalizedPrelude = withoutComments(prelude);
    const body = css.slice(boundary.index + 1, closeIndex);

    if (DECLARATION_AT_RULE.test(normalizedPrelude)) {
      output += `${prelude}{${body}}`;
    } else if (normalizedPrelude.startsWith("@")) {
      // 默认递归未知的分组型 at-rule，避免新 CSS 语法（如 @scope、@starting-style）
      // 成为绕过主题作用域的出口。
      output += `${prelude}{${scopeCssRange(body, scopeSelector)}}`;
    } else {
      output += `${scopeSelectorList(prelude, scopeSelector)}{${body}}`;
    }

    cursor = closeIndex + 1;
  }

  return output;
}

export function scopeThemeCss(css: string, scopeSelector: string): string {
  if (!css.trim()) return "";
  return scopeCssRange(css, scopeSelector);
}
