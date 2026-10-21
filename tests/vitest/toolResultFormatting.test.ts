import { describe, expect, it } from "vitest";
import {
  extractResultUrls,
  formatAgentToolResult,
} from "../../src/application/useCases/toolResultFormatting";

/**
 * 用户反馈（2026-10-22）：点「插入输入框」时把 `200`、`application/json`
 * 一起插进了对话。这里钉住"只插入数据正文"的行为。
 */
describe("工具结果格式化", () => {
  it("剥离 HTTP 执行信封，只保留 body 数据", () => {
    const text = formatAgentToolResult({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [{ title: "唐朝", url: "https://example.com/tang" }] }),
    });

    expect(text).not.toContain("200");
    expect(text).not.toContain("application/json");
    expect(text).toContain("唐朝");
    expect(text).toContain("https://example.com/tang");
    // JSON 文本被展开成可读缩进
    expect(text).toContain("\n");
  });

  it("失败状态单独成行，不伪装成正常数据", () => {
    const text = formatAgentToolResult({ status: 401, contentType: "text/plain", body: "invalid api key" });
    expect(text.startsWith("请求失败（HTTP 401）")).toBe(true);
    expect(text).toContain("invalid api key");
  });

  it("已有 text 字段时直接取正文", () => {
    expect(formatAgentToolResult({ text: "正文内容", raw: { status: 200 } })).toBe("正文内容");
  });

  it("原始字符串若是 JSON 则展开，否则原样返回", () => {
    expect(formatAgentToolResult('{"a":1}')).toContain('"a": 1');
    expect(formatAgentToolResult("plain text")).toBe("plain text");
  });
});

describe("结果里的 URL 接力", () => {
  it("去重并去掉尾部标点，最多取 3 条", () => {
    const urls = extractResultUrls(
      "见 https://a.com/x，以及 https://b.com/y。参考 https://a.com/x 和 https://c.com/z、https://d.com/w",
    );
    expect(urls).toEqual(["https://a.com/x", "https://b.com/y", "https://c.com/z"]);
  });

  it("没有 URL 时返回空数组", () => {
    expect(extractResultUrls("纯文本结果")).toEqual([]);
  });
});
