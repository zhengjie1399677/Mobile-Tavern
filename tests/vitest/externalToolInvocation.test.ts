import { describe, expect, it } from "vitest";
import {
  buildToolArguments,
  deriveInitialToolArguments,
  extractToolResultData,
  findMissingRequiredArguments,
  listToolArgumentFields,
  resolvePrimaryArgumentKey,
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

  it("插入正文只取数据本身，绝不带 { text, raw, isError } 包装", () => {
    // 运行时包装：text 是数据，raw 是协议原文 —— 只能取 text
    const wrapped = {
      text: "老张把钥匙交给了主角。",
      raw: { content: [{ type: "text", text: "老张把钥匙交给了主角。" }], isError: false },
      isError: false,
    };
    expect(extractToolResultData(wrapped)).toBe("老张把钥匙交给了主角。");
    expect(extractToolResultData(wrapped)).not.toContain("raw");
    expect(extractToolResultData(wrapped)).not.toContain("isError");

    expect(extractToolResultData("纯字符串结果")).toBe("纯字符串结果");
    expect(extractToolResultData({ content: [{ type: "text", text: "A" }, { type: "text", text: "B" }] }))
      .toBe("A\nB");
    expect(extractToolResultData({ foo: 1 })).toBe('{\n  "foo": 1\n}');
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
