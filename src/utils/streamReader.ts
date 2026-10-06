/**
 * SSE 流式读取工具函数
 *
 * 解析 Server-Sent Events (SSE) 响应体，并将提取到的数据通过回调函数分发。支持：
 *  - 标准双换行符 (\n\n) 事件块边界识别
 *  - 单个事件块内的多行数据组合
 *  - 针对非标 SSE 服务端（Ollama、LM Studio 等）单换行符 (\n) 回退机制
 *  - [DONE] 结束标记处理
 *  - 流终止时的尾部缓冲区刷新
 */

import { Logger } from "./logger";

const logger = Logger.create("streamReader");

/**
 * 首字（首包）等待超时（毫秒）。
 *
 * 2026-10-06 由 60s 放宽到 300s：大量第三方中转站在整段生成期间不发送任何字节
 * （忽略 `stream` 或整段缓冲后一次性下发），60s 会把长回复与思考模型直接掐掉，
 * 而按「消耗 token 的请求不自动重试」的既定策略不会重发，等于丢一次回复。
 * 300s 与 OpenAI / Anthropic SDK 的总超时（600s）同量级；真的挂死时用户可以
 * 立即用输入区的「停止生成」结束，不必依赖计时器兜底。
 * 数据块心跳（`DEFAULT_CHUNK_HEARTBEAT_TIMEOUT_MS`）保持 60s：那是"已经开始
 * 收到数据后断流"的信号，与等待首包不是同一类问题。
 */
export const DEFAULT_FIRST_CHUNK_TIMEOUT_MS = 300_000;
/**
 * 数据块活跃心跳超时（毫秒）。
 *
 * 主流实现对照（2026-10 核对）：SillyTavern 无流式超时；Open WebUI 的块间空闲超时
 * 默认关闭（`AIOHTTP_CLIENT_STREAM_IDLE_TIMEOUT` 缺省为 None）；NextChat 总超时 60s
 * （思考模型 ×5 = 300s）；OpenAI / Anthropic SDK 总超时 600s 且无块间空闲限制。
 * 本仓库改造前的空闲阈值同样是 60s，因此这里取 60s：与主流一致，也不会比旧行为更激进；
 * 长思考模型可由调用方按请求传入更大的 `chunkTimeoutMs`。
 */
export const DEFAULT_CHUNK_HEARTBEAT_TIMEOUT_MS = 60_000;

export type StreamTimeoutPhase = "first_chunk" | "chunk_inactivity";

export class StreamTimeoutError extends Error {
  readonly phase: StreamTimeoutPhase;
  readonly timeoutMs: number;

  constructor(phase: StreamTimeoutPhase, timeoutMs: number) {
    const sec = Math.round(timeoutMs / 1000);
    const message =
      phase === "first_chunk"
        ? `等待模型首字响应超时（${sec}秒）：服务商响应过慢或处于排队中，请稍后重试。`
        : `模型响应中断（超过 ${timeoutMs}ms 无新数据传输）：网络连接中断或服务商异常。`;
    super(message);
    this.name = "StreamTimeoutError";
    this.phase = phase;
    this.timeoutMs = timeoutMs;
  }
}

export interface SSEChunkCallbacks {
  /** 每次解析出有效 JSON 数据串时的回调（[DONE] 之前） */
  onData: (jsonStr: string) => void;
  /** 接收到 [DONE] 标记或流正常结束时的单次回调 */
  onDone?: () => void;
}

export interface SSEStreamOptions {
  /**
   * 首字/首数据块等待超时时间（毫秒）。
   * 在收到首个数据块前生效（大上下文预填充/排队）。
   * 默认: 60000 (60s)。设置为 0 或 Infinity 禁用。
   */
  firstChunkTimeoutMs?: number;
  /**
   * 数据块活跃心跳超时时间（毫秒）。
   * 收到首个数据块后激活。每次收到新数据即重置此定时器。
   * 默认: 60000 (60s，与主流客户端一致)。设置为 0 或 Infinity 禁用。
   */
  chunkTimeoutMs?: number;
  /**
   * @deprecated 兼容旧配置。若未分别设置 firstChunkTimeoutMs/chunkTimeoutMs，以此为回退。
   * 设置为 0 或 Infinity 禁用。默认: 60000 (60s)。
   */
  idleTimeoutMs?: number;
  /**
   * 可选 AbortSignal，用于在消费方提前退出时立即取消底层 reader。
   */
  signal?: AbortSignal;
  /**
   * 可选：每收到一块原始字节时回调（字节数）。用于上层统计已接收流量，
   * 在流中断时提供"已接收多少字节"的诊断信息。
   */
  onBytesReceived?: (bytes: number) => void;
}

/**
 * 读取 SSE 响应体，并在每个数据块到达时调用 `callbacks.onData`。
 * 当流完全消费完毕时 resolve。
 *
 * @param response  - 包含响应体的 fetch Response 对象
 * @param callbacks - SSE 数据处理回调集合
 * @param options   - 可选的流控制选项（首字超时、心跳超时、取消信号等）
 */
export async function readSSEStream(
  response: Response,
  callbacks: SSEChunkCallbacks,
  options?: SSEStreamOptions
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder("utf-8");
  let pbuf = "";
  let streamDone = false;

  // 两阶段超时控制：阶段一（首字等待）与阶段二（吐字心跳）
  const firstChunkTimeoutMs =
    options?.firstChunkTimeoutMs ?? options?.idleTimeoutMs ?? DEFAULT_FIRST_CHUNK_TIMEOUT_MS;
  const chunkTimeoutMs =
    options?.chunkTimeoutMs ?? options?.idleTimeoutMs ?? DEFAULT_CHUNK_HEARTBEAT_TIMEOUT_MS;

  let hasReceivedFirstChunk = false;
  let activeTimer: ReturnType<typeof setTimeout> | null = null;
  let timedOutPhase: StreamTimeoutPhase | null = null;

  const clearTimer = () => {
    if (activeTimer !== null) {
      clearTimeout(activeTimer);
      activeTimer = null;
    }
  };

  const armTimer = (phase: StreamTimeoutPhase, ms: number) => {
    if (ms <= 0 || !Number.isFinite(ms)) return;
    clearTimer();
    activeTimer = setTimeout(() => {
      logger.warn(`流式读取超时 [${phase}]，主动终止流`, { phase, timeoutMs: ms });
      timedOutPhase = phase;
      reader.cancel().catch((err) => {
        logger.warn("超时取消流时异常", { error: err });
      });
    }, ms);
  };

  // 注册 AbortSignal 监听器，消费方提前退出时立即取消 reader
  const signal = options?.signal;
  const onSignalAbort = () => {
    clearTimer();
    reader.cancel().catch((err) => {
      logger.warn("接收到取消信号时取消流异常", { error: err });
    });
  };
  if (signal) {
    if (signal.aborted) {
      onSignalAbort();
    } else {
      signal.addEventListener("abort", onSignalAbort);
    }
  }

  // 阶段一启动：等待首个数据块到达
  armTimer("first_chunk", firstChunkTimeoutMs);

  /**
   * 处理当前 `pbuf` 中的所有完整 SSE 事件块。
   * 每个块以 \n\n 分隔。在单块内部，提取以 "data: " 开头的行并合并（处理多行数据）。
   */
  const flushBuffer = (forceAll: boolean = false) => {
    // 1. 尝试按双换行符切割（标准 SSE 事件块边界）
    let boundary = pbuf.indexOf("\n\n");

    if (forceAll && boundary === -1 && pbuf.trim().length > 0) {
      boundary = pbuf.length;
    }

    while (boundary >= 0) {
      const block = pbuf.slice(0, boundary);
      pbuf = pbuf.slice(boundary === pbuf.length ? boundary : boundary + 2);

      // 收集当前块中所有以 "data: " 开头的行（支持多行事件）
      const dataLines = block
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6));

      if (dataLines.length > 0) {
        // 标准 SSE 规范：使用换行符连接多行数据
        const mergedData = dataLines.join("\n").trim();
        if (mergedData === "[DONE]") {
          streamDone = true;
          callbacks.onDone?.();
          return; // 遇到 [DONE] 后停止处理
        }
        if (mergedData) {
          callbacks.onData(mergedData);
        }
      }

      // 继续查找下一个完整事件块
      boundary = pbuf.indexOf("\n\n");
      if (forceAll && boundary === -1 && pbuf.trim().length > 0) {
        boundary = pbuf.length;
      }
    }

    // 2. 若未检测到双换行符且流未结束，回退到单换行符解析模式
    if (!streamDone) {
      let singleIdx = pbuf.indexOf("\n");
      while (singleIdx >= 0) {
        const line = pbuf.slice(0, singleIdx).trim();

        // 仅消费有效的 data 行、[DONE] 标记、注释行或空行
        if (line.startsWith("data:") || line === "[DONE]" || line === "" || line.startsWith(":")) {
          pbuf = pbuf.slice(singleIdx + 1);

          if (line.startsWith("data:") || line === "[DONE]") {
            const content = line.startsWith("data:") ? line.slice(5).trim() : line;
            if (content === "[DONE]") {
              streamDone = true;
              callbacks.onDone?.();
              return;
            }
            if (content) {
              callbacks.onData(content);
            }
          }
          singleIdx = pbuf.indexOf("\n");
        } else {
          // 非 data 开头且非空行/注释行可能为未接收完整的 JSON 串，等待后续数据到达
          break;
        }
      }
    }
  };

  try {
    while (true) {
      const { value, done: readerDone } = await reader.read();

      if (value) {
        if (!hasReceivedFirstChunk && value.byteLength > 0) {
          hasReceivedFirstChunk = true;
        }
        // 收到任意数据即重置心跳定时器为阶段二心跳（包含 SSE 注释心跳）
        armTimer("chunk_inactivity", chunkTimeoutMs);
        options?.onBytesReceived?.(value.byteLength);
        pbuf += decoder.decode(value, { stream: true });
      }

      flushBuffer();

      if (readerDone || streamDone) {
        // 刷新末尾未以 \n\n 结尾的遗留数据
        if (!streamDone) {
          // 调用 stream: false 强制刷新多字节 UTF-8 剩余字节
          const finalChunk = decoder.decode();
          if (finalChunk) {
            pbuf += finalChunk;
          }
          flushBuffer(true);
          // 服务端可能不发 [DONE] 就直接关闭连接（部分中转站 / 本地推理服务 / 被截断的响应）。
          // 此时必须补发一次完成通知，否则消费方永远等不到 onDone：readSSEStream 是 resolve 而非
          // reject，消费方的 isFinished 会一直为 false，卡在等队列的 await 上永久挂起。
          // 超时与主动取消两种情况不补发——它们各自有独立的错误/中止通路，
          // 补发会先把消费方唤醒成"正常结束"，把真正的错误吞掉。
          if (!timedOutPhase && !signal?.aborted) {
            streamDone = true;
            callbacks.onDone?.();
          }
        }
        break;
      }
    }
  } finally {
    clearTimer();
    // 移除 signal 监听器，避免内存泄漏
    if (signal) {
      signal.removeEventListener("abort", onSignalAbort);
    }
    try {
      reader.cancel().catch((err) => {
        logger.warn("取消流操作（连接中止时可安全忽略）", { error: err });
      });
      reader.releaseLock();
    } catch {
      // 忽略释放锁失败异常
    }
  }

  // 若因阶段一或阶段二超时主动取消了流，向上层抛出明确错误以便处理
  if (timedOutPhase !== null) {
    const duration = timedOutPhase === "first_chunk" ? firstChunkTimeoutMs : chunkTimeoutMs;
    throw new StreamTimeoutError(timedOutPhase, duration);
  }
}

/**
 * 从 SSE 数据串中安全解析 JSON 对象。
 * 若 JSON.parse 解析失败，使用正则表达式兜底抽取 content 字段
 * （应对非标服务端的畸形或截断 JSON）。
 *
 * @returns 解析后的对象；解析彻底失败时返回 null。
 */
export function safeParseSSEData(dataStr: string): Record<string, unknown> | null {
  try {
    return JSON.parse(dataStr) as Record<string, unknown>;
  } catch {
    // 兜底方案：通过正则表达式从畸形 JSON 中提取 content 字段
    const contentReg = /"content"\s*:\s*"((?:[^"\\]|\\.)*)"/;
    const match = dataStr.match(contentReg);
    if (match && match[1]) {
      let rescued = match[1];
      try {
        // 还原标准 JSON 转义字符（如 \n、\" 等）
        rescued = JSON.parse(`"${rescued}"`);
      } catch {
        // 若反转义也失败，则保留原始抽取值
      }
      return { __rescuedContent: rescued };
    }
    return null;
  }
}
