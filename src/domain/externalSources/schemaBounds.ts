/**
 * 外部 JSON Schema 收口策略。
 *
 * 外部能力源（例如 2026-07-28 之后的 MCP）允许任意 JSON Schema 2020-12 关键字，
 * 而宿主只对已登记子集负责：未知关键字一律**降级**（记录原因、按 unknown 处理），
 * 既不放宽 `.mttool` 的严格子集（`src/domain/toolPlugins/jsonSchema.ts`），也不静默接受。
 */
import { z } from "zod";

const SUPPORTED_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "title",
  "description",
  "default",
  "examples",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  // 元信息关键字：只影响文档与缓存，不参与校验，允许原样通过。
  "$schema",
  "$id",
  "$comment",
]);

const MAX_DEPTH = 12;
const MAX_NODES = 512;

export interface ExternalSchemaAssessment {
  /** 全部关键字都落在已登记子集内且未超界时为 true。 */
  readonly supported: boolean;
  readonly unsupportedKeywords: readonly string[];
  /** 降级原因（深度或节点数超界）；为空表示仅有关键字级降级。 */
  readonly degradationReasons: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assessExternalJsonSchema(schema: unknown): ExternalSchemaAssessment {
  const unsupported = new Set<string>();
  const reasons = new Set<string>();
  let nodes = 0;

  const visit = (node: unknown, path: string, depth: number): void => {
    nodes += 1;
    if (nodes > MAX_NODES) {
      reasons.add(`nodes>${MAX_NODES}`);
      return;
    }
    if (depth > MAX_DEPTH) {
      reasons.add(`depth>${MAX_DEPTH}@${path}`);
      return;
    }
    if (!isRecord(node)) return;

    for (const [key, value] of Object.entries(node)) {
      if (!SUPPORTED_KEYWORDS.has(key)) unsupported.add(`${path}.${key}`);
      if (key === "properties" && isRecord(value)) {
        for (const [name, child] of Object.entries(value)) {
          visit(child, `${path}.properties.${name}`, depth + 1);
        }
        continue;
      }
      if (key === "items" || key === "not" || key === "additionalProperties") {
        visit(value, `${path}.${key}`, depth + 1);
        continue;
      }
      if ((key === "oneOf" || key === "anyOf" || key === "allOf") && Array.isArray(value)) {
        value.forEach((child, index) => visit(child, `${path}.${key}[${index}]`, depth + 1));
      }
    }
  };

  visit(schema, "$", 0);
  const unsupportedKeywords = [...unsupported];
  const degradationReasons = [...reasons];
  return Object.freeze({
    supported: unsupportedKeywords.length === 0 && degradationReasons.length === 0,
    unsupportedKeywords,
    degradationReasons,
  });
}

/** 投影成可以发给模型的 JSON Schema：只保留已登记关键字。 */
export function projectModelVisibleJsonSchema(
  schema: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const project = (node: unknown): unknown => {
    if (!isRecord(node)) return node;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (!SUPPORTED_KEYWORDS.has(key)) continue;
      if (key === "properties" && isRecord(value)) {
        next[key] = Object.fromEntries(
          Object.entries(value).map(([name, child]) => [name, project(child)]),
        );
        continue;
      }
      if (key === "items" || key === "additionalProperties") {
        next[key] = project(value);
        continue;
      }
      next[key] = value;
    }
    return next;
  };

  return project(schema) as Readonly<Record<string, unknown>>;
}

function readDeclaredType(schema: unknown): string | undefined {
  if (!isRecord(schema)) return undefined;
  const type = schema.type;
  return typeof type === "string" ? type : undefined;
}

function matchesDeclaredType(value: unknown, type: string): boolean {
  switch (type) {
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      // 未登记类型按 unknown 处理，只记录不拦截（收口策略见本文件头注释）。
      return true;
  }
}

/**
 * 依据收口后的外部 Schema 生成输入校验器。
 * 仅校验已登记的类型关键字；未登记关键字已经在评估阶段降级。
 */
export function createExternalValueSchema(schema: unknown): z.ZodType<unknown> {
  const declaredType = readDeclaredType(schema);
  return z.unknown().superRefine((value, context) => {
    if (declaredType && !matchesDeclaredType(value, declaredType)) {
      context.addIssue({
        code: "custom",
        message: `EXTERNAL_SCHEMA_TYPE_MISMATCH:${declaredType}`,
      });
    }
  });
}
