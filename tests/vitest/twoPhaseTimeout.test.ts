import { describe, expect, it } from "vitest";
import {
  readSSEStream,
  StreamTimeoutError,
  DEFAULT_FIRST_CHUNK_TIMEOUT_MS,
  DEFAULT_CHUNK_HEARTBEAT_TIMEOUT_MS,
} from "../../src/utils/streamReader";
import { Kernel } from "../../src/kernel/Kernel";
import { ChatStreamService } from "../../src/application/services/ChatStreamService";
import type { ILLMService, IKernelService, StreamChunk } from "../../src/application/serviceContracts";

const encoder = new TextEncoder();

interface FakeChunk {
  readonly payload: string;
  readonly delayMs?: number;
}

function fakeResponse(chunks: readonly FakeChunk[]): Response {
  let index = 0;
  let cancelled = false;
  const reader = {
    async read() {
      if (cancelled || index >= chunks.length) return { value: undefined, done: true };
      const chunk = chunks[index++];
      if (chunk.delayMs) await new Promise((resolve) => setTimeout(resolve, chunk.delayMs));
      if (cancelled) return { value: undefined, done: true };
      return { value: encoder.encode(chunk.payload), done: false };
    },
    async cancel() {
      cancelled = true;
    },
    releaseLock() {
      /* noop */
    },
  };
  return { body: { getReader: () => reader } } as unknown as Response;
}

/**
 * 底层实现差异探针：cancel 后让挂起的 read() 以 done 结束（而非抛 AbortError）。
 *
 * 这是 Tauri / 部分 WebView 的真实可能语义之一。首字超时必须自包含收口，
 * 不能依赖 abort 一定让 reader reject，否则生成器会永久等待。
 */
function stallUntilCancelledResponse(): Response {
  let cancelResolve: (() => void) | null = null;
  const reader = {
    read() {
      return new Promise<{ value: undefined; done: boolean }>((resolve) => {
        cancelResolve = () => resolve({ value: undefined, done: true });
      });
    },
    async cancel() {
      cancelResolve?.();
    },
    releaseLock() {
      /* noop */
    },
  };
  return { ok: true, body: { getReader: () => reader } } as unknown as Response;
}

describe("两阶段动态心跳超时方案 (Two-Phase Dynamic Heartbeat Timeout)", () => {
  it("默认配置常量满足设计规范：首字等待 60s，心跳 60s（与主流客户端一致）", () => {
    expect(DEFAULT_FIRST_CHUNK_TIMEOUT_MS).toBe(60_000);
    expect(DEFAULT_CHUNK_HEARTBEAT_TIMEOUT_MS).toBe(60_000);
  });

  describe("阶段一：首字响应等待 (TTFT Timeout)", () => {
    it("首字到达前超过 firstChunkTimeoutMs 触发阶段一超时", async () => {
      let dataCount = 0;

      let caughtErr: unknown = null;
      try {
        await readSSEStream(
          fakeResponse([
            { payload: 'data: {"choices":[{"delta":{"content":"首字"}}]}\n\n', delayMs: 80 },
          ]),
          {
            onData: () => {
              dataCount++;
            },
          },
          { firstChunkTimeoutMs: 30, chunkTimeoutMs: 200 }
        );
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(StreamTimeoutError);
      const timeoutErr = caughtErr as StreamTimeoutError;
      expect(timeoutErr.phase).toBe("first_chunk");
      expect(timeoutErr.message).toContain("等待模型首字响应超时");
      expect(dataCount).toBe(0);
    });
  });

  describe("阶段二：数据流活跃心跳 (Chunk Inactivity Timeout)", () => {
    it("首字按时到达后切换到阶段二心跳，中途停顿超时触发阶段二断开", async () => {
      const received: string[] = [];
      let caughtErr: unknown = null;

      try {
        await readSSEStream(
          fakeResponse([
            // 首字 10ms 到达（阶段一未超时）
            { payload: 'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n', delayMs: 10 },
            // 第二块延迟 80ms，超过阶段二心跳时限 30ms
            { payload: 'data: {"choices":[{"delta":{"content":"世界"}}]}\n\n', delayMs: 80 },
          ]),
          {
            onData: (data) => {
              received.push(data);
            },
          },
          { firstChunkTimeoutMs: 100, chunkTimeoutMs: 30 }
        );
      } catch (err) {
        caughtErr = err;
      }

      expect(received).toHaveLength(1);
      expect(received[0]).toContain("你好");
      expect(caughtErr).toBeInstanceOf(StreamTimeoutError);
      const timeoutErr = caughtErr as StreamTimeoutError;
      expect(timeoutErr.phase).toBe("chunk_inactivity");
      expect(timeoutErr.message).toContain("模型响应中断");
      expect(timeoutErr.message).toContain("无新数据传输");
    });

    it("只要持续吐字重置心跳，总耗时超过心跳时限依然正常完成", async () => {
      const received: string[] = [];
      let doneCalled = false;

      // 连续输出 4 个分片，每个分片间隔 15ms，总耗时 60ms > 心跳 30ms
      await readSSEStream(
        fakeResponse([
          { payload: 'data: {"choices":[{"delta":{"content":"1"}}]}\n\n', delayMs: 15 },
          { payload: 'data: {"choices":[{"delta":{"content":"2"}}]}\n\n', delayMs: 15 },
          { payload: 'data: {"choices":[{"delta":{"content":"3"}}]}\n\n', delayMs: 15 },
          { payload: 'data: [DONE]\n\n', delayMs: 15 },
        ]),
        {
          onData: (data) => received.push(data),
          onDone: () => {
            doneCalled = true;
          },
        },
        { firstChunkTimeoutMs: 50, chunkTimeoutMs: 30 }
      );

      expect(received).toHaveLength(3);
      expect(doneCalled).toBe(true);
    });
  });

  describe("旧参数兼容与主动取消", () => {
    it("仅传入旧 idleTimeoutMs 时，两阶段均能作为回退生效", async () => {
      let caughtErr: unknown = null;
      try {
        await readSSEStream(
          fakeResponse([
            { payload: 'data: {"choices":[{"delta":{"content":"a"}}]}\n\n' },
            { payload: 'data: {"choices":[{"delta":{"content":"b"}}]}\n\n', delayMs: 50 },
          ]),
          { onData: () => {} },
          { idleTimeoutMs: 20 }
        );
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(StreamTimeoutError);
      expect((caughtErr as StreamTimeoutError).phase).toBe("chunk_inactivity");
    });

    it("外部 AbortSignal 取消时，抛出主动取消而非超时错误", async () => {
      const controller = new AbortController();
      let caughtErr: unknown = null;

      setTimeout(() => controller.abort(), 10);

      try {
        await readSSEStream(
          fakeResponse([
            { payload: 'data: {"choices":[{"delta":{"content":"a"}}]}\n\n', delayMs: 50 },
          ]),
          { onData: () => {} },
          { signal: controller.signal, firstChunkTimeoutMs: 200 }
        );
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).not.toBeInstanceOf(StreamTimeoutError);
    });
  });

  describe("ChatStreamService 协作与禁止自动重试", () => {
    it("响应头已到但正文不吐首字时，首字超时仍必须结束生成（不得永久挂起）", async () => {
      const kernel = new Kernel();
      const mockLlm: IKernelService & Pick<ILLMService, "universalFetch"> = {
        name: "llm",
        init() {},
        // 响应头正常返回、响应体永远不吐字节。
        universalFetch: async () => stallUntilCancelledResponse(),
      };

      const chatStream = new ChatStreamService();
      await kernel.registerService("llm", mockLlm);
      await kernel.registerService("chatStream", chatStream);

      const chunks: StreamChunk[] = [];
      let caughtErr: unknown = null;
      const run = (async () => {
        try {
          for await (const chunk of chatStream.streamLlmResponse({
            baseUrl: "https://api.test.com/v1",
            apiKey: "test",
            reqBody: {},
            firstChunkTimeoutMs: 30,
            chunkTimeoutMs: 200,
          })) {
            chunks.push(chunk);
          }
        } catch (err) {
          caughtErr = err;
        }
      })();

      const watchdog = new Promise<"hang">((resolve) => setTimeout(() => resolve("hang"), 600));
      const result = await Promise.race([run.then(() => "settled" as const), watchdog]);

      expect(result).toBe("settled");
      expect(chunks).toHaveLength(0);
      expect(caughtErr).toBeInstanceOf(StreamTimeoutError);
      expect((caughtErr as StreamTimeoutError).phase).toBe("first_chunk");

      await kernel.destroy();
    });

    it("ChatStreamService 发生首字超时时，直接抛出 StreamTimeoutError 且绝对不自动重试", async () => {
      const kernel = new Kernel();
      let fetchCalls = 0;

      const mockLlm: IKernelService & Pick<ILLMService, "universalFetch"> = {
        name: "llm",
        init() {},
        universalFetch: async (_endpoint, _config, signal) => {
          fetchCalls++;
          // 模拟服务端首字排队 100ms
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (signal?.aborted) {
            throw new DOMException("The user aborted a request.", "AbortError");
          }
          return fakeResponse([{ payload: 'data: {"choices":[{"delta":{"content":"late"}}]}\n\n' }]);
        },
      };

      const chatStream = new ChatStreamService();
      await kernel.registerService("llm", mockLlm);
      await kernel.registerService("chatStream", chatStream);

      const chunks: StreamChunk[] = [];
      let caughtErr: unknown = null;

      try {
        for await (const chunk of chatStream.streamLlmResponse({
          baseUrl: "https://api.test.com/v1",
          apiKey: "test",
          reqBody: {},
          firstChunkTimeoutMs: 30, // 30ms 触发首字超时
          chunkTimeoutMs: 100,
        })) {
          chunks.push(chunk);
        }
      } catch (err) {
        caughtErr = err;
      }

      // 核心验证：严禁重试（只调用了 1 次 fetch），抛出首字超时异常
      expect(fetchCalls).toBe(1);
      expect(chunks).toHaveLength(0);
      expect(caughtErr).toBeInstanceOf(StreamTimeoutError);
      expect((caughtErr as StreamTimeoutError).phase).toBe("first_chunk");

      await kernel.destroy();
    });
  });
});
