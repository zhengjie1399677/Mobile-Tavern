import { IChatStreamService, IKernel, StreamChunk, StreamParams } from "../types";
import { readSSEStream, safeParseSSEData } from "../../utils/streamReader";
import { API_ENDPOINT } from "../../utils/apiClient";

export class ChatStreamService implements IChatStreamService {
  name = "chatStream";
  dependencies = ["llm"] as const;

  private kernel!: IKernel;

  init(kernel: IKernel): void {
    this.kernel = kernel;
  }

  async *streamLlmResponse(params: StreamParams): AsyncGenerator<StreamChunk, void, unknown> {
    const { baseUrl, apiKey, chatPath, bypassProxy, reqBody, signal } = params;

    const llmService = this.kernel.getService<any>("llm");
    const response = await llmService.universalFetch(API_ENDPOINT.ProxyOpenAI, {
      baseUrl,
      apiKey,
      chatPath,
      bypassProxy,
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
    }).catch((err) => {
      streamError = err;
      isFinished = true;
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    });

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
  }
}
