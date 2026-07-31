import { z } from "zod";

/**
 * Vite 构建环境的类型化配置入口。
 *
 * 职责：仅解析构建工具与平台判断相关的开关（Tauri 目标平台、HMR 开关），
 * 不承载业务功能策略或运行时秘密。业务功能策略由 `src/config/featurePolicies.ts`
 * 统一管理，运行时秘密分别由 `server/config.ts` 与云端容器配置管理。
 *
 * 依赖方向：`process.env` → `viteEnvironment` → `vite.config.ts`
 */
const MOBILE_NATIVE_PLATFORMS = new Set(["android", "ios"]);

const viteEnvironmentSchema = z.object({
  TAURI_ENV_PLATFORM: z.string().optional(),
  DISABLE_HMR: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.enum(["true", "false"]).optional(),
  ),
});

export interface ViteEnvironment {
  isMobileNative: boolean;
  disableHmr: boolean;
}

export function parseViteEnvironment(
  source: Record<string, unknown>,
): ViteEnvironment {
  const parsed = viteEnvironmentSchema.parse(source);
  return Object.freeze({
    isMobileNative: parsed.TAURI_ENV_PLATFORM !== undefined
      && MOBILE_NATIVE_PLATFORMS.has(parsed.TAURI_ENV_PLATFORM),
    disableHmr: parsed.DISABLE_HMR === "true",
  });
}

export const viteEnvironment = parseViteEnvironment(
  typeof process !== "undefined" && process.env
    ? process.env as Record<string, unknown>
    : {},
);
