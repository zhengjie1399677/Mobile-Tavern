import { z } from "zod";
import path from "node:path";

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional(),
);

const headlessEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HEADLESS_PORT: z.coerce.number().int().min(1).max(65_535).default(18080),
  HEADLESS_HOST: z.string().min(1).default("0.0.0.0"),
  HEADLESS_API_KEY: optionalString,
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
  readonly dataDir: string;
  readonly absoluteDataDir: string;
  readonly defaultProfileId: string;
  readonly llmBaseUrl?: string;
  readonly llmApiKey?: string;
  readonly llmModel?: string;
}

export function parseHeadlessConfig(
  source: NodeJS.ProcessEnv | Record<string, unknown>,
): HeadlessConfig {
  const parsed = headlessEnvironmentSchema.parse(source);
  const isProduction = parsed.NODE_ENV === "production";
  const absoluteDataDir = path.isAbsolute(parsed.HEADLESS_DATA_DIR)
    ? parsed.HEADLESS_DATA_DIR
    : path.resolve(process.cwd(), parsed.HEADLESS_DATA_DIR);

  return Object.freeze({
    nodeEnvironment: parsed.NODE_ENV,
    isProduction,
    port: parsed.HEADLESS_PORT,
    host: parsed.HEADLESS_HOST,
    apiKey: parsed.HEADLESS_API_KEY,
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
