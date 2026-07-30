export interface RuntimeEnvironment {
  mode: string;
  isDevelopment: boolean;
  isProduction: boolean;
  isTest: boolean;
}

export function detectRuntimeEnvironment(
  source: {
    mode?: string;
    dev?: boolean;
    prod?: boolean;
    nodeEnvironment?: string;
  },
): RuntimeEnvironment {
  const mode = source.mode || source.nodeEnvironment || "development";
  const isTest = mode === "test" || source.nodeEnvironment === "test";
  const isProduction = source.prod === true
    || mode === "production"
    || source.nodeEnvironment === "production";
  return Object.freeze({
    mode,
    isDevelopment: !isTest && !isProduction && source.dev !== false,
    isProduction,
    isTest,
  });
}

const viteEnvironment = import.meta.env ?? {};
const nodeEnvironment = typeof process !== "undefined"
  ? process.env?.NODE_ENV
  : undefined;

export const runtimeEnvironment = detectRuntimeEnvironment({
  mode: viteEnvironment.MODE,
  dev: viteEnvironment.DEV,
  prod: viteEnvironment.PROD,
  nodeEnvironment,
});
