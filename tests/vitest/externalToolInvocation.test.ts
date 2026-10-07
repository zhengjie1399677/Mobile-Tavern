import { describe, expect, it } from "vitest";
import {
  EXTERNAL_TOOL_RESULT_MAX_CHARS,
  formatExternalToolResultForConversation,
  resolvePrimaryArgumentKey,
  stringifyExternalToolResult,
  type ExternalToolInvocationPayload,
} from "../../src/components/externalTools/ExternalToolInvocationSheet";

describe("外部工具显性调用辅助逻辑", () => {
  it("优先把查询写进 query/prompt 等常见参数", () => {
    expect(resolvePrimaryArgumentKey({ properties: { text: { type: "string" }, query: { type: "string" } } }))
      .toBe("query");
    expect(resolvePrimaryArgumentKey({ properties: { nickname: { type: "string" } } }))
      .toBe("nickname");
    expect(resolvePrimaryArgumentKey({ properties: { count: { type: "number" } } }))
      .toBe("count");
    expect(resolvePrimaryArgumentKey({})).toBeNull();
  });

  it("格式化结果并截断超长返回", () => {
    const payload: ExternalToolInvocationPayload = {
      target: {
        sourceId: "deepwiki",
        sourceName: "DeepWiki",
        tool: {
          sourceId: "deepwiki",
          qualifiedName: "mcp.deepwiki.ask_question",
          localName: "ask_question",
          description: "问答",
          inputSchema: { properties: { query: { type: "string" } } },
        },
      },
      input: { query: "2001 年大事" },
      query: "2001 年大事",
      resultText: "答".repeat(EXTERNAL_TOOL_RESULT_MAX_CHARS + 50),
      durationMs: 123,
    };

    const text = formatExternalToolResultForConversation(payload);

    expect(text).toContain("【外部能力结果 · DeepWiki/ask_question】");
    expect(text).toContain("耗时 123ms");
    expect(text).toContain("2001 年大事");
    expect(text).toContain("结果过长已截断");
    expect(text.length).toBeLessThan(EXTERNAL_TOOL_RESULT_MAX_CHARS + 200);
  });

  it("对象结果序列化为 JSON，字符串原样返回", () => {
    expect(stringifyExternalToolResult("plain")).toBe("plain");
    expect(stringifyExternalToolResult({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});
