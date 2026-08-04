/**
 * ChatStreamService 流式中断加固测试
 *
 * 背景：真机 LLM 流式请求偶发 "error decoding response body"（reqwest 在读取
 * 响应体中途断流时的统一报错）。加固策略：
 *  - 未输出任何内容时对该类瞬态断流自动重试一次；
 *  - 已输出部分内容时不得重试（避免重复文本），直接抛错；
 *  - 错误信息补充目标主机与已接收字节数，便于定位；
 *  - 非瞬态错误（超时提示、[API Error] 等）保持原样透传。
 *
 * 覆盖：
 *  - testChatStreamRetryOnDecodeError：首个请求瞬态断流时自动重试一次
 *  - testChatStreamNoRetryAfterPartialContent：已输出内容后断流不重试且错误带诊断信息
 *  - testChatStreamNoRetryOnNonTransientError：非瞬态错误不重试且不加诊断包装
 */

import { Kernel } from "../../src/kernel/Kernel";
import { ChatStreamService } from "../../src/application/services/ChatStreamService";
import type { ILLMService, IKernelService, StreamChunk } from "@/src/application/serviceContracts";
import { assert } from "./testUtils";

type MockFetchImpl = ILLMService["universalFetch"];

/** 构造一个完整可正常结束的 SSE 响应。 */
function createSseResponse(content: string): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(content));
        controller.close();
      },
    })
  );
}

/**
 * 构造"先输出若干段字节，随后以指定错误中断"的响应，模拟响应体读取中途失败。
 * 注意：不能同步（或仅隔一个微任务）enqueue 后立即 error——此时读侧尚未
 * 消费已入队数据，error 会丢弃它们；必须用宏任务延迟 error，让读取先完成。
 */
function createInterruptedResponse(chunks: string[], err: Error): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        setTimeout(() => controller.error(err), 0);
      },
    })
  );
}

async function createChatStream(fetchImpl: MockFetchImpl): Promise<{ service: ChatStreamService; kernel: Kernel }> {
  const kernel = new Kernel();
  const mockLlm: IKernelService & Pick<ILLMService, "universalFetch"> = {
    name: "llm",
    init() {},
    universalFetch: fetchImpl,
  };
  const service = new ChatStreamService();
  await kernel.registerService("llm", mockLlm);
  await kernel.registerService("chatStream", service);
  return { service, kernel };
}

export async function testChatStreamRetryOnDecodeError() {
  console.log("\n--- ChatStreamService 瞬态断流自动重试 ---");
  const okSse =
    `data: {"choices":[{"delta":{"content":"重试成功"}}]}\n\n` +
    `data: [DONE]\n\n`;

  let calls = 0;
  const fetchImpl: MockFetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      // 首包未完整收到即断流，属于可安全重试的瞬态失败。
      return createInterruptedResponse(
        [`data: {"choices":[{"delta":{"content":"partial`],
        new Error("error decoding response body: connection closed before message completed")
      );
    }
    return createSseResponse(okSse);
  };

  const { service, kernel } = await createChatStream(fetchImpl);
  const chunks: StreamChunk[] = [];
  for await (const chunk of service.streamLlmResponse({
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "mock",
    reqBody: {},
  })) {
    chunks.push(chunk);
  }

  assert(calls === 2, "瞬态断流应自动重试一次（共 2 次请求）");
  assert(chunks.length === 1, "第二次请求应正常输出内容");
  assert(chunks[0].choices?.[0]?.delta?.content === "重试成功", "重试后内容正确");

  await kernel.destroy();
  console.log("✔ 瞬态断流自动重试 verified successfully!");
}

export async function testChatStreamNoRetryAfterPartialContent() {
  console.log("\n--- ChatStreamService 已输出内容后断流不重试 ---");

  let calls = 0;
  const fetchImpl: MockFetchImpl = async () => {
    calls += 1;
    return createInterruptedResponse(
      [`data: {"choices":[{"delta":{"content":"部分内容"}}]}\n\n`],
      new Error("error decoding response body: connection closed before message completed")
    );
  };

  const { service, kernel } = await createChatStream(fetchImpl);
  const chunks: StreamChunk[] = [];
  let thrown: unknown = null;
  try {
    for await (const chunk of service.streamLlmResponse({
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "mock",
      reqBody: {},
    })) {
      chunks.push(chunk);
    }
  } catch (err) {
    thrown = err;
  }

  assert(calls === 1, "已输出内容后断流不得重试");
  assert(chunks.length === 1, "首个请求的部分内容已交付");
  assert(thrown instanceof Error, "应抛出错误");
  const msg = (thrown as Error).message;
  assert(msg.includes("error decoding response body"), "保留原始错误信息");
  assert(msg.includes("api.deepseek.com"), "错误信息包含目标主机");
  assert(msg.includes("已接收"), "错误信息包含已接收字节数");

  await kernel.destroy();
  console.log("✔ 已输出内容后断流不重试 verified successfully!");
}

export async function testChatStreamNoRetryOnNonTransientError() {
  console.log("\n--- ChatStreamService 非瞬态错误不重试 ---");

  let calls = 0;
  const fetchImpl: MockFetchImpl = async () => {
    calls += 1;
    return createInterruptedResponse([], new Error("SSE 流超过 60000ms 无新数据传输"));
  };

  const { service, kernel } = await createChatStream(fetchImpl);
  let thrown: unknown = null;
  try {
    for await (const _chunk of service.streamLlmResponse({
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "mock",
      reqBody: {},
    })) {
      // 不应产生任何 chunk
      assert(false, "非瞬态错误不应输出任何内容");
    }
  } catch (err) {
    thrown = err;
  }

  assert(calls === 1, "非瞬态错误不重试");
  assert(thrown instanceof Error, "应抛出错误");
  const msg = (thrown as Error).message;
  assert(msg.includes("60000ms"), "保留原始错误信息");
  assert(!msg.includes("已接收"), "非瞬态错误不追加诊断包装");

  await kernel.destroy();
  console.log("✔ 非瞬态错误不重试 verified successfully!");
}
