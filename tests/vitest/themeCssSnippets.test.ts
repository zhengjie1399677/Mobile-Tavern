import { describe, expect, it } from "vitest";
import { analyzeThemeCss } from "../../src/domain/themes/themeCssDiagnostics";
import {
  insertThemeCssSnippet,
  THEME_CSS_SNIPPETS,
} from "../../src/domain/themes/themeCssSnippets";
import { sanitizeCss } from "../../src/utils/security";

describe("主题 CSS 片段库", () => {
  it("内置片段原样通过清洗且不产生诊断错误", () => {
    for (const snippet of THEME_CSS_SNIPPETS) {
      expect(sanitizeCss(snippet.code)).toBe(snippet.code);
      expect(analyzeThemeCss(snippet.code)).toEqual([]);
    }
  });

  it("在空文档插入片段", () => {
    const result = insertThemeCssSnippet("", "a { color: red; }", 0, 0);
    expect(result.css).toBe("a { color: red; }");
    expect(result.selectionStart).toBe(0);
    expect(result.selectionEnd).toBe("a { color: red; }".length);
  });

  it("与已有内容之间补齐空行", () => {
    const result = insertThemeCssSnippet(".a { color: red; }", "b { color: blue; }", 18, 18);
    expect(result.css).toBe(".a { color: red; }\n\nb { color: blue; }");
    expect(result.selectionStart).toBeGreaterThan(18);
  });

  it("替换选区并返回新光标范围", () => {
    const css = "/* old */";
    const result = insertThemeCssSnippet(css, "a {}", 0, css.length);
    expect(result.css).toBe("a {}");
    expect(result.selectionStart).toBe(0);
    expect(result.selectionEnd).toBe(4);
  });

  it("选择范围越界时安全钳制", () => {
    const result = insertThemeCssSnippet("abc", "x", 99, 100);
    expect(result.css).toBe("abc\n\nx");
  });
});
