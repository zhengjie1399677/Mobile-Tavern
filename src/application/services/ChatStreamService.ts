import type {
  IChatStreamService,
  IKernel,
  ILLMService,
  StreamChunk,
  StreamParams,
} from "../serviceContracts";
import {
  readSSEStream,
  safeParseSSEData,
  DEFAULT_FIRST_CHUNK_TIMEOUT_MS,
  DEFAULT_CHUNK_HEARTBEAT_TIMEOUT_MS,
  StreamTimeoutError,
} from "../../utils/streamReader";
import { API_ENDPOINT } from "../../utils/apiClient";
import { Logger } from "../../utils/logger";
import { getErrorMessage, getErrorName } from "../../utils/errorUtils";
import { normalizeProviderStreamChunk } from "./llmCompatibility";

const logger = Logger.create("ChatStreamService");

/** 单次流式请求的最终结果：ok=true 正常结束；ok=false 携带失败原因。 */
type AttemptOutcome = { ok: true } | { ok: false; error: unknown };

/**
 * 判断是否为响应体读取中途的断流。
 *
 * 真机上 LLM 请求经 tauri-plugin-http → Rust reqwest 发出；响应体读取中途的任何
 * 连接中断（连接重置 / 截断 / 超时）都会被 reqwest 统一归类为 Decode 错误，
 * 对外表现为 "error decoding response body"。
 *
 * 仅用于给错误补上目标主机与已接收字节数，**不用于自动重发**：重发会让上游
 * 重新生成一次回复（消耗 token），是否重发只能由用户显式点“重发”决定。
 */
function isResponseBodyInterrupt(err: unknown): boolean {
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
    // 单次请求，绝不自动重发：断流后重发会让上游重新生成一次回复（消耗 token），
    // 与「一切消耗 token 的请求都不自动重试」的既定策略冲突。已收到的内容照常
    // 交付给上层，剩余部分由用户在界面上显式“重发”。
    const attemptGen = this.attemptStream(params);
    try {
      while (true) {
        const next = await attemptGen.next();
        if (next.done) {
          if (!next.value.ok) throw next.value.error;
          return;
        }
        yield next.value;
      }
    } finally {
      // 消费方提前退出（break/return/throw）时关闭当前 attempt 的 generator，
      // 触发其 finally 清理后台 readSSEStream；返回值为空载体，无人消费。
      await attemptGen.return({ ok: true }).catch(() => {});
    }
  }

  private async *attemptStream(params: StreamParams): AsyncGenerator<StreamChunk, AttemptOutcome, unknown> {
    const {
      baseUrl,
      apiKey,
      chatPath,
      bypassProxy,
      disableReasoning,
      reasoningStrength,
      forceBasicParams,
      reqBody,
      signal,
      traceId,
      firstChunkTimeoutMs: customFirstChunkTimeout,
      chunkTimeoutMs: customChunkTimeout,
    } = params;

    const log = traceId ? logger.withTrace(traceId) : logger;
    const firstChunkTimeoutMs = customFirstChunkTimeout ?? DEFAULT_FIRST_CHUNK_TIMEOUT_MS;
    const chunkTimeoutMs = customChunkTimeout ?? DEFAULT_CHUNK_HEARTBEAT_TIMEOUT_MS;

    const queue: StreamChunk[] = [];
    let resolveNext: (() => void) | null = null;
    let isFinished = false;
    let streamError: unknown = null;
    // 流中断时记录已接收原始字节数，供错误信息诊断（区分"首包即断"与"读了大半才断"）。
    let receivedBytes = 0;

    let hasReceivedFirstChunk = false;
    let firstChunkTimer: ReturnType<typeof setTimeout> | null = null;
    let firstChunkTimedOut = false;

    const clearFirstChunkTimer = () => {
      if (firstChunkTimer !== null) {
        clearTimeout(firstChunkTimer);
        firstChunkTimer = null;
      }
    };

    const markFirstChunkReceived = () => {
      if (!hasReceivedFirstChunk) {
        hasReceivedFirstChunk = true;
        clearFirstChunkTimer();
      }
    };

    // P1-7: 用于在 generator 提前退出或超时时主动取消后台 readSSEStream
    const streamAbortController = new AbortController();

    if (firstChunkTimeoutMs > 0 && Number.isFinite(firstChunkTimeoutMs)) {
      firstChunkTimer = setTimeout(() => {
        if (!hasReceivedFirstChunk) {
          firstChunkTimedOut = true;
          log.warn("首字响应等待超时，主动终止请求", {
            baseUrl: extractHost(baseUrl),
            firstChunkTimeoutMs,
          });
          // 自包含收口：先把消费方唤醒并以超时错误结束生成，再取消底层请求。
          // 不能只依赖 abort 后 reader 会 reject——若底层流的 cancel 让挂起的 read() 以
          // done 结束，readSSEStream 会正常 resolve（既不 onDone 也不进 catch），
          // 生成器就会永久等待，界面卡在"生成中"。
          streamError = new StreamTimeoutError("first_chunk", firstChunkTimeoutMs);
          isFinished = true;
          if (resolveNext) {
            resolveNext();
            resolveNext = null;
          }
          streamAbortController.abort();
        }
      }, firstChunkTimeoutMs);
    }

    const handleAbortAction = () => {
      clearFirstChunkTimer();
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

    const llmService = this.kernel.getService<ILLMService>("llm");
    let response: Response;
    try {
      response = await llmService.universalFetch(API_ENDPOINT.ProxyOpenAI, {
        baseUrl,
        apiKey,
        chatPath,
        bypassProxy,
        disableReasoning,
        reasoningStrength,
        forceBasicParams,
        reqBody,
        timeoutMs: 0, // 声明禁用 universalFetch 内部固定超时，由两阶段心跳统一接管
      }, streamAbortController.signal, traceId);
    } catch (fetchErr) {
      clearFirstChunkTimer();
      if (firstChunkTimedOut) {
        return { ok: false, error: new StreamTimeoutError("first_chunk", firstChunkTimeoutMs) };
      }
      return { ok: false, error: fetchErr };
    }

    if (!response.ok) {
      clearFirstChunkTimer();
      const errText = await response.text();
      return { ok: false, error: new Error(errText) };
    }

    readSSEStream(response, {
      onData: (dataStr) => {
        markFirstChunkReceived();
        const parsed = safeParseSSEData(dataStr);
        const normalized = normalizeProviderStreamChunk(parsed);
        if (normalized) {
          if (normalized.error) {
            const errMsg = typeof normalized.error === "string"
              ? normalized.error
              : (normalized.error.message || JSON.stringify(normalized.error));
            throw new Error(`[API Error] ${errMsg}`);
          }
          queue.push(normalized);
          if (resolveNext) {
            resolveNext();
            resolveNext = null;
          }
        }
      },
      onDone: () => {
        markFirstChunkReceived();
        isFinished = true;
        if (resolveNext) {
          resolveNext();
          resolveNext = null;
        }
      }
    }, {
      // P1-7: 传入 signal，消费方提前 break 时立即 reader.cancel() + clearTimer()
      signal: streamAbortController.signal,
      firstChunkTimeoutMs,
      chunkTimeoutMs,
      onBytesReceived: (bytes) => {
        markFirstChunkReceived();
        receivedBytes += bytes;
      },
    }).catch((err) => {
      clearFirstChunkTimer();
      if (firstChunkTimedOut) {
        streamError = new StreamTimeoutError("first_chunk", firstChunkTimeoutMs);
      } else {
        streamError = err;
      }
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
      clearFirstChunkTimer();
      streamAbortController.abort();
      // 7.3.2: 移除外部 signal 上的 abort 监听器，避免复用同一 signal 时累积
      if (abortListenerRegistered && signal) {
        signal.removeEventListener("abort", handleAbortAction);
      }
    }
  }

  private enrichStreamError(err: unknown, baseUrl: string, receivedBytes: number): unknown {
    if (
      err instanceof StreamTimeoutError ||
      getErrorName(err) === "AbortError" ||
      !isResponseBodyInterrupt(err)
    ) {
      return err;
    }
    const host = extractHost(baseUrl);
    return new Error(`[LLM 流式中断] 目标 ${host}，已接收 ${receivedBytes} 字节：${getErrorMessage(err)}`);
  }
}
