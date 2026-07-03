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

export interface SSEChunkCallbacks {
  /** 每次解析出有效 JSON 数据串时的回调（[DONE] 之前） */
  onData: (jsonStr: string) => void;
  /** 接收到 [DONE] 标记或流正常结束时的单次回调 */
  onDone?: () => void;
}

export interface SSEStreamOptions {
  /**
   * 空闲超时时间（毫秒）。无数据时取消 reader 释放资源。
   * 设置为 0 或 Infinity 禁用。默认: 60000 (60s)。
   */
  idleTimeoutMs?: number;
  /**
   * 可选 AbortSignal，用于在消费方提前退出时立即取消底层 reader。
   */
  signal?: AbortSignal;
}

/**
 * 读取 SSE 响应体，并在每个数据块到达时调用 `callbacks.onData`。
 * 当流完全消费完毕时 resolve。
 *
 * @param response  - 包含响应体的 fetch Response 对象
 * @param callbacks - SSE 数据处理回调集合
 * @param options   - 可选的流控制选项（空闲超时、取消信号等）
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

  // 空闲超时防护 - 若长时间未收到新数据则主动取消 reader，防止挂起。
  const idleTimeoutMs = options?.idleTimeoutMs ?? 60_000;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimedOut = false;

  const clearIdleTimer = () => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const resetIdleTimer = () => {
    if (idleTimeoutMs <= 0 || !Number.isFinite(idleTimeoutMs)) return;
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      console.warn(`[streamReader] 超过空闲超时限制 (${idleTimeoutMs}ms)，终止流`);
      idleTimedOut = true;
      reader.cancel().catch((err) => {
        console.warn("[streamReader] 空闲超时取消流时异常:", err);
      });
    }, idleTimeoutMs);
  };

  // 注册 AbortSignal 监听器，消费方提前退出时立即取消 reader
  const signal = options?.signal;
  const onSignalAbort = () => {
    clearIdleTimer();
    reader.cancel().catch((err) => {
      console.warn("[streamReader] 接收到取消信号时取消流异常:", err);
    });
  };
  if (signal) {
    if (signal.aborted) {
      onSignalAbort();
    } else {
      signal.addEventListener("abort", onSignalAbort);
    }
  }

  resetIdleTimer();

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
        // 收到任意数据即重置空闲定时器（包含 SSE 心跳注释）
        resetIdleTimer();
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
        }
        break;
      }
    }
  } finally {
    clearIdleTimer();
    // 移除 signal 监听器，避免内存泄漏
    if (signal) {
      signal.removeEventListener("abort", onSignalAbort);
    }
    try {
      reader.cancel().catch((err) => {
        console.warn("[streamReader] 取消流操作（连接中止时可安全忽略）:", err);
      });
      reader.releaseLock();
    } catch {
      // 忽略释放锁失败异常
    }
  }

  // 若因空闲超时主动取消了流，向上层抛出明确错误以便处理
  if (idleTimedOut) {
    throw new Error(`SSE 流超过 ${idleTimeoutMs}ms 无新数据传输`);
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
