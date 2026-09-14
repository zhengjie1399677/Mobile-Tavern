import { describe, expect, it } from "vitest";
import { readSSEStream } from "../../src/utils/streamReader";

/**
 * 回归测试：服务端不发送 `data: [DONE]` 就直接关闭连接时必须补发 onDone。
 *
 * 背景：readSSEStream 在 reader 正常结束时是 resolve 而非 reject，历史实现只在解析到
 * `[DONE]` 时才调用 onDone。消费方（ChatStreamService）依赖 onDone 置 isFinished，
 * 因此"无 [DONE] 的正常 EOF"会让消费循环永久挂起。
 */

const encoder = new TextEncoder();

interface FakeChunk {
  readonly payload: string;
  /** 返回该分片前的等待毫秒数，用于制造空闲超时。 */
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

describe("readSSEStream 结束通知", () => {
  it("服务端不发 [DONE] 就关闭连接时，仍会补发 onDone", async () => {
    const onData: string[] = [];
    let doneCount = 0;

    await readSSEStream(
      fakeResponse([{ payload: 'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n' }]),
      {
        onData: (data) => onData.push(data),
        onDone: () => {
          doneCount += 1;
        },
      },
    );

    expect(onData).toHaveLength(1);
    expect(onData[0]).toContain("你好");
    expect(doneCount).toBe(1);
  });

  it("已有 [DONE] 时不会重复补发 onDone", async () => {
    const onData: string[] = [];
    let doneCount = 0;

    await readSSEStream(
      fakeResponse([
        { payload: 'data: {"choices":[{"delta":{"content":"a"}}]}\n\n' },
        { payload: "data: [DONE]\n\n" },
      ]),
      {
        onData: (data) => onData.push(data),
        onDone: () => {
          doneCount += 1;
        },
      },
    );

    expect(doneCount).toBe(1);
  });

  it("空闲超时导致的中断不补发 onDone（错误必须走 reject 通路）", async () => {
    let doneCount = 0;
    let dataSeen = 0;

    await expect(
      readSSEStream(
        fakeResponse([
          { payload: 'data: {"choices":[{"delta":{"content":"a"}}]}\n\n' },
          { payload: 'data: {"choices":[{"delta":{"content":"b"}}]}\n\n', delayMs: 80 },
        ]),
        {
          onData: () => {
            dataSeen += 1;
          },
          onDone: () => {
            doneCount += 1;
          },
        },
        { idleTimeoutMs: 20 },
      ),
    ).rejects.toThrow(/无新数据传输/);

    expect(dataSeen).toBe(1);
    expect(doneCount).toBe(0);
  });
});
