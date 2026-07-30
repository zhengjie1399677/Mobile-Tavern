import { IChatStreamService, IKernel, StreamChunk, StreamParams } from "../serviceContracts";
import { readSSEStream, safeParseSSEData } from "../../utils/streamReader";
import { API_ENDPOINT } from "../../utils/apiClient";

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
      throw new Error(errText);
    }

    const queue: StreamChunk[] = [];
    let resolveNext: (() => void) | null = null;
    let isFinished = false;
    let streamError: any = null;
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
      signal: streamAbortController.signal
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
            throw streamError;
          }
          break;
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
}
