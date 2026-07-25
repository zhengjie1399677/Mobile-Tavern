import type { ChatSession, UserSettings } from "../../types";
import type { IKernel } from "../../kernel/types";

/**
 * 业务输出管道上下文。
 *
 * 设计说明：此类型本质属于业务管道层（消费方为 outputMiddlewares、
 * streamHelpers、pipelineHelpers），不应下沉到 kernel/types.ts。
 * 上移到 src/services/pipeline/types.ts 后，kernel 仅保留
 * IPipeline<T> 泛型契约，不再反向依赖上层业务实体类型。
 *
 * 详见 AGENTS.md 准则一「主内核架构不含业务代码」与解耦策略文档。
 */
export interface OutputPipelineContext {
  kernel?: IKernel;
  session: ChatSession;
  responseText: string;
  reasoningText: string;
  settings: UserSettings;
  activeCharacter: any;
  controller: AbortController;
  isStillActive: boolean;
  isBisonConsecutive: boolean;
  bisonRemainingCount: number;
  /**
   * traceId：一次用户操作的调用链路标识。
   * 由调用方（useSendMessage/useRerollMessage）生成并注入，
   * 中间件可通过此字段关联同一调用链路上的日志与遥测事件。
   */
  traceId?: string;

  // Outputs from middlewares
  resultSession?: ChatSession;
  shouldTriggerBison?: boolean;
  nextBisonRemainingCount?: number;
}
