/**
 * 主题工作室的 CSS 片段库。
 *
 * 片段只使用稳定的 `data-ui` 语义选择器，且必须能原样通过 `sanitizeCss`、
 * 不产生诊断错误。标题与说明由 UI 通过 `theme_studio.snippets.<id>` 本地化。
 */

export interface ThemeCssSnippet {
  id: string;
  code: string;
}

export interface ThemeCssInsertionResult {
  css: string;
  selectionStart: number;
  selectionEnd: number;
}

export const THEME_CSS_SNIPPETS: readonly ThemeCssSnippet[] = [
  {
    id: "tab-bar-accent",
    code: '[data-ui="main-tab-bar"] {\n  border-top-color: var(--primary);\n}',
  },
  {
    id: "rounded-surfaces",
    code: '[data-ui="chat-surface"],\n[data-ui="main-tab-content"] {\n  border-radius: calc(var(--radius) * 1.25);\n}',
  },
  {
    id: "muted-borders",
    code: '[data-ui="chat-surface"] {\n  border-color: var(--border);\n}',
  },
  {
    id: "chat-bubble",
    code: '[data-ui="chat-shell"] [data-ui="chat-surface"] {\n  background: var(--card);\n  color: var(--card-foreground);\n}',
  },
  {
    id: "active-tab-glow",
    code: '[data-ui="main-tab"][aria-selected="true"] {\n  color: var(--primary);\n  box-shadow: 0 0 0 1px var(--ring);\n}',
  },
  {
    id: "reduced-motion",
    code: '@media (prefers-reduced-motion: reduce) {\n  [data-ui="main-tab"] {\n    transition: none;\n  }\n}',
  },
  {
    id: "state-token",
    code: ':root[data-theme-state~="ambient-active"] [data-ui="main-tab-bar"] {\n  border-top-color: var(--primary);\n}',
  },
  {
    id: "focus-ring",
    code: '[data-ui="attachment-picker"] {\n  outline-color: var(--ring);\n}',
  },
];

/**
 * 在光标/选区处插入片段；自动补齐与相邻内容之间的空行，并返回新的光标范围。
 */
export function insertThemeCssSnippet(
  css: string,
  code: string,
  selectionStart: number,
  selectionEnd: number,
): ThemeCssInsertionResult {
  const start = Math.max(0, Math.min(selectionStart, css.length));
  const end = Math.max(start, Math.min(selectionEnd, css.length));
  const before = css.slice(0, start);
  const after = css.slice(end);
  const snippet = code.trim();

  const leading = before.length === 0
    ? ""
    : before.endsWith("\n")
      ? "\n"
      : "\n\n";
  const trailing = after.length === 0
    ? ""
    : after.startsWith("\n")
      ? "\n"
      : "\n\n";

  const insertion = `${leading}${snippet}${trailing}`;
  const selectionStartAfter = before.length + leading.length;
  return {
    css: `${before}${insertion}${after}`,
    selectionStart: selectionStartAfter,
    selectionEnd: selectionStartAfter + snippet.length,
  };
}
