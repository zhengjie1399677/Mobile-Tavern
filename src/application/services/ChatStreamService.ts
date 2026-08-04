import { IChatStreamService, IKernel, StreamChunk, StreamParams } from "../serviceContracts";
import { readSSEStream, safeParseSSEData } from "../../utils/streamReader";
import { API_ENDPOINT } from "../../utils/apiClient";
import { Logger } from "../../utils/logger";
import { getErrorMessage, getErrorName } from "../../utils/errorUtils";

const logger = Logger.create("ChatStreamService");

/** 瞬态断流自动重试次数上限（仅在未向消费方输出任何内容时生效）。 */
const STREAM_INTERRUPT_RETRY_LIMIT = 1;

/** 单次流式请求的最终结果：ok=true 正常结束；ok=false 携带失败原因。 */
type AttemptOutcome = { ok: true } | { ok: false; error: unknown };

/**
 * 判断是否为可自动重试的瞬态断流。
 *
 * 真机上 LLM 请求经 tauri-plugin-http → Rust reqwest 发出；响应体读取中途的任何
 * 连接中断（连接重置 / 截断 / 超时）都会被 reqwest 统一归类为 Decode 错误，
 * 对外表现为 "error decoding response body"。此类错误与请求内容无关，重试一次安全。
 */
function isTransientStreamInterrupt(err: unknown): boolean {
  return /error decoding response body/i.test(getErrorMessage(err));
}

/** 提取 baseUrl 的主机名，解析失败时原样返回。 */
function extractHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export class ChatStreamService implements IChatStreamService {
  name = "chatStream";
  dependencies = ["llm"] as const;

  private kernel!: IKernel;
  // P1-1/P1-2: 服务级 AbortController
  private abortController: AbortController | null = null;
  // 7.3.2: 保存 init 时注册的外部 signal 监听器引用，destroy 时移除避免累积
  private initAbortListener: (() => void) | null = null;
  private initAbortSignal: AbortSignal | null = null;

  init(kernel: IKernel, signal?: AbortSignal): void {
    this.kernel = kernel;
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) {
        this.abortController.abort();
      } else {
        // 7.3.2: 保存监听器引用以便 destroy 时移除
        this.initAbortListener = () => this.abortController?.abort();
        this.initAbortSignal = signal;
        signal.addEventListener("abort", this.initAbortListener);
      }
    }
  }

  // P1-2: 销毁时中止挂起的流式响应
  destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
    // 7.3.2: 移除 init 时注册的外部 signal 监听器
    if (this.initAbortListener && this.initAbortSignal) {
      this.initAbortSignal.removeEventListener("abort", this.initAbortListener);
      this.initAbortListener = null;
      this.initAbortSignal = null;
    }
  }

  async *streamLlmResponse(params: StreamParams): AsyncGenerator<StreamChunk, void, unknown> {
    const log = params.traceId ? logger.withTrace(params.traceId) : logger;
    // 只有从未向消费方输出任何 chunk 时，瞬态断流才可安全重试；
    // 已输出部分内容后重试会造成重复文本，此时直接抛错交给上层保存"部分内容"。
    let yieldedAny = false;

    for (let attempt = 1; attempt <= STREAM_INTERRUPT_RETRY_LIMIT + 1; attempt++) {
      const attemptGen = this.attemptStream(params);
      let outcome: AttemptOutcome | null = null;
      try {
        while (true) {
          const next = await attemptGen.next();
          if (next.done) {
            outcome = next.value;
            break;
          }
          yieldedAny = true;
          yield next.value;
        }
      } catch (err) {
        outcome = { ok: false, error: err };
      } finally {
        // 消费方提前退出（break/return/throw）时关闭当前 attempt 的 generator，
        // 触发其 finally 清理后台 readSSEStream；返回值为空载体，无人消费。
        await attemptGen.return({ ok: true }).catch(() => {});
      }

      if (!outcome) {
        // 仅在消费方提前退出时可达；防御性兜底。
        return;
      }
      if (outcome.ok) return;

      const lastError = outcome.error;
      if (
        attempt <= STREAM_INTERRUPT_RETRY_LIMIT &&
        !yieldedAny &&
        isTransientStreamInterrupt(lastError)
      ) {
        log.warn("检测到流式响应体读取中断（error decoding response body），自动重试一次", {
          attempt,
          baseUrl: extractHost(params.baseUrl),
          error: getErrorMessage(lastError),
        });
        continue;
      }
      throw lastError;
    }
  }

  private async *attemptStream(params: StreamParams): AsyncGenerator<StreamChunk, AttemptOutcome, unknown> {
    const { baseUrl, apiKey, chatPath, bypassProxy, disableReasoning, forceBasicParams, reqBody, signal, traceId } = params;

    const llmService = this.kernel.getService<any>("llm");
    const response = await llmService.universalFetch(API_ENDPOINT.ProxyOpenAI, {
      baseUrl,
      apiKey,
      chatPath,
      bypassProxy,
      disableReasoning,
      forceBasicParams,
      reqBody,
    }, signal, traceId);

    if (!response.ok) {
      const errText = await response.text();
      return { ok: false, error: new Error(errText) };
    }

    const queue: StreamChunk[] = [];
    let resolveNext: (() => void) | null = null;
    let isFinished = false;
    let streamError: unknown = null;
    // 流中断时记录已接收原始字节数，供错误信息诊断（区分"首包即断"与"读了大半才断"）。
    let receivedBytes = 0;
    // P1-7: 用于在 generator 提前退出时主动取消后台 readSSEStream
    const streamAbortController = new AbortController();
    
    const handleAbortAction = () => {
      streamAbortController.abort();
      streamError = new DOMException("The user aborted a request.", "AbortError");
      isFinished = true;
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    };

    // 若外部 signal 已 aborted，立即同步取消
    // 7.3.2: 跟踪是否注册了监听器，确保在 generator 退出时移除，避免外部 signal 复用时累积
    let abortListenerRegistered = false;
    if (signal?.aborted) {
      handleAbortAction();
    } else if (signal) {
      signal.addEventListener("abort", handleAbortAction);
      abortListenerRegistered = true;
    }

    readSSEStream(response, {
      onData: (dataStr) => {
        const parsed = safeParseSSEData(dataStr);
        if (parsed) {
          if (parsed.error) {
            const errMsg = typeof parsed.error === "string"
              ? parsed.error
              : ((parsed.error as { message?: string }).message || JSON.stringify(parsed.error));
            throw new Error(`[API Error] ${errMsg}`);
          }
          queue.push(parsed as StreamChunk);
          if (resolveNext) {
            resolveNext();
            resolveNext = null;
          }
        }
      },
      onDone: () => {
        isFinished = true;
        if (resolveNext) {
          resolveNext();
          resolveNext = null;
        }
      }
    }, {
      // P1-7: 传入 signal，消费方提前 break 时立即 reader.cancel() + clearIdleTimer()
      signal: streamAbortController.signal,
      onBytesReceived: (bytes) => {
        receivedBytes += bytes;
      },
    }).catch((err) => {
      streamError = err;
      isFinished = true;
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    });

    try {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else if (isFinished) {
          if (streamError) {
            return { ok: false, error: this.enrichStreamError(streamError, baseUrl, receivedBytes) };
          }
          return { ok: true };
        } else {
          await new Promise<void>((resolve) => {
            resolveNext = resolve;
          });
        }
      }
    } finally {
      // P1-7: generator 提前退出（break/return/throw）时，主动 abort 后台 readSSEStream
      streamAbortController.abort();
      // 7.3.2: 移除外部 signal 上的 abort 监听器，避免复用同一 signal 时累积
      if (abortListenerRegistered && signal) {
        signal.removeEventListener("abort", handleAbortAction);
      }
    }
  }

  /**
   * 为可诊断的瞬态断流错误补充上下文：目标主机 + 已接收字节数。
   * 用户手动中止（AbortError）与业务性错误（[API Error] 等）保持原样透传。
   */
  private enrichStreamError(err: unknown, baseUrl: string, receivedBytes: number): unknown {
    if (getErrorName(err) === "AbortError" || !isTransientStreamInterrupt(err)) {
      return err;
    }
    const host = extractHost(baseUrl);
    return new Error(`[LLM 流式中断] 目标 ${host}，已接收 ${receivedBytes} 字节：${getErrorMessage(err)}`);
  }
}
