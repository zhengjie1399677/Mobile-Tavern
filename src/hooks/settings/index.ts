// useSettings 模块聚合 barrel。
// 外部消费者仍可通过 `import { useSettings, DEFAULT_SETTINGS } from "../hooks/useSettings"`
// 零变更访问，原 useSettings.ts 已改造为对本 barrel 的单行 re-export。
export { useSettings } from "./useSettings";
export * from "./defaults";
export * from "./mergeUtils";
