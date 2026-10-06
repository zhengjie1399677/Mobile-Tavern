/**
 * ChatStreamService 流式中断行为测试
 *
 * 背景：真机 LLM 流式请求偶发 "error decoding response body"（reqwest 在读取响应体
 * 中途断流时的统一报错）。既定策略：**一切消耗 token 的请求都不自动重试**，因此断流
 * 只做诊断增强，绝不重发；重发只能由用户在界面上显式触发。
 *
 * 覆盖：
 *  - testChatStreamNoRetryOnInterruptBeforeContent：首包交付前断流不重发（只发 1 次请求）
 *  - testChatStreamNoRetryAfterPartialContent：已输出内容后断流不重发且错误带诊断信息
 *  - testChatStreamNoRetryOnNonTransientError：非瞬态错误不重发且不加诊断包装
 */

import { Kernel } from "../../src/kernel/Kernel";
import { ChatStreamService } from "../../src/application/services/ChatStreamService";
import type { ILLMService, IKernelService, StreamChunk } from "@/src/application/serviceContracts";
import { assert } from "./testUtils";

type MockFetchImpl = ILLMService["universalFetch"];

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

export async function testChatStreamNoRetryOnInterruptBeforeContent() {
  console.log("\n--- ChatStreamService 首包交付前断流不重发 ---");

  let calls = 0;
  const fetchImpl: MockFetchImpl = async () => {
    calls += 1;
    // 首包未完整收到即断流：过去会被当作"可安全重试"，现在必须直接失败。
    return createInterruptedResponse(
      [`data: {"choices":[{"delta":{"content":"partial`],
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

  assert(calls === 1, `消耗 token 的请求不得自动重发，实际请求 ${calls} 次`);
  assert(chunks.length === 0, "未完整收到首包时不应交付任何 chunk");
  assert(thrown instanceof Error, "应抛出错误交给上层提示");
  const msg = (thrown as Error).message;
  assert(msg.includes("error decoding response body"), "保留原始错误信息");
  assert(msg.includes("api.deepseek.com"), "错误信息包含目标主机");
  assert(msg.includes("已接收"), "错误信息包含已接收字节数");

  await kernel.destroy();
  console.log("✔ 首包交付前断流不重发 verified successfully!");
}

export async function testChatStreamNoRetryAfterPartialContent() {
  console.log("\n--- ChatStreamService 已输出内容后断流不重发 ---");

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

  assert(calls === 1, "已输出内容后断流不得重发");
  assert(chunks.length === 1, "首个请求的部分内容已交付");
  assert(thrown instanceof Error, "应抛出错误");
  const msg = (thrown as Error).message;
  assert(msg.includes("error decoding response body"), "保留原始错误信息");
  assert(msg.includes("api.deepseek.com"), "错误信息包含目标主机");
  assert(msg.includes("已接收"), "错误信息包含已接收字节数");

  await kernel.destroy();
  console.log("✔ 已输出内容后断流不重发 verified successfully!");
}

export async function testChatStreamNoRetryOnNonTransientError() {
  console.log("\n--- ChatStreamService 非瞬态错误不重发 ---");

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

  assert(calls === 1, "非瞬态错误不重发");
  assert(thrown instanceof Error, "应抛出错误");
  const msg = (thrown as Error).message;
  assert(msg.includes("60000ms"), "保留原始错误信息");
  assert(!msg.includes("已接收"), "非瞬态错误不追加诊断包装");

  await kernel.destroy();
  console.log("✔ 非瞬态错误不重发 verified successfully!");
}
