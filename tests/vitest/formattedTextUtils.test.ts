/**
 * formattedTextUtils 纯函数单元测试
 *
 * 覆盖从 FormattedText.tsx 抽取的三个纯函数：
 * - parseStyleString：CSS 内联样式解析 + 安全过滤
 * - resolveExpressionUrl：角色卡自定义协议 URL 解析
 * - convertMarkdownTablesToHtml：GFM 表格转 HTML
 */

import { describe, it, expect } from "vitest";
import { parseStyleString, resolveExpressionUrl, convertMarkdownTablesToHtml } from "../../src/components/formattedTextUtils";

// ============================================================================
// parseStyleString
// ============================================================================

describe("parseStyleString", () => {
  it("正确解析标准 CSS 样式对", () => {
    const result = parseStyleString("color: red; font-size: 14px; background: #fff");
    expect(result).toEqual({
      color: "red",
      fontSize: "14px",
      background: "#fff",
    });
  });

  it("将连字符属性转换为驼峰命名 (camelCase)", () => {
    const result = parseStyleString("background-color: blue; border-radius: 5px");
    expect(result).toEqual({
      backgroundColor: "blue",
      borderRadius: "5px",
    });
  });

  it("拦截 javascript: 协议注入", () => {
    const result = parseStyleString("color: javascript:alert(1); font-size: 14px");
    // javascript: 被过滤，但 font-size 保留
    expect(result).not.toHaveProperty("color");
    expect(result).toEqual({ fontSize: "14px" });
  });

  it("拦截 expression() CSS 动态表达式", () => {
    const result = parseStyleString("width: expression(alert(1)); height: 100px");
    expect(result).not.toHaveProperty("width");
    expect(result).toEqual({ height: "100px" });
  });

  it("behaviour 属性名本身不被过滤（仅拦截值中的恶意内容）", () => {
    // 注意：安全过滤针对的是 CSS 值（如 javascript:、expression()），
    // 属性名 behaviour 本身不含恶意值，应当被正常解析
    const result = parseStyleString("behaviour: url(evil.htc); display: block");
    expect(result).toHaveProperty("behaviour", "url(evil.htc)");
    expect(result).toHaveProperty("display", "block");
  });

  it("空字符串输入返回空对象", () => {
    expect(parseStyleString("")).toEqual({});
  });

  it("畸形的样式串（无冒号）被安全跳过", () => {
    const result = parseStyleString("invalid; color: red; also-invalid");
    expect(result).toEqual({ color: "red" });
  });

  it("样式值前后空格被 trim", () => {
    const result = parseStyleString("   color :   blue   ;  font-size : 12px  ");
    expect(result).toEqual({ color: "blue", fontSize: "12px" });
  });
});

// ============================================================================
// resolveExpressionUrl
// ============================================================================

describe("resolveExpressionUrl", () => {
  it("avatar:// 协议返回角色卡主头像", () => {
    const char = { avatar: "https://example.com/avatar.png" };
    expect(resolveExpressionUrl("avatar://", char)).toBe("https://example.com/avatar.png");
  });

  it("avatar:// 协议角色卡无头像时返回空字符串", () => {
    const char = { name: "Test" };
    expect(resolveExpressionUrl("avatar://", char)).toBe("");
  });

  it("expression:// 协议按名称解析表情数组 (visualSettings.expressions)", () => {
    const char = {
      avatar: "avatar.png",
      visualSettings: {
        expressions: [
          { name: "happy", image: "happy.png" },
          { name: "sad", image: "sad.png" },
        ],
      },
    };
    expect(resolveExpressionUrl("expression://happy", char)).toBe("happy.png");
    expect(resolveExpressionUrl("expression://sad", char)).toBe("sad.png");
  });

  it("expression:// 协议按名称解析表情对象（键值对）", () => {
    const char = {
      avatar: "avatar.png",
      extensions: {
        expressions: { smile: "smile.png", angry: "angry.png" },
      },
    };
    expect(resolveExpressionUrl("expression://smile", char)).toBe("smile.png");
    expect(resolveExpressionUrl("expression://angry", char)).toBe("angry.png");
  });

  it("expression:// 大小写不敏感", () => {
    const char = {
      visualSettings: {
        expressions: [{ name: "Joy", image: "joy.png" }],
      },
    };
    expect(resolveExpressionUrl("expression://joy", char)).toBe("joy.png");
    expect(resolveExpressionUrl("expression://JOY", char)).toBe("joy.png");
  });

  it("expression:// 未匹配表达式时降级到主头像 (Fallback)", () => {
    const char = {
      avatar: "fallback.png",
      visualSettings: {
        expressions: [{ name: "happy", image: "happy.png" }],
      },
    };
    expect(resolveExpressionUrl("expression://nonexistent", char)).toBe("fallback.png");
  });

  it("expression:// 角色卡无任何表情且无头像时降级空串", () => {
    const char = { name: "empty" };
    expect(resolveExpressionUrl("expression://any", char)).toBe("");
  });

  it("非特殊协议原样返回", () => {
    const char = { avatar: "avatar.png" };
    expect(resolveExpressionUrl("https://example.com/img.png", char)).toBe("https://example.com/img.png");
    expect(resolveExpressionUrl("some/path/file.jpg", char)).toBe("some/path/file.jpg");
  });

  it("空 srcVal 或空 roleChar 安全放行", () => {
    expect(resolveExpressionUrl("", null)).toBe("");
    // 角色卡为空时返回原始 srcVal（调用方需自行校验）
    expect(resolveExpressionUrl("avatar://", null)).toBe("avatar://");
    expect(resolveExpressionUrl("", { avatar: "test.png" })).toBe("");
  });
});

// ============================================================================
// convertMarkdownTablesToHtml
// ============================================================================

describe("convertMarkdownTablesToHtml", () => {
  it("标准 GFM 表格转换为 HTML table", () => {
    const input = `| 姓名 | 年龄 | 职业 |
|------|------|------|
| 小明 | 25 | 工程师 |
| 小红 | 30 | 设计师 |`;
    const result = convertMarkdownTablesToHtml(input);
    expect(result).toContain("<table class=\"mvu-markdown-table\">");
    expect(result).toContain("<thead><tr>");
    expect(result).toContain("<th style=\"text-align: left\">姓名</th>");
    expect(result).toContain("<td style=\"text-align: left\">小明</td>");
    expect(result).toContain("<td style=\"text-align: left\">小红</td>");
    expect(result).toContain("</tbody></table>");
  });

  it("支持对齐标记 (:--- / :---: / ---:)", () => {
    const input = `| 左对齐 | 居中 | 右对齐 |
|:-------|:----:|-------:|
| A | B | C |`;
    const result = convertMarkdownTablesToHtml(input);
    expect(result).toContain("text-align: left");
    expect(result).toContain("text-align: center");
    expect(result).toContain("text-align: right");
  });

  it("没有 | 符号的文本原样返回", () => {
    const input = "这是一段普通文本，没有管道符。";
    expect(convertMarkdownTablesToHtml(input)).toBe(input);
  });

  it("含 | 但不含分隔行的非表格文本原样保留", () => {
    const input = "这不是表格 | 只是包含管道符";
    expect(convertMarkdownTablesToHtml(input)).toBe(input);
  });

  it("多段文本 + 表格混合处理", () => {
    const input = `前面的段落。

| 项目 | 状态 |
|------|------|
| 任务A | 完成 |
| 任务B | 进行中 |

后面的段落。`;
    const result = convertMarkdownTablesToHtml(input);
    expect(result).toContain("前面的段落。");
    expect(result).toContain("<table");
    expect(result).toContain("后面的段落。");
  });

  it("表格列数不一时缺列留空", () => {
    const input = `| A | B | C |
|---|---|---|
| 1 | 2 |
| 3 | 4 | 5 |`;
    const result = convertMarkdownTablesToHtml(input);
    // 缺失栏位应留空，但表格仍然生成
    expect(result).toContain("<td style=\"text-align: left\">1</td>");
    expect(result).toContain("<td style=\"text-align: left\">2</td>");
    expect(result).toContain("<td style=\"text-align: left\"></td>");
  });

  it("空字符串输入原样返回", () => {
    expect(convertMarkdownTablesToHtml("")).toBe("");
  });
});
