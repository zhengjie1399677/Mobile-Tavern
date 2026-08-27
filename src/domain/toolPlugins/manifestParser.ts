import { z } from "zod";
import type { ToolPluginManifest } from "./contracts";
import { assertSupportedToolPluginJsonSchema } from "./jsonSchema";

const runtimeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,127}$/);
const semverSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
const riskSchema = z.enum(["low", "medium", "high"]);
const httpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const permissionSchema = z.enum([
  "character.read",
  "session.read",
  "session.write",
  "memory.read",
  "memory.write",
  "network.request",
]);

const jsonSchemaSchema = z.record(z.string(), z.unknown()).refine(
  (value) => value.type === "object",
  "Tool JSON Schema 必须以 object 为根类型",
);

const httpRequestSchema = z.object({
  method: httpMethodSchema,
  url: z.string().trim().min(1).max(2048).refine(
    (value) => value.startsWith("https://"),
    "HTTP Tool URL 必须使用 HTTPS",
  ),
  headers: z.record(z.string().regex(/^[A-Za-z0-9-]{1,80}$/), z.string().max(4096)).optional(),
  body: z.unknown().optional(),
  credentialIds: z.array(runtimeIdSchema).max(16).optional(),
}).strict();

const toolHandlerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("http"), request: httpRequestSchema }).strict(),
  z.object({
    kind: z.literal("worker"),
    exportName: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]{0,79}$/),
  }).strict(),
]);

const manifestSchema = z.object({
  format: z.literal("mobile-tavern.tool-plugin"),
  manifestVersion: z.union([z.literal(1), z.literal(2)]),
  id: runtimeIdSchema,
  name: z.string().trim().min(1).max(80),
  version: semverSchema,
  description: z.string().trim().min(1).max(500),
  author: z.string().trim().min(1).max(120),
  source: z.object({
    label: z.string().trim().min(1).max(160),
    url: z.string().url().refine((value) => value.startsWith("https://"), "来源 URL 必须使用 HTTPS").optional(),
  }).strict(),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  runtime: z.object({
    minVersion: semverSchema,
    execution: z.enum(["worker", "sandbox"]),
    entry: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}\.js$/).optional(),
    timeoutMs: z.number().int().min(100).max(30_000).optional(),
  }).strict(),
  network: z.object({
    allowedOrigins: z.array(z.string().url().refine(isSafeHttpsOrigin, "网络来源必须是无路径的 HTTPS Origin")).min(1).max(16),
    allowedMethods: z.array(httpMethodSchema).min(1).max(5),
    maxRequestsPerCall: z.number().int().min(1).max(8),
    maxRequestBytes: z.number().int().min(1).max(256 * 1024),
    maxResponseBytes: z.number().int().min(1).max(2 * 1024 * 1024),
  }).strict().optional(),
  credentials: z.array(z.object({
    id: runtimeIdSchema,
    label: z.string().trim().min(1).max(80),
    required: z.boolean(),
    injection: z.object({
      location: z.enum(["header", "query"]),
      name: z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/),
      prefix: z.string().max(80).optional(),
    }).strict(),
  }).strict()).max(16).optional(),
  targetProfiles: z.array(runtimeIdSchema).min(1).max(16),
  dependencies: z.array(z.object({
    id: runtimeIdSchema,
    version: semverSchema,
  }).strict()).max(32),
  permissions: z.array(z.object({
    id: permissionSchema,
    reason: z.string().trim().min(1).max(240),
    riskLevel: riskSchema,
    optional: z.boolean().optional(),
  }).strict()).max(16),
  tools: z.array(z.object({
    id: runtimeIdSchema,
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(500),
    inputSchema: jsonSchemaSchema,
    outputSchema: jsonSchemaSchema,
    permissions: z.array(permissionSchema).max(16),
    riskLevel: riskSchema,
    sideEffect: z.enum(["none", "local-write", "external", "irreversible"]),
    executionScope: z.enum(["turn", "session", "memory", "character", "external"]),
    handler: toolHandlerSchema.optional(),
  }).strict()).min(1).max(32),
  cleanup: z.object({
    onDisable: z.literal("revoke-runtime"),
    onPermissionRevoke: z.literal("disable-dependent-tools"),
    onUninstall: z.array(z.enum(["registrations", "credentials", "plugin-data"]))
      .min(3)
      .refine((items) => new Set(items).size === 3, "卸载必须清理注册、凭据和插件数据"),
  }).strict(),
}).strict().superRefine((manifest, context) => {
  const declared = new Set(manifest.permissions.map((permission) => permission.id));
  assertUnique(manifest.permissions.map((permission) => permission.id), "权限声明重复", ["permissions"], context);
  assertUnique(manifest.dependencies.map((dependency) => dependency.id), "依赖 ID 重复", ["dependencies"], context);
  assertUnique(manifest.targetProfiles, "目标 Profile 重复", ["targetProfiles"], context);
  assertUnique((manifest.credentials ?? []).map((credential) => credential.id), "凭据 ID 重复", ["credentials"], context);
  if (manifest.manifestVersion === 2) {
    if (manifest.runtime.execution !== "worker") {
      context.addIssue({ code: "custom", message: "v2 Tool Plugin 只能在 Worker 中执行", path: ["runtime", "execution"] });
    }
    if (manifest.tools.some((tool) => tool.handler?.kind === "worker") && !manifest.runtime.entry) {
      context.addIssue({ code: "custom", message: "Worker Tool 必须声明 JavaScript 入口", path: ["runtime", "entry"] });
    }
    if (manifest.tools.some((tool) => !tool.handler)) {
      context.addIssue({ code: "custom", message: "v2 Tool 必须声明 handler", path: ["tools"] });
    }
  }
  const toolIds = new Set<string>();
  const credentialIds = new Set((manifest.credentials ?? []).map((credential) => credential.id));
  for (const tool of manifest.tools) {
    if (toolIds.has(tool.id)) {
      context.addIssue({ code: "custom", message: `Tool ID 重复：${tool.id}`, path: ["tools"] });
    }
    toolIds.add(tool.id);
    try {
      assertSupportedToolPluginJsonSchema(tool.inputSchema, `tools.${tool.id}.inputSchema`);
      assertSupportedToolPluginJsonSchema(tool.outputSchema, `tools.${tool.id}.outputSchema`);
    } catch (error) {
      context.addIssue({ code: "custom", message: error instanceof Error ? error.message : String(error), path: ["tools"] });
    }
    for (const permission of tool.permissions) {
      if (!declared.has(permission)) {
        context.addIssue({
          code: "custom",
          message: `Tool ${tool.id} 使用了未声明权限 ${permission}`,
          path: ["tools"],
        });
      }
    }
    if (tool.sideEffect !== "none" && tool.riskLevel === "low") {
      context.addIssue({
        code: "custom",
        message: `具有副作用的 Tool ${tool.id} 不能声明为低风险`,
        path: ["tools"],
      });
    }
    if (tool.handler?.kind === "http") {
      if (!manifest.network) {
        context.addIssue({ code: "custom", message: `HTTP Tool ${tool.id} 缺少 network 策略`, path: ["network"] });
      }
      if (!tool.permissions.includes("network.request")) {
        context.addIssue({ code: "custom", message: `HTTP Tool ${tool.id} 必须声明 network.request`, path: ["tools"] });
      }
      for (const credentialId of tool.handler.request.credentialIds ?? []) {
        if (!credentialIds.has(credentialId)) {
          context.addIssue({ code: "custom", message: `Tool ${tool.id} 引用了未声明凭据 ${credentialId}`, path: ["tools"] });
        }
      }
      for (const header of Object.keys(tool.handler.request.headers ?? {})) {
        if (/^(?:authorization|cookie|proxy-authorization)$/i.test(header)) {
          context.addIssue({ code: "custom", message: `敏感 Header ${header} 必须通过凭据注入`, path: ["tools"] });
        }
      }
    }
  }
});

export async function parseToolPluginManifest(input: string | ArrayBuffer | Uint8Array): Promise<ToolPluginManifest> {
  const text = typeof input === "string"
    ? input
    : new TextDecoder("utf-8", { fatal: true }).decode(
      input instanceof Uint8Array ? input : new Uint8Array(input),
    );
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("TOOL_PLUGIN_MANIFEST_INVALID_JSON");
  }
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`TOOL_PLUGIN_MANIFEST_INVALID:${parsed.error.issues[0]?.message ?? "unknown"}`);
  }
  const { contentHash, ...hashable } = parsed.data;
  const computed = await computeToolPluginManifestHash(hashable);
  if (contentHash !== computed) throw new Error("TOOL_PLUGIN_CONTENT_HASH_MISMATCH");
  return structuredClone(parsed.data) as ToolPluginManifest;
}

export function parseToolPluginManifestValue(value: unknown): ToolPluginManifest {
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`TOOL_PLUGIN_MANIFEST_INVALID:${parsed.error.issues[0]?.message ?? "unknown"}`);
  }
  return structuredClone(parsed.data) as ToolPluginManifest;
}

export async function computeToolPluginManifestHash(value: unknown): Promise<`sha256:${string}`> {
  const bytes = new TextEncoder().encode(canonicalizeToolPluginValue(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `sha256:${[...digest].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

export function canonicalizeToolPluginValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalizeToolPluginValue).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalizeToolPluginValue(record[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function isSafeHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.origin === value.replace(/\/$/, "")
      && !url.username
      && !url.password
      && !isBlockedHostname(url.hostname);
  } catch {
    return false;
  }
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized === "::1") return true;
  if (/^(?:fc|fd|fe8|fe9|fea|feb)[0-9a-f]*:/i.test(normalized)) return true;
  if (/^(?:127|10|0)\./.test(normalized) || /^169\.254\./.test(normalized) || /^192\.168\./.test(normalized)) return true;
  const match = /^172\.(\d{1,3})\./.exec(normalized);
  return match ? Number(match[1]) >= 16 && Number(match[1]) <= 31 : false;
}

function assertUnique(
  values: readonly string[],
  message: string,
  path: (string | number)[],
  context: z.RefinementCtx,
): void {
  if (new Set(values).size !== values.length) context.addIssue({ code: "custom", message, path });
}
