/**
 * 轻量结构化日志器：级别管理 + 模块标签 + traceId 注入。
 *
 * 设计目标：
 *   - 替换关键模块的裸 console.* 调用，提供级别枚举与模块标签
 *   - traceId 注入：通过 withTrace() 创建子 logger，关联一次用户操作的跨节点日志
 *   - 生产环境：debug/info 由 import.meta.env.DEV 守卫移除；warn/error 保留
 *
 * 职责边界：
 *   - 本模块只负责日志输出，不内置遥测上报（遥测由调用方在 catch 块显式调用）
 *   - 不做日志持久化/远程收集（那是遥测系统的职责）
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

export class Logger {
  private readonly context: LogContext;

  private constructor(context: LogContext) {
    this.context = context;
  }

  static create(module: string): Logger {
    return new Logger({ module });
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
    if (import.meta.env?.DEV) {
      this.emit("debug", message, fields);
    }
  }

  /** INFO 级别：仅开发环境输出 */
  info(message: string, fields?: Record<string, unknown>): void {
    if (import.meta.env?.DEV) {
      this.emit("info", message, fields);
    }
  }

  /** WARN 级别：生产环境保留，用于记录可恢复的异常情况 */
  warn(message: string, fields?: Record<string, unknown>): void {
    this.emit("warn", message, fields);
  }

  /** ERROR 级别：生产环境保留，自动序列化 Error 对象 */
  error(message: string, error?: unknown, fields?: Record<string, unknown>): void {
    const errorFields: Record<string, unknown> = {};
    if (error instanceof Error) {
      errorFields.errorName = error.name;
      errorFields.errorMessage = error.message;
    } else if (error != null) {
      errorFields.error = String(error);
    }
    this.emit("error", message, { ...errorFields, ...fields });
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
