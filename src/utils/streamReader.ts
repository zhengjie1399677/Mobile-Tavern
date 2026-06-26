/**
 * SSE Stream Reader Utility
 *
 * Parses a streaming Server-Sent Events (SSE) response body and emits
 * each data payload to the provided callbacks. Handles:
 *  - Correct double-newline (\n\n) event block boundaries
 *  - Multi-line data: fields within a single event block
 *  - Single-newline (\n) fallback for non-standard SSE servers (Ollama, LM Studio, etc.)
 *  - [DONE] termination sentinel
 *  - Trailing buffer flush on stream end
 */

export interface SSEChunkCallbacks {
  /** Called for every parsed JSON data string (before [DONE]) */
  onData: (jsonStr: string) => void;
  /** Called once when [DONE] is received or the stream ends */
  onDone?: () => void;
}

export interface SSEStreamOptions {
  /**
   * PERF-07: Idle timeout in milliseconds.
   * If no data is received within this period, the stream reader is cancelled
   * and `readSSEStream` rejects with an idle-timeout error to release resources.
   * Set to 0 or Infinity to disable. Default: 60000 (60s).
   */
  idleTimeoutMs?: number;
  /**
   * P1-7: 可选 AbortSignal，用于在消费方提前退出时立即取消底层 reader。
   * 当 signal.aborted 时，readSSEStream 会立即 reader.cancel() + clearIdleTimer()，
   * 无需等待下一次 reader.read() 抛错。
   */
  signal?: AbortSignal;
}

/**
 * Reads an SSE response body and calls `callbacks.onData` for each
 * data payload string. Resolves when the stream is fully consumed.
 *
 * @param response  - The fetch Response whose body will be streamed
 * @param callbacks - Handlers for each SSE data payload
 * @param options   - Optional streaming controls (e.g. idle timeout, abort signal)
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

  // PERF-07: Idle timeout - 若长时间未收到新数据则主动取消 reader，
  // 防止 LLM 中转代理在 fetch 200 OK 后挂起导致连接永久占用。
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
      console.warn(`[streamReader] Idle timeout (${idleTimeoutMs}ms) exceeded, aborting stream`);
      idleTimedOut = true;
      reader.cancel().catch((err) => {
        console.warn("[streamReader] Stream cancel rejected during idle timeout:", err);
      });
    }, idleTimeoutMs);
  };

  // P1-7: 注册 AbortSignal 监听器，消费方提前退出时立即取消 reader
  const signal = options?.signal;
  const onSignalAbort = () => {
    clearIdleTimer();
    reader.cancel().catch((err) => {
      console.warn("[streamReader] Stream cancel rejected during signal abort:", err);
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
   * Process all complete SSE event blocks currently in `pbuf`.
   * Each block is separated by \n\n. Within a block, lines starting
   * with "data: " are extracted and joined (handles multi-line data).
   */
  const flushBuffer = (forceAll: boolean = false) => {
    // 1. Try splitting on double-newline (standard SSE block boundary)
    let boundary = pbuf.indexOf("\n\n");

    if (forceAll && boundary === -1 && pbuf.trim().length > 0) {
      boundary = pbuf.length;
    }

    while (boundary >= 0) {
      const block = pbuf.slice(0, boundary);
      pbuf = pbuf.slice(boundary === pbuf.length ? boundary : boundary + 2);

      // Collect all "data: " lines in this block (handles multi-line events)
      const dataLines = block
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6));

      if (dataLines.length > 0) {
        // Standard SSE specification: join multi-line data payloads with a newline character
        const mergedData = dataLines.join("\n").trim();
        if (mergedData === "[DONE]") {
          streamDone = true;
          callbacks.onDone?.();
          return; // Stop processing after [DONE]
        }
        if (mergedData) {
          callbacks.onData(mergedData);
        }
      }

      // Continue looking for more complete blocks
      boundary = pbuf.indexOf("\n\n");
      if (forceAll && boundary === -1 && pbuf.trim().length > 0) {
        boundary = pbuf.length;
      }
    }

    // 2. If no double-newline was found and stream is not done, fall back to single-newline parsing
    if (!streamDone) {
      let singleIdx = pbuf.indexOf("\n");
      while (singleIdx >= 0) {
        const line = pbuf.slice(0, singleIdx).trim();

        // Consume only valid data lines, [DONE] markers, comments or empty padding lines
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
          // A line that does not start with data: and is not empty/comment might be incomplete JSON,
          // wait for more stream data to arrive
          break;
        }
      }
    }
  };

  try {
    while (true) {
      const { value, done: readerDone } = await reader.read();

      if (value) {
        // PERF-07: 收到任意数据即重置 idle timer（包含 SSE 心跳注释）
        resetIdleTimer();
        pbuf += decoder.decode(value, { stream: true });
      }

      flushBuffer();

      if (readerDone || streamDone) {
        // Flush any trailing content that didn't end with \n\n
        if (!streamDone) {
          // Final decode call with stream: false option to flush out any pending multi-byte UTF-8 bytes
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
    // P1-7: 移除 signal 监听器，避免内存泄漏
    if (signal) {
      signal.removeEventListener("abort", onSignalAbort);
    }
    try {
      // Catch any rejected promises from cancel to avoid Unhandled Promise Rejections
      reader.cancel().catch((err) => {
        console.warn("[streamReader] Stream cancel rejected (safe to ignore if connection aborted):", err);
      });
      reader.releaseLock();
    } catch {
      // Ignore release lock errors
    }
  }

  // PERF-07: 若因 idle timeout 主动取消了流，向上层抛出明确错误以便处理
  if (idleTimedOut) {
    throw new Error(`SSE stream idle timeout after ${idleTimeoutMs}ms without data`);
  }
}

/**
 * Safely parse a JSON string from an SSE data payload.
 * Falls back to regex-based content extraction if JSON.parse fails
 * (handles malformed or chunked JSON from non-standard servers).
 *
 * @returns Parsed object, or null if parsing fails entirely.
 */
export function safeParseSSEData(dataStr: string): Record<string, unknown> | null {
  try {
    return JSON.parse(dataStr) as Record<string, unknown>;
  } catch {
    // Fallback: extract the "content" field via regex for partial/malformed JSON
    const contentReg = /"content"\s*:\s*"((?:[^"\\]|\\.)*)"/;
    const match = dataStr.match(contentReg);
    if (match && match[1]) {
      let rescued = match[1];
      try {
        // Unescape standard JSON string escapes (\n, \", etc.)
        rescued = JSON.parse(`"${rescued}"`);
      } catch {
        // Leave as-is if unescape also fails
      }
      return { __rescuedContent: rescued };
    }
    return null;
  }
}
