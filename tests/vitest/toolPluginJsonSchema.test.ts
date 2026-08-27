import { describe, expect, it } from "vitest";
import { createToolPluginValueSchema } from "../../src/domain/toolPlugins";

describe("External Tool JSON Schema 子集", () => {
  it("严格校验对象输入和额外字段", () => {
    const schema = createToolPluginValueSchema({
      type: "object",
      properties: { city: { type: "string", minLength: 1 } },
      required: ["city"],
      additionalProperties: false,
    });
    expect(schema.safeParse({ city: "上海" }).success).toBe(true);
    expect(schema.safeParse({ city: "", debug: true }).success).toBe(false);
  });

  it("对不支持的组合关键字 fail closed", () => {
    expect(() => createToolPluginValueSchema({ oneOf: [{ type: "string" }] }))
      .toThrow("TOOL_PLUGIN_JSON_SCHEMA_UNSUPPORTED");
  });
});
