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

/**
 * Reads an SSE response body and calls `callbacks.onData` for each
 * data payload string. Resolves when the stream is fully consumed.
 *
 * @param response  - The fetch Response whose body will be streamed
 * @param callbacks - Handlers for each SSE data payload
 */
export async function readSSEStream(
  response: Response,
  callbacks: SSEChunkCallbacks
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder("utf-8");
  let pbuf = "";
  let streamDone = false;

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
