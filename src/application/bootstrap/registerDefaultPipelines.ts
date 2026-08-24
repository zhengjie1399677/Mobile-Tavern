import type { EffectDisposer, IKernel } from "../serviceContracts";
import {
  tableMemoryMiddleware,
  mvuScriptMiddleware,
  bisonModeMiddleware,
  type OutputPipelineContext,
} from "../../application/pipeline";

/** 装配内置管线中间件；不承担服务启动或 UI 注册。 */
export function registerDefaultPipelines(kernel: IKernel): EffectDisposer {
  const ensurePipeline = <T>(name: string) => {
    try {
      return kernel.getPipeline<T>(name);
    } catch {
      return kernel.registerPipeline<T>(name);
    }
  };
  // Kernel.destroy() 会释放所有管线；重启时恢复三个内置扩展点。
  ensurePipeline("input");
  ensurePipeline("settings");
  const outputPipeline = ensurePipeline<OutputPipelineContext>("output");
  const disposers = [
    outputPipeline.use(tableMemoryMiddleware, 100),
    outputPipeline.use(mvuScriptMiddleware, 90),
    outputPipeline.use(bisonModeMiddleware, 80),
  ];
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    for (let index = disposers.length - 1; index >= 0; index--) {
      disposers[index]();
    }
  };
}
