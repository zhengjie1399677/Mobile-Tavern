import { z } from "zod";

const DEVELOPMENT_HMAC_SIGN_KEY = "default_local_hmac_sign_key_123456";
const DEVELOPMENT_AES_ENCRYPT_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const DEVELOPMENT_TRIAL_API_KEY =
  "sk-or-v1-TRIAL_KEY_PLACEHOLDER_LOCAL_DEVELOPMENT_FALLBACK";
const DEFAULT_CATBOT_FC_URL =
  "https://catbot-gmkodirnhh.cn-hangzhou.fcapp.run/api/catbot";

const optionalString = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().optional(),
);

const serverEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  TAURI_DEV_HOST: z.string().min(1).default("0.0.0.0"),
  HMAC_SIGN_KEY: optionalString,
  AES_ENCRYPT_KEY: optionalString,
  REAL_API_KEY: optionalString,
  TRIAL_OPENROUTER_KEY: optionalString,
  CATBOT_FC_URL: z.string().url().default(DEFAULT_CATBOT_FC_URL),
  DASHSCOPE_API_KEY: optionalString,
});

export interface ServerConfig {
  nodeEnvironment: "development" | "test" | "production";
  isProduction: boolean;
  port: number;
  host: string;
  hmacSignKey: string;
  aesEncryptKey: string;
  trialApiKey: string;
  catbotFcUrl: string;
  dashscopeApiKey?: string;
}

export function parseServerConfig(
  source: NodeJS.ProcessEnv | Record<string, unknown>,
): ServerConfig {
  const parsed = serverEnvironmentSchema.parse(source);
  const isProduction = parsed.NODE_ENV === "production";
  const hmacSignKey = parsed.HMAC_SIGN_KEY || DEVELOPMENT_HMAC_SIGN_KEY;
  const aesEncryptKey = parsed.AES_ENCRYPT_KEY || DEVELOPMENT_AES_ENCRYPT_KEY;
  const trialApiKey = parsed.REAL_API_KEY
    || parsed.TRIAL_OPENROUTER_KEY
    || DEVELOPMENT_TRIAL_API_KEY;

  if (!/^[0-9a-fA-F]{64}$/.test(aesEncryptKey)) {
    throw new Error("AES_ENCRYPT_KEY 必须是 64 位十六进制字符串");
  }
  if (isProduction) {
    if (!parsed.HMAC_SIGN_KEY || parsed.HMAC_SIGN_KEY.length < 32) {
      throw new Error("生产环境必须提供至少 32 个字符的 HMAC_SIGN_KEY");
    }
    if (!parsed.AES_ENCRYPT_KEY || aesEncryptKey === DEVELOPMENT_AES_ENCRYPT_KEY) {
      throw new Error("生产环境必须提供非默认的 AES_ENCRYPT_KEY");
    }
    if (!parsed.REAL_API_KEY && !parsed.TRIAL_OPENROUTER_KEY) {
      throw new Error("生产环境必须提供 REAL_API_KEY 或 TRIAL_OPENROUTER_KEY");
    }
  }

  return Object.freeze({
    nodeEnvironment: parsed.NODE_ENV,
    isProduction,
    port: parsed.PORT,
    host: parsed.TAURI_DEV_HOST,
    hmacSignKey,
    aesEncryptKey,
    trialApiKey,
    catbotFcUrl: parsed.CATBOT_FC_URL,
    dashscopeApiKey: parsed.DASHSCOPE_API_KEY,
  });
}

export function loadServerConfig(): ServerConfig {
  return parseServerConfig(process.env);
}
