import { z } from "zod";
import { runtimeEnvironment } from "../kernel/runtimeEnvironment";

const DEFAULT_COMMUNITY_ORIGIN = "https://community.neural-node.xyz";

const optionalUrl = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().url().optional(),
);
const optionalNonnegativeNumber = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.coerce.number().finite().min(0).optional(),
);
const optionalBooleanString = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.enum(["true", "false"]).optional(),
);

const publicEnvironmentSchema = z.object({
  DEV: z.boolean().optional(),
  PROD: z.boolean().optional(),
  MODE: z.string().optional(),
  VITE_COMMUNITY_ORIGIN: optionalUrl,
  VITE_COMMUNITY_ENABLED: optionalBooleanString,
  VITE_COMMUNITY_MIN_FIRST_USE_AGE_DAYS: optionalNonnegativeNumber,
  VITE_COMMUNITY_MIN_CUMULATIVE_USAGE_HOURS: optionalNonnegativeNumber,
});

export interface PublicEnvironment {
  mode: string;
  isDevelopment: boolean;
  isProduction: boolean;
  isTest: boolean;
  communityOrigin: string;
  communityEnabled?: boolean;
  communityMinFirstUseAgeDays: number;
  communityMinCumulativeUsageHours: number;
}

export function parsePublicEnvironment(
  source: Record<string, unknown>,
): PublicEnvironment {
  const parsed = publicEnvironmentSchema.parse(source);
  const mode = parsed.MODE || "development";
  const isTest = mode === "test";
  const isProduction = parsed.PROD === true || mode === "production";
  return Object.freeze({
    mode,
    isDevelopment: parsed.DEV === true && !isTest,
    isProduction,
    isTest,
    communityOrigin: (
      parsed.VITE_COMMUNITY_ORIGIN || DEFAULT_COMMUNITY_ORIGIN
    ).replace(/\/+$/, ""),
    communityEnabled: parsed.VITE_COMMUNITY_ENABLED === undefined
      ? undefined
      : parsed.VITE_COMMUNITY_ENABLED === "true",
    communityMinFirstUseAgeDays:
      parsed.VITE_COMMUNITY_MIN_FIRST_USE_AGE_DAYS ?? 0,
    communityMinCumulativeUsageHours:
      parsed.VITE_COMMUNITY_MIN_CUMULATIVE_USAGE_HOURS ?? 0,
  });
}

const viteEnvironment = import.meta.env ?? {};

export const publicEnvironment = parsePublicEnvironment({
  ...viteEnvironment,
  DEV: runtimeEnvironment.isDevelopment,
  PROD: runtimeEnvironment.isProduction,
  MODE: runtimeEnvironment.mode,
});
