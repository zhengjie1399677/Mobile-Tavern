import { describe, expect, it } from "vitest";
import {
  EXTERNAL_TOOL_RESULT_MAX_CHARS,
  buildToolArguments,
  deriveInitialToolArguments,
  findMissingRequiredArguments,
  formatExternalToolResultForConversation,
  listToolArgumentFields,
  resolvePrimaryArgumentKey,
  stringifyExternalToolResult,
  type ExternalToolInvocationPayload,
} from "../../src/components/externalTools/externalToolInvocation";

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

  it("多参数工具会生成逐参数表单，必填优先且类型判断正确", () => {
    // GitMCP 的 search_generic_documentation：owner/repo/query 都是字符串
    const schema = {
      type: "object",
      required: ["owner", "repo", "query"],
      properties: {
        owner: { type: "string", description: "仓库所有者" },
        repo: { type: "string", description: "仓库名" },
        query: { type: "string", description: "查询内容" },
        maxResults: { type: "number" },
        deep: { type: "boolean" },
      },
    };
    const fields = listToolArgumentFields(schema);
    expect(fields.map((field) => field.key)).toEqual(["owner", "repo", "query", "maxResults", "deep"]);
    expect(fields.filter((field) => field.required).map((field) => field.key)).toEqual(["owner", "repo", "query"]);
    expect(fields.find((field) => field.key === "maxResults")?.type).toBe("number");
    expect(fields.find((field) => field.key === "deep")?.type).toBe("boolean");
    expect(fields.find((field) => field.key === "query")?.primary).toBe(true);
  });

  it("草稿自动带入查询参数，并从 owner/repo 形态解析仓库参数", () => {
    const schema = {
      required: ["owner", "repo", "query"],
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        query: { type: "string" },
      },
    };
    const values = deriveInitialToolArguments(schema, "vuejs/core 的响应式原理是什么");
    expect(values.owner).toBe("vuejs");
    expect(values.repo).toBe("core");
    expect(values.query).toContain("响应式原理");
  });

  it("调用前能识别缺失的必填参数，并把表单值转换为正确类型", () => {
    const schema = {
      required: ["owner", "repo", "query"],
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        query: { type: "string" },
        maxResults: { type: "number" },
        deep: { type: "boolean" },
      },
    };
    const fields = listToolArgumentFields(schema);
    expect(findMissingRequiredArguments(fields, { owner: "vuejs", repo: " ", query: "x" }))
      .toEqual(["repo"]);
    expect(findMissingRequiredArguments(fields, {
      owner: "vuejs",
      repo: "core",
      query: "x",
    })).toEqual([]);

    const input = buildToolArguments(fields, {
      owner: "vuejs",
      repo: "core",
      query: " 响应式原理 ",
      maxResults: "3",
      deep: true,
    });
    expect(input).toEqual({
      owner: "vuejs",
      repo: "core",
      query: "响应式原理",
      maxResults: 3,
      deep: true,
    });
  });
});
