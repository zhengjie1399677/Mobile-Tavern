import { describe, expect, it } from "vitest";
import { analyzeThemeCss } from "../../src/domain/themes/themeCssDiagnostics";

describe("主题 CSS 只读诊断", () => {
  it("合法 CSS 不产生诊断", () => {
    expect(analyzeThemeCss('[data-ui="main-tab-bar"] { border-color: var(--primary); }')).toEqual([]);
  });

  it("定位多余的右花括号", () => {
    const css = "a { color: red; } }";
    const diagnostics = analyzeThemeCss(css);
    const stray = diagnostics.find(item => item.code === "unexpected-closing-brace");
    expect(stray).toMatchObject({
      severity: "error",
      offset: css.lastIndexOf("}"),
      line: 1,
      column: css.lastIndexOf("}") + 1,
    });
  });

  it("定位未闭合的花括号与圆括号", () => {
    const braceDiagnostics = analyzeThemeCss("a { color: red;");
    expect(braceDiagnostics.find(item => item.code === "unclosed-brace")).toMatchObject({
      offset: 2,
      line: 1,
      column: 3,
    });

    const parenDiagnostics = analyzeThemeCss("a { color: rgb(1, 2, 3; }");
    expect(parenDiagnostics.find(item => item.code === "unclosed-paren")).toMatchObject({
      severity: "error",
      line: 1,
    });
  });

  it("定位未闭合的注释与字符串", () => {
    const comment = analyzeThemeCss("a {}\n/* hello");
    expect(comment.find(item => item.code === "unterminated-comment")).toMatchObject({
      line: 2,
      column: 1,
    });

    const stringCss = 'a { content: "hello; }';
    expect(analyzeThemeCss(stringCss).find(item => item.code === "unterminated-string")).toMatchObject({
      line: 1,
      column: stringCss.indexOf('"') + 1,
    });
  });

  it("标出会被清洗掉的禁用内容", () => {
    const codes = analyzeThemeCss([
      '@import url("x.css");',
      ".a { position: fixed; }",
      ".b { --safe-area-top: 10px; }",
      ".c { background: url(https://example.com/x.png); }",
      ".d { filter: expression(alert(1)); }",
      ".e { -moz-binding: url(x); behavior: url(y); }",
    ].join("\n")).map(item => item.code);
    expect(codes).toEqual(expect.arrayContaining([
      "forbidden-import",
      "forbidden-url",
      "forbidden-position-fixed",
      "forbidden-safe-area",
      "forbidden-protocol",
      "forbidden-expression",
      "forbidden-moz-binding",
      "forbidden-behavior",
    ]));
  });

  it("Safe Area 只拦截变量声明，不拦截 env() 正常取值", () => {
    expect(analyzeThemeCss(".a { padding: env(safe-area-inset-top); }")).toEqual([]);
    expect(analyzeThemeCss(".a { --safe-area-top: 10px; }").map(item => item.code))
      .toEqual(["forbidden-safe-area"]);
  });

  it("scroll-behavior 是合法属性，不误报为 behavior", () => {
    expect(analyzeThemeCss(".a { scroll-behavior: smooth; }")).toEqual([]);
    expect(analyzeThemeCss(".a { behavior: url(x); }").map(item => item.code))
      .toEqual(expect.arrayContaining(["forbidden-behavior"]));
  });

  it("注释与字符串中的禁用文本不误报", () => {
    expect(analyzeThemeCss("/* @import url(http://x) */ a { color: red; }")).toEqual([]);
    expect(analyzeThemeCss('a { content: "@import url(http://x)"; }')).toEqual([]);
  });

  it("CRLF 下行列仍按 1-based 计算", () => {
    const css = "a {\r\n  color: red;\r\n}\r\n}";
    const diagnostics = analyzeThemeCss(css);
    expect(diagnostics.find(item => item.code === "unexpected-closing-brace")).toMatchObject({
      line: 4,
      column: 1,
    });
  });

  it("字符串内的 url 不产生 url 诊断，但字符串外的 url 会产生", () => {
    expect(analyzeThemeCss('a { background: url("x.png"); }').map(item => item.code))
      .toEqual(["forbidden-url"]);
  });
});
