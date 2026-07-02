import { IChatStreamService, IKernel, StreamChunk, StreamParams } from "../types";
import { readSSEStream, safeParseSSEData } from "../../utils/streamReader";
import { API_ENDPOINT } from "../../utils/apiClient";

export class ChatStreamService implements IChatStreamService {
  name = "chatStream";
  dependencies = ["llm"] as const;

  private kernel!: IKernel;
  // P1-1/P1-2: 服务级 AbortController
  private abortController: AbortController | null = null;

  init(kernel: IKernel, signal?: AbortSignal): void {
    this.kernel = kernel;
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener("abort", () => this.abortController?.abort());
    }
  }

  // P1-2: 销毁时中止挂起的流式响应
  destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  async *streamLlmResponse(params: StreamParams): AsyncGenerator<StreamChunk, void, unknown> {
    const { baseUrl, apiKey, chatPath, bypassProxy, disableReasoning, forceBasicParams, reqBody, signal } = params;

    const llmService = this.kernel.getService<any>("llm");
    const response = await llmService.universalFetch(API_ENDPOINT.ProxyOpenAI, {
      baseUrl,
      apiKey,
      chatPath,
      bypassProxy,
      disableReasoning,
      forceBasicParams,
      reqBody,
    }, signal);

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
    // 若外部 signal 已 aborted，立即同步取消
    if (signal?.aborted) {
      streamAbortController.abort();
    } else if (signal) {
      signal.addEventListener("abort", () => streamAbortController.abort());
    }

    readSSEStream(response, {
      onData: (dataStr) => {
        const parsed = safeParseSSEData(dataStr);
        if (parsed) {
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
    }
  }
}
