/**
 * 主题自定义 CSS 的只读诊断。
 *
 * 运行时仍由 `sanitizeCss` 做最终清洗；这里只负责把结构错误和会被清洗掉的
 * 内容提前告诉作者，并给出 1-based 行列位置。诊断不修改 CSS，也不替代清洗。
 */

export type ThemeCssDiagnosticSeverity = "error" | "warning";

export type ThemeCssDiagnosticCode =
  | "unterminated-comment"
  | "unterminated-string"
  | "unexpected-closing-brace"
  | "unexpected-closing-paren"
  | "unexpected-closing-bracket"
  | "unclosed-brace"
  | "unclosed-paren"
  | "unclosed-bracket"
  | "forbidden-import"
  | "forbidden-url"
  | "forbidden-image-set"
  | "forbidden-protocol"
  | "forbidden-position-fixed"
  | "forbidden-safe-area"
  | "forbidden-expression"
  | "forbidden-moz-binding"
  | "forbidden-behavior";

export interface ThemeCssDiagnostic {
  code: ThemeCssDiagnosticCode;
  severity: ThemeCssDiagnosticSeverity;
  /** 领域层默认中文文案；UI 可按 code 覆盖为本地化文案。 */
  message: string;
  offset: number;
  length: number;
  /** 1-based 行号。 */
  line: number;
  /** 1-based 列号。 */
  column: number;
}

interface ForbiddenPattern {
  code: ThemeCssDiagnosticCode;
  pattern: RegExp;
  message: string;
}

const FORBIDDEN_PATTERNS: readonly ForbiddenPattern[] = [
  { code: "forbidden-import", pattern: /@import\b/gi, message: "@import 会在预览与保存时被移除，请改用主题资源引用。" },
  { code: "forbidden-url", pattern: /\burl\s*\(/gi, message: "url() 会在预览与保存时被移除，请使用主题资源变量或本地资源引用。" },
  { code: "forbidden-image-set", pattern: /\bimage-set\s*\(/gi, message: "image-set() 不受支持，会在预览与保存时被移除。" },
  { code: "forbidden-protocol", pattern: /\b(?:https?|data|blob|file):/gi, message: "远程、data、blob 与 file 协议会在预览与保存时被移除。" },
  { code: "forbidden-position-fixed", pattern: /position\s*:\s*fixed\b/gi, message: "position: fixed 会破坏移动端布局，已被禁用。" },
  { code: "forbidden-safe-area", pattern: /--(?:android-)?safe-area[\w-]*\s*:/gi, message: "主题不得重新声明 Safe Area 变量，相关声明会被移除。" },
  { code: "forbidden-expression", pattern: /\bexpression\s*\(/gi, message: "IE expression() 不受支持，且会被移除。" },
  { code: "forbidden-moz-binding", pattern: /-moz-binding\s*:/gi, message: "-moz-binding 不受支持，且会被移除。" },
  { code: "forbidden-behavior", pattern: /\bbehavior\s*:/gi, message: "behavior 属性不受支持，且会被移除。" },
];

function buildLineStarts(css: string): number[] {
  const starts = [0];
  for (let index = 0; index < css.length; index += 1) {
    if (css[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function positionAt(lineStarts: number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (lineStarts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low + 1, column: offset - lineStarts[low] + 1 };
}

/**
 * 扫描自定义 CSS，返回按位置排序的诊断。
 *
 * 结构性错误（未闭合注释/字符串/括号）与被清洗内容都标记为 error；
 * 注释和字符串内部不参与禁用内容匹配。
 */
export function analyzeThemeCss(css: string): ThemeCssDiagnostic[] {
  const lineStarts = buildLineStarts(css);
  const issues: ThemeCssDiagnostic[] = [];
  const masked = css.split("");

  const addIssue = (
    code: ThemeCssDiagnosticCode,
    severity: ThemeCssDiagnosticSeverity,
    offset: number,
    length: number,
    message: string,
  ): void => {
    const position = positionAt(lineStarts, offset);
    issues.push({ code, severity, message, offset, length, ...position });
  };

  const braceStack: number[] = [];
  const parenStack: number[] = [];
  const bracketStack: number[] = [];

  let index = 0;
  while (index < css.length) {
    const char = css[index];
    const next = css[index + 1];

    if (char === "/" && next === "*") {
      const start = index;
      index += 2;
      let closed = false;
      while (index < css.length) {
        if (css[index] === "*" && css[index + 1] === "/") {
          index += 2;
          closed = true;
          break;
        }
        index += 1;
      }
      if (!closed) {
        addIssue(
          "unterminated-comment",
          "error",
          start,
          css.length - start,
          "注释没有闭合（缺少 */）。",
        );
      }
      for (let cursor = start; cursor < index && cursor < masked.length; cursor += 1) {
        masked[cursor] = " ";
      }
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      const start = index;
      index += 1;
      let closed = false;
      while (index < css.length) {
        const inner = css[index];
        if (inner === "\\") {
          index += 2;
          continue;
        }
        if (inner === quote) {
          index += 1;
          closed = true;
          break;
        }
        if (inner === "\n" || inner === "\r") break;
        index += 1;
      }
      if (!closed) {
        addIssue(
          "unterminated-string",
          "error",
          start,
          Math.max(1, index - start),
          "字符串没有闭合（缺少结束引号）。",
        );
      }
      for (let cursor = start; cursor < index && cursor < masked.length; cursor += 1) {
        masked[cursor] = " ";
      }
      continue;
    }

    if (char === "{") braceStack.push(index);
    else if (char === "}") {
      if (braceStack.length === 0) {
        addIssue("unexpected-closing-brace", "error", index, 1, "出现了多余的右花括号 }。");
      } else {
        braceStack.pop();
      }
    } else if (char === "(") parenStack.push(index);
    else if (char === ")") {
      if (parenStack.length === 0) {
        addIssue("unexpected-closing-paren", "error", index, 1, "出现了多余的右圆括号 )。");
      } else {
        parenStack.pop();
      }
    } else if (char === "[") bracketStack.push(index);
    else if (char === "]") {
      if (bracketStack.length === 0) {
        addIssue("unexpected-closing-bracket", "error", index, 1, "出现了多余的右方括号 ]。");
      } else {
        bracketStack.pop();
      }
    }

    index += 1;
  }

  for (const offset of braceStack) {
    addIssue("unclosed-brace", "error", offset, 1, "花括号没有闭合（缺少 }）。");
  }
  for (const offset of parenStack) {
    addIssue("unclosed-paren", "error", offset, 1, "圆括号没有闭合（缺少 )）。");
  }
  for (const offset of bracketStack) {
    addIssue("unclosed-bracket", "error", offset, 1, "方括号没有闭合（缺少 ]）。");
  }

  const maskedText = masked.join("");
  for (const { code, pattern, message } of FORBIDDEN_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(maskedText);
    while (match) {
      addIssue(code, "error", match.index, match[0].length, message);
      match = pattern.exec(maskedText);
    }
  }

  return issues.sort((left, right) => left.offset - right.offset);
}
