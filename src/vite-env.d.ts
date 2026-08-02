/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const IS_MOBILE_NATIVE: boolean;
declare const __AES_FALLBACK_KEY__: string | undefined;

interface ImportMetaEnv {
  readonly VITE_COMMUNITY_ORIGIN?: string;
  readonly VITE_COMMUNITY_ENABLED?: "true" | "false";
  readonly VITE_COMMUNITY_MIN_FIRST_USE_AGE_DAYS?: string;
  readonly VITE_COMMUNITY_MIN_CUMULATIVE_USAGE_HOURS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// 显式声明 ?raw 模块，作为 vite/client 解析失败时的兜底。
// 部分 IDE 的 TS 服务器可能无法通过 exports.types 条件解析 vite/client，
// 导致 scriptPreprocessor.ts 中的 ?raw 导入报错并级联到 scriptIframe.ts。
declare module "*?raw" {
  const content: string;
  export default content;
}
