import { z } from "zod";

const SUPPORTED_TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);

export function createToolPluginValueSchema(schema: Readonly<Record<string, unknown>>): z.ZodType<unknown> {
  assertSupportedToolPluginJsonSchema(schema);
  return z.unknown().superRefine((value, context) => {
    const issue = validateValue(value, schema, "$");
    if (issue) context.addIssue({ code: "custom", message: issue });
  });
}

export function assertSupportedToolPluginJsonSchema(
  schema: Readonly<Record<string, unknown>>,
  path = "$",
): void {
  const type = schema.type;
  if (typeof type !== "string" || !SUPPORTED_TYPES.has(type)) {
    throw new Error(`TOOL_PLUGIN_JSON_SCHEMA_UNSUPPORTED:${path}.type`);
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    throw new Error(`TOOL_PLUGIN_JSON_SCHEMA_UNSUPPORTED:${path}.enum`);
  }
  if (type === "object") {
    const properties = schema.properties;
    if (properties !== undefined && (!isRecord(properties) || Object.values(properties).some((item) => !isRecord(item)))) {
      throw new Error(`TOOL_PLUGIN_JSON_SCHEMA_UNSUPPORTED:${path}.properties`);
    }
    if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((item) => typeof item !== "string"))) {
      throw new Error(`TOOL_PLUGIN_JSON_SCHEMA_UNSUPPORTED:${path}.required`);
    }
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") {
      throw new Error(`TOOL_PLUGIN_JSON_SCHEMA_UNSUPPORTED:${path}.additionalProperties`);
    }
    for (const [key, child] of Object.entries((properties ?? {}) as Record<string, Readonly<Record<string, unknown>>>)) {
      assertSupportedToolPluginJsonSchema(child, `${path}.properties.${key}`);
    }
  }
  if (type === "array") {
    if (!isRecord(schema.items)) throw new Error(`TOOL_PLUGIN_JSON_SCHEMA_UNSUPPORTED:${path}.items`);
    assertSupportedToolPluginJsonSchema(schema.items, `${path}.items`);
  }
}

function validateValue(value: unknown, schema: Readonly<Record<string, unknown>>, path: string): string | null {
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) return `${path} 不在允许值中`;
  switch (schema.type) {
    case "null": return value === null ? null : `${path} 必须为 null`;
    case "boolean": return typeof value === "boolean" ? null : `${path} 必须为 boolean`;
    case "string": {
      if (typeof value !== "string") return `${path} 必须为 string`;
      if (typeof schema.minLength === "number" && value.length < schema.minLength) return `${path} 长度不足`;
      if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return `${path} 长度超限`;
      if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) return `${path} 格式不匹配`;
      return null;
    }
    case "number":
    case "integer": {
      if (typeof value !== "number" || !Number.isFinite(value)) return `${path} 必须为 number`;
      if (schema.type === "integer" && !Number.isInteger(value)) return `${path} 必须为 integer`;
      if (typeof schema.minimum === "number" && value < schema.minimum) return `${path} 小于最小值`;
      if (typeof schema.maximum === "number" && value > schema.maximum) return `${path} 大于最大值`;
      return null;
    }
    case "array": {
      if (!Array.isArray(value)) return `${path} 必须为 array`;
      if (typeof schema.minItems === "number" && value.length < schema.minItems) return `${path} 项数不足`;
      if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return `${path} 项数超限`;
      const itemSchema = schema.items as Readonly<Record<string, unknown>>;
      for (let index = 0; index < value.length; index += 1) {
        const issue = validateValue(value[index], itemSchema, `${path}[${index}]`);
        if (issue) return issue;
      }
      return null;
    }
    case "object": {
      if (!isRecord(value)) return `${path} 必须为 object`;
      const properties = (schema.properties ?? {}) as Record<string, Readonly<Record<string, unknown>>>;
      const required = new Set((schema.required ?? []) as string[]);
      for (const key of required) if (!(key in value)) return `${path}.${key} 为必填项`;
      if (schema.additionalProperties === false) {
        const unknownKey = Object.keys(value).find((key) => !(key in properties));
        if (unknownKey) return `${path}.${unknownKey} 不被允许`;
      }
      for (const [key, child] of Object.entries(properties)) {
        if (key in value) {
          const issue = validateValue(value[key], child, `${path}.${key}`);
          if (issue) return issue;
        }
      }
      return null;
    }
    default: return `${path} Schema 不受支持`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
