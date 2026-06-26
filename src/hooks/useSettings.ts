// 本文件已拆分为 src/hooks/settings/ 目录下的多个职责子模块。
// 此处仅作为聚合 barrel 的 re-export 入口，保持外部消费者
// `import { useSettings, DEFAULT_SETTINGS, ... } from "../hooks/useSettings"`
// 路径零变更（详见 src/hooks/settings/index.ts）。
export * from "./settings/index";
