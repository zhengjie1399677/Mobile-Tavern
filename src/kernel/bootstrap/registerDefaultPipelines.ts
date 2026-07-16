import type { IKernel } from "../types";
import {
  tableMemoryMiddleware,
  mvuScriptMiddleware,
  bisonModeMiddleware,
  autoSummaryMiddleware,
} from "../middlewares/outputMiddlewares";

/** 装配内置管线中间件；不承担服务启动或 UI 注册。 */
export function registerDefaultPipelines(kernel: IKernel): void {
  // Kernel.destroy() 会释放所有管线；重启时恢复三个内置扩展点。
  kernel.getPipeline("input");
  kernel.getPipeline("settings");
  const outputPipeline = kernel.getPipeline("output");
  outputPipeline.use(tableMemoryMiddleware, 100);
  outputPipeline.use(mvuScriptMiddleware, 90);
  outputPipeline.use(bisonModeMiddleware, 80);
  outputPipeline.use(autoSummaryMiddleware, 70);
}
