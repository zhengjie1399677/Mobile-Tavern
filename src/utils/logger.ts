import { runtimeEnvironment } from "../kernel/runtimeEnvironment";

/**
 * 轻量结构化日志器：级别管理 + 模块标签 + traceId 注入。
 *
 * 设计目标：
 *   - 替换关键模块的裸 console.* 调用，提供级别枚举与模块标签
 *   - traceId 注入：通过 withTrace() 创建子 logger，关联一次用户操作的跨节点日志
 *   - 生产环境：debug/info 由 publicEnvironment 守卫移除；warn/error 保留
 *
 * 职责边界：
 *   - 本模块只负责日志输出，不内置遥测上报（遥测由调用方在 catch 块显式调用）
 *   - 不做日志持久化/远程收集（那是遥测系统的职责）
 *   - 例外：error 级别日志可通过 setErrorHandler 注入回调自动触发遥测，
 *     避免在每个 catch 块重复手动调用 reportImmediate
 *
 * 使用示例：
 *   const logger = Logger.create("useSendMessage");
 *   const traceLogger = logger.withTrace(generateTraceId(), sessionId);
 *   traceLogger.info("开始发送消息", { messageCount: 3 });
 *   traceLogger.error("LLM 调用失败", err, { modelName });
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  readonly module: string;
  readonly traceId?: string;
  readonly sessionId?: string;
}

/**
 * Error 级别日志的遥测回调类型。
 * 由应用入口（main.tsx）通过 Logger.setErrorHandler 注入，
 * 实现 logger.error 自动触发 reportImmediate，避免循环依赖（utils → kernel）。
 */
export type ErrorHandler = (params: {
  module: string;
  traceId?: string;
  sessionId?: string;
  message: string;
  errorName?: string;
  errorMessage?: string;
  error?: string;
  fields?: Record<string, unknown>;
}) => void;

let injectedErrorHandler: ErrorHandler | null = null;
/** 防递归标志：errorHandler 内部若再次触发 logger.error，则跳过二次上报 */
let isHandlingError = false;

export class Logger {
  private readonly context: LogContext;

  private constructor(context: LogContext) {
    this.context = context;
  }

  static create(module: string): Logger {
    return new Logger({ module });
  }

  /**
   * 注入 error 级别日志的遥测回调。
   * 由应用入口在初始化阶段调用一次，注入后所有 logger.error 会自动触发遥测上报。
   * 回调内部异常不得抛出（由 Logger 内部 try/catch 兜底，避免污染主流程）。
   */
  static setErrorHandler(handler: ErrorHandler | null): void {
    injectedErrorHandler = handler;
  }

  /**
   * 创建带 traceId 的子 logger，用于关联一次用户操作的跨节点日志。
   * traceId 只取后 8 位显示，保持日志简洁。
   */
  withTrace(traceId: string, sessionId?: string): Logger {
    return new Logger({
      module: this.context.module,
      traceId,
      sessionId: sessionId ?? this.context.sessionId,
    });
  }

  /** DEBUG 级别：仅开发环境输出，生产构建由 DEV 守卫移除 */
  debug(message: string, fields?: Record<string, unknown>): void {
    if (runtimeEnvironment.isDevelopment) {
      this.emit("debug", message, fields);
    }
  }

  /** INFO 级别：仅开发环境输出 */
  info(message: string, fields?: Record<string, unknown>): void {
    if (runtimeEnvironment.isDevelopment) {
      this.emit("info", message, fields);
    }
  }

  /** WARN 级别：生产环境保留，用于记录可恢复的异常情况 */
  warn(message: string, fields?: Record<string, unknown>): void {
    this.emit("warn", message, fields);
  }

  /** ERROR 级别：生产环境保留，自动序列化 Error 对象并触发遥测回调 */
  error(message: string, error?: unknown, fields?: Record<string, unknown>): void {
    const errorFields: Record<string, unknown> = {};
    if (error instanceof Error) {
      errorFields.errorName = error.name;
      errorFields.errorMessage = error.message;
    } else if (error != null) {
      errorFields.error = String(error);
    }
    const mergedFields = { ...errorFields, ...fields };
    this.emit("error", message, mergedFields);
    this.triggerErrorHandler(message, mergedFields);
  }

  /**
   * 触发注入的 error handler（遥测回调）。
   * 防循环：handler 内部若再次调用 logger.error，isHandlingError 标志会跳过二次上报。
   * 防污染：handler 异常由 try/catch 兜底，不得影响主流程。
   */
  private triggerErrorHandler(message: string, fields: Record<string, unknown>): void {
    if (!injectedErrorHandler || isHandlingError || fields.skipTelemetry === true) return;
    isHandlingError = true;
    try {
      injectedErrorHandler({
        module: this.context.module,
        traceId: this.context.traceId,
        sessionId: this.context.sessionId,
        message,
        errorName: fields.errorName as string | undefined,
        errorMessage: fields.errorMessage as string | undefined,
        error: fields.error as string | undefined,
        fields,
      });
    } catch {
      // 静默：遥测回调异常不得污染主流程
    } finally {
      isHandlingError = false;
    }
  }

  private emit(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    const prefix = this.formatPrefix();
    const consoleFn =
      level === "warn" ? console.warn : level === "error" ? console.error : console.log;
    if (fields && Object.keys(fields).length > 0) {
      consoleFn(prefix, message, fields);
    } else {
      consoleFn(prefix, message);
    }
  }

  private formatPrefix(): string {
    const parts = [this.context.module];
    if (this.context.traceId) parts.push(this.context.traceId.slice(-8));
    return `[${parts.join("|")}]`;
  }
}

let traceCounter = 0;

/** 生成短小的 traceId，用于关联一次用户操作的日志 */
export function generateTraceId(): string {
  traceCounter = (traceCounter + 1) % 1000000;
  return `${Date.now().toString(36)}-${traceCounter.toString(36)}`;
}
