/**
 * 业务输出管道层 barrel 文件
 *
 * 集中导出 OutputPipelineContext 类型与默认装配的 4 个内置中间件
 * （tableMemory / mvuScript / bisonMode / autoSummary），供
 * bootstrap 装配、hooks/useChat 消费方统一从此处导入。
 */

export type { OutputPipelineContext } from "./types";
export {
  tableMemoryMiddleware,
  mvuScriptMiddleware,
  bisonModeMiddleware,
  autoSummaryMiddleware,
} from "./outputMiddlewares";
