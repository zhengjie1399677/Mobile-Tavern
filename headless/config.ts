import { z } from "zod";
import path from "node:path";

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional(),
);

const headlessEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HEADLESS_PORT: z.coerce.number().int().min(1).max(65_535).default(18080),
  // 默认只监听回环地址。历史上默认 0.0.0.0，配合"未配置 apiKey 即无鉴权"会让同网段任意主机
  // 直接读写角色/会话并以本机凭据调用 LLM；需要对外提供时必须显式改 host 并配置 HEADLESS_API_KEY。
  HEADLESS_HOST: z.string().min(1).default("127.0.0.1"),
  HEADLESS_API_KEY: optionalString,
  HEADLESS_CORS_ORIGINS: optionalString,
  HEADLESS_DATA_DIR: z.string().min(1).default("./data/headless"),
  HEADLESS_DEFAULT_PROFILE_ID: z.string().min(1).default("tavern-agent"),
  HEADLESS_LLM_BASE_URL: optionalString,
  HEADLESS_LLM_API_KEY: optionalString,
  HEADLESS_LLM_MODEL: optionalString,
});

export interface HeadlessConfig {
  readonly nodeEnvironment: "development" | "test" | "production";
  readonly isProduction: boolean;
  readonly port: number;
  readonly host: string;
  readonly apiKey?: string;
  /** CORS 白名单；为空表示不回显任何 Access-Control-Allow-Origin。 */
  readonly corsOrigins: readonly string[];
  readonly dataDir: string;
  readonly absoluteDataDir: string;
  readonly defaultProfileId: string;
  readonly llmBaseUrl?: string;
  readonly llmApiKey?: string;
  readonly llmModel?: string;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/** 判断监听地址是否只对本机可见。 */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

export function parseHeadlessConfig(
  source: NodeJS.ProcessEnv | Record<string, unknown>,
): HeadlessConfig {
  const parsed = headlessEnvironmentSchema.parse(source);
  const isProduction = parsed.NODE_ENV === "production";
  const absoluteDataDir = path.isAbsolute(parsed.HEADLESS_DATA_DIR)
    ? parsed.HEADLESS_DATA_DIR
    : path.resolve(process.cwd(), parsed.HEADLESS_DATA_DIR);

  // 安全闸门：监听非回环地址却没有鉴权，等于把全部角色/会话与 LLM 凭据公开在该网段上。
  // 这里直接拒绝启动，避免"默认配置就能被人打穿"。
  if (!isLoopbackHost(parsed.HEADLESS_HOST) && !parsed.HEADLESS_API_KEY) {
    throw new Error(
      `Headless 服务拒绝启动：HEADLESS_HOST=${parsed.HEADLESS_HOST} 会监听非回环地址，` +
        "但未配置 HEADLESS_API_KEY，任何能访问该网络的主机都可以读取/覆盖你的角色与会话，并以本机保存的凭据调用 LLM。\n" +
        "二选一修复：① 设置 HEADLESS_HOST=127.0.0.1 仅本机使用；② 配置一个足够长的 HEADLESS_API_KEY。",
    );
  }

  const corsOrigins = (parsed.HEADLESS_CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return Object.freeze({
    nodeEnvironment: parsed.NODE_ENV,
    isProduction,
    port: parsed.HEADLESS_PORT,
    host: parsed.HEADLESS_HOST,
    apiKey: parsed.HEADLESS_API_KEY,
    corsOrigins,
    dataDir: parsed.HEADLESS_DATA_DIR,
    absoluteDataDir,
    defaultProfileId: parsed.HEADLESS_DEFAULT_PROFILE_ID,
    llmBaseUrl: parsed.HEADLESS_LLM_BASE_URL,
    llmApiKey: parsed.HEADLESS_LLM_API_KEY,
    llmModel: parsed.HEADLESS_LLM_MODEL,
  });
}

export function loadHeadlessConfig(): HeadlessConfig {
  return parseHeadlessConfig(process.env);
}
