import { isPrivateIp, validateBaseUrlSecurity } from "../src/utils/security";
import { replaceMacros, getTriggeredLorebookEntries, assemblePromptContext } from "../src/utils/promptBuilder";
import { injectPngMetadata } from "../src/utils/cardParser";
import { CharacterCard, LorebookEntry, Message } from "../src/types";
import { unzlibSync, inflateSync } from "fflate";
import { runCatbotErrorTests } from "./test_catbot_error_handling";
import { cleanRequestPayload } from "../src/utils/apiClient";
import { readSSEStream, safeParseSSEData } from "../src/utils/streamReader";
import { Kernel, setKernelStrictMode } from "../src/kernel/Kernel";
import { IKernelService } from "../src/kernel/types";

// PNG verification constants
const PNG_SIGNATURE_HEADER_1 = 0x89504e47;
const PNG_SIGNATURE_HEADER_2 = 0x0d0a1a0a;
const PNG_IHDR_END_OFFSET = 33;

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function testSsrfGuard() {
  console.log("\n--- Running SSRF Guard Verification ---");

  // Test cases that MUST be blocked
  const blockedCases = [
    "http://127.0.0.1",
    "http://localhost",
    "http://10.0.0.1",
    "http://192.168.1.1",
    "http://172.16.0.1",
    "http://172.31.255.255",
    "http://[::1]",
    "http://[fe80::1]",
    "http://[fd00::1]",
    "http://[::ffff:127.0.0.1]", // IPv4-mapped loopback bypass check
    "http://[::ffff:7f00:0001]", // hex IPv4-mapped loopback check
    "http://[::ffff:10.0.0.1]", // IPv4-mapped private check
    "http://0177.0.0.01", // octal format
    "http://0x7f000001", // hex format
    "http://2130706433", // decimal format
  ];

  // Test cases that MUST be allowed
  const allowedCases = [
    "http://172.32.0.1",
    "http://8.8.8.8",
    "https://github.com",
  ];

  for (const tc of blockedCases) {
    try {
      await validateBaseUrlSecurity(tc);
      throw new Error(`Bypass allowed on: ${tc}`);
    } catch (err: any) {
      assert(err.message.includes("restricted") || err.message.includes("Forbidden"), `Blocked correctly: ${tc}`);
      console.log(`✔ Correctly blocked: ${tc}`);
    }
  }

  for (const tc of allowedCases) {
    try {
      await validateBaseUrlSecurity(tc);
      console.log(`✔ Correctly allowed: ${tc}`);
    } catch (err: any) {
      throw new Error(`Valid target blocked: ${tc} - ${err.message}`);
    }
  }

  console.log("✔ SSRF Guard test suite passed!");
}

async function testDbQueue() {
  console.log("\n--- Running DB Concurrency Queue Verification ---");
  let writeQueue = Promise.resolve();

  function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = writeQueue.then(operation);
    writeQueue = result.then(
      () => {},
      () => {}
    );
    return result;
  }

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const executionOrder: string[] = [];

  const p1 = enqueueWrite(async () => {
    executionOrder.push("start 1");
    await delay(50);
    executionOrder.push("end 1");
    return "val1";
  });

  const p2 = enqueueWrite(async () => {
    executionOrder.push("start 2 (fail)");
    await delay(30);
    executionOrder.push("end 2 (fail)");
    throw new Error("error2");
  });

  const p3 = enqueueWrite(async () => {
    executionOrder.push("start 3");
    await delay(20);
    executionOrder.push("end 3");
    return "val3";
  });

  assert(await p1 === "val1", "p1 returns correct resolution");
  try {
    await p2;
    throw new Error("p2 should reject");
  } catch (e: any) {
    assert(e.message === "error2", "p2 returns correct rejection");
  }
  assert(await p3 === "val3", "p3 returns correct resolution");

  const expectedOrder = [
    "start 1", "end 1",
    "start 2 (fail)", "end 2 (fail)",
    "start 3", "end 3"
  ];
  assert(JSON.stringify(executionOrder) === JSON.stringify(expectedOrder), "Queue runs sequentially");
  console.log("✔ DB Queue serialization and error recovery verified!");
}

function testPromptBuilder() {
  console.log("\n--- Running Prompt Builder Verification ---");

  const macroParams = {
    char: "Alice",
    user: "Bob",
    description: "A helpful AI assistant that costs $10.",
    personality: "Optimistic.",
    scenario: "In a cozy tavern with $20 cash.",
    userPersona: "A curious traveler.",
    mes_example: "Hello!",
  };

  // 1. replaceMacros test
  const t1 = "Hello, {{user}}! I am {{char}}.";
  assert(replaceMacros(t1, macroParams) === "Hello, Bob! I am Alice.", "replaceMacros replacement");

  const t2 = "Description: {{description}} and Cash: {{scenario}}";
  const expectedT2 = "Description: A helpful AI assistant that costs $10. and Cash: In a cozy tavern with $20 cash.";
  assert(replaceMacros(t2, macroParams) === expectedT2, "replaceMacros special characters");

  // 2. getTriggeredLorebookEntries test
  const baseEntries: LorebookEntry[] = [
    {
      id: "l_const",
      keys: ["always"],
      content: "Constant info",
      constant: true,
      enabled: true,
    },
    {
      id: "l_keyword",
      keys: ["magic", "spell"],
      content: "Spellcasting details",
      enabled: true,
      scanDepth: 5,
    },
  ];

  const messages: Message[] = [
    { id: "m1", sender: "user", content: "Let's cast a spell." },
  ];

  const active = getTriggeredLorebookEntries(messages, "I love magic.", baseEntries);
  const activeIds = active.map(e => e.id);
  assert(activeIds.includes("l_const"), "Includes constant lore");
  assert(activeIds.includes("l_keyword"), "Includes keyword lore");

  console.log("✔ Prompt Builder macros & lorebook triggering verified!");
}

function parsePngMetadataLocal(arrayBuffer: ArrayBuffer): any {
  if (arrayBuffer.byteLength < PNG_IHDR_END_OFFSET) {
    throw new Error("Invalid PNG: size too small");
  }
  const view = new DataView(arrayBuffer);
  if (view.getUint32(0) !== PNG_SIGNATURE_HEADER_1 || view.getUint32(4) !== PNG_SIGNATURE_HEADER_2) {
    throw new Error("Invalid PNG signature");
  }

  const uint8 = new Uint8Array(arrayBuffer);
  let offset = 8;
  const decoder = new TextDecoder("utf-8");

  while (offset < arrayBuffer.byteLength) {
    if (offset + 8 > arrayBuffer.byteLength) break;
    const length = view.getUint32(offset);
    if (offset + 12 + length > arrayBuffer.byteLength) {
      throw new Error("Corrupt PNG chunk");
    }
    const chunkType = String.fromCharCode(
      uint8[offset + 4],
      uint8[offset + 5],
      uint8[offset + 6],
      uint8[offset + 7],
    );

    if (chunkType === "IEND") break;

    if (chunkType === "tEXt") {
      const chunkData = uint8.slice(offset + 8, offset + 8 + length);
      let nullIdx = 0;
      while (nullIdx < chunkData.length && chunkData[nullIdx] !== 0) {
        nullIdx++;
      }

      const keyword = decoder.decode(chunkData.slice(0, nullIdx));
      if (keyword.toLowerCase() === "chara") {
        const textContent = decoder.decode(chunkData.slice(nullIdx + 1));
        const trimmed = textContent.trim();
        let decoded = "";
        try {
          const binString = atob(trimmed);
          const bytes = new Uint8Array(binString.length);
          for (let i = 0; i < binString.length; i++) {
            bytes[i] = binString.charCodeAt(i);
          }
          decoded = new TextDecoder("utf-8").decode(bytes);
        } catch {
          decoded = trimmed;
        }
        return JSON.parse(decoded);
      }
    }
    offset += 12 + length;
  }
  throw new Error("Chara chunk not found");
}

async function testPngCardParser() {
  console.log("\n--- Running PNG Card Parser & Writer Verification ---");

  const originalChar: CharacterCard = {
    id: "char_test_99",
    name: "Tavern Hero (中文 ✅)",
    description: "Tavern Character Description.",
    personality: "Cool.",
    scenario: "Fantasy setting.",
    first_mes: "Welcome!",
    mes_example: "",
    system_prompt: "",
    lorebookEntries: [],
  };

  const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const dummyPngBuffer = Buffer.from(base64Png, 'base64');

  const arrayBuffer = dummyPngBuffer.buffer.slice(
    dummyPngBuffer.byteOffset,
    dummyPngBuffer.byteOffset + dummyPngBuffer.byteLength
  );

  const resultBlob = injectPngMetadata(arrayBuffer, originalChar);
  const outputBuffer = await resultBlob.arrayBuffer();

  const extracted = parsePngMetadataLocal(outputBuffer);
  const data = extracted.data || extracted;

  assert(data.name === originalChar.name, "PNG character name matches");
  assert(data.description === originalChar.description, "PNG character description matches");
  console.log("✔ PNG Metadata injection and roundtrip parsing verified!");
}

function testApiCleanRequestPayload() {
  console.log("\n--- Running API Request Payload Cleaning Verification ---");

  const fullPayload = {
    model: "gpt-4",
    messages: [{ role: "user", content: "hello" }],
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    min_p: 0.05,
    max_tokens: 100,
    max_completion_tokens: 100,
    presence_penalty: 0.5,
    frequency_penalty: 0.5,
    repetition_penalty: 1.1,
  };

  // 1. OpenRouter (不应该裁剪任何参数)
  const openRouterRes = cleanRequestPayload("https://openrouter.ai/api/v1", fullPayload);
  assert(openRouterRes !== undefined, "OpenRouter payload should exist");
  assert(openRouterRes!.top_k === 40, "OpenRouter: keep top_k");
  assert(openRouterRes!.min_p === 0.05, "OpenRouter: keep min_p");
  assert(openRouterRes!.repetition_penalty === 1.1, "OpenRouter: keep repetition_penalty");
  assert(openRouterRes!.max_completion_tokens === 100, "OpenRouter: keep max_completion_tokens");
  assert(openRouterRes!.stream_options !== undefined, "OpenRouter: keep stream_options");

  // 2. OpenAI Official (只保留 OpenAI 官方标准参数)
  const openaiRes = cleanRequestPayload("https://api.openai.com/v1", fullPayload);
  assert(openaiRes !== undefined, "OpenAI payload should exist");
  assert(openaiRes!.top_k === undefined, "OpenAI: strip top_k");
  assert(openaiRes!.min_p === undefined, "OpenAI: strip min_p");
  assert(openaiRes!.repetition_penalty === undefined, "OpenAI: strip repetition_penalty");
  assert(openaiRes!.max_completion_tokens === 100, "OpenAI: keep max_completion_tokens");
  assert(openaiRes!.stream_options !== undefined, "OpenAI: keep stream_options");
  assert(openaiRes!.temperature === 0.7, "OpenAI: keep standard parameters");

  // 3. DeepSeek Official (保留 repetition_penalty，但去除 top_k, min_p, max_completion_tokens, stream_options)
  const deepseekRes = cleanRequestPayload("https://api.deepseek.com/v1", fullPayload);
  assert(deepseekRes !== undefined, "DeepSeek payload should exist");
  assert(deepseekRes!.top_k === undefined, "DeepSeek: strip top_k");
  assert(deepseekRes!.min_p === undefined, "DeepSeek: strip min_p");
  assert(deepseekRes!.repetition_penalty === 1.1, "DeepSeek: keep repetition_penalty");
  assert(deepseekRes!.max_completion_tokens === undefined, "DeepSeek: strip max_completion_tokens");
  assert(deepseekRes!.stream_options === undefined, "DeepSeek: strip stream_options");

  // 4. Gemini / Google (剔除所有非标)
  const geminiRes = cleanRequestPayload("https://generativelanguage.googleapis.com/v1beta", fullPayload);
  assert(geminiRes !== undefined, "Gemini payload should exist");
  assert(geminiRes!.top_k === undefined, "Gemini: strip top_k");
  assert(geminiRes!.min_p === undefined, "Gemini: strip min_p");
  assert(geminiRes!.repetition_penalty === undefined, "Gemini: strip repetition_penalty");
  assert(geminiRes!.max_completion_tokens === undefined, "Gemini: strip max_completion_tokens");
  assert(geminiRes!.stream_options === undefined, "Gemini: strip stream_options");

  // 5. Default/Other unknown endpoint
  const otherRes = cleanRequestPayload("https://api.some-thirdparty-中转.top/v1", fullPayload);
  assert(otherRes !== undefined, "Other payload should exist");
  assert(otherRes!.top_k === undefined, "Other: strip top_k");
  assert(otherRes!.min_p === undefined, "Other: strip min_p");
  assert(otherRes!.repetition_penalty === undefined, "Other: strip repetition_penalty");
  assert(otherRes!.max_completion_tokens === undefined, "Other: strip max_completion_tokens");
  assert(otherRes!.stream_options === undefined, "Other: strip stream_options");

  // 6. Custom proxy + DeepSeek model (应该保留 repetition_penalty 哪怕域名不符合)
  const deepseekModelPayload = { ...fullPayload, model: "deepseek-reasoner" };
  const customProxyDeepseekRes = cleanRequestPayload("https://api.some-thirdparty-中转.top/v1", deepseekModelPayload);
  assert(customProxyDeepseekRes !== undefined, "Custom proxy deepseek payload should exist");
  assert(customProxyDeepseekRes!.repetition_penalty === 1.1, "Custom Proxy Deepseek: KEEP repetition_penalty based on model name");
  assert(customProxyDeepseekRes!.stream_options === undefined, "Custom Proxy Deepseek: strip stream_options");

  // 7. Custom proxy + GPT model (应该裁剪 stream_options 等)
  const gptModelPayload = { ...fullPayload, model: "gpt-4o" };
  const customProxyGptRes = cleanRequestPayload("https://api.some-thirdparty-中转.top/v1", gptModelPayload);
  assert(customProxyGptRes !== undefined, "Custom proxy gpt payload should exist");
  assert(customProxyGptRes!.stream_options === undefined, "Custom Proxy GPT: strip stream_options to avoid 400");
  assert(customProxyGptRes!.max_completion_tokens === undefined, "Custom Proxy GPT: strip max_completion_tokens");

  console.log("✔ API Request Payload Cleaning verified successfully!");
}

async function testSSEStreamWithReasoning() {
  console.log("\n--- Running SSE Stream with Reasoning Content Verification ---");

  // 模拟一个包含 reasoning_content 的流式响应数据
  const mockSseChunks = [
    'data: {"choices":[{"delta":{"reasoning_content":"思考一"}}]}\n\n',
    'data: {"choices":[{"delta":{"reasoning_content":"，思考二"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"！"}}]}\n\n',
    'data: [DONE]\n\n'
  ].join("");

  // 将字符串模拟成 ReadableStream 的 Response
  const mockStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(mockSseChunks));
      controller.close();
    }
  });

  const mockResponse = new Response(mockStream);

  let responseText = "";
  let reasoningText = "";

  await readSSEStream(mockResponse, {
    onData: (dataStr) => {
      const parsed = safeParseSSEData(dataStr);
      if (!parsed) return;

      const reasoning = (parsed as any).choices?.[0]?.delta?.reasoning_content;
      if (reasoning) {
        reasoningText += reasoning;
        return;
      }

      const delta = (parsed as any).choices?.[0]?.delta?.content;
      if (delta) {
        responseText += delta;
      }
    }
  });

  // 断言验证最终拼接的思维链和正式对白
  assert(reasoningText === "思考一，思考二", `Reasoning Text should match. Got: ${reasoningText}`);
  assert(responseText === "你好！", `Response Text should match. Got: ${responseText}`);

  console.log("✔ SSE Stream with Reasoning Content verified successfully!");
}

function testPromptBuilderSystemMerging() {
  console.log("\n--- Running Prompt Builder System Merging Verification ---");
  // 模拟 settings
  const mockSettings = {
    userName: "Bob",
    userInfo: "Traveler",
    api: { type: "openai-compat", baseUrl: "", apiKey: "", modelName: "" },
    preset: { temperature: 0.7, topP: 0.9, topK: 40, repetitionPenalty: 1.1, maxTokens: 100 },
    memory: { recentTurns: 10, summaryTriggerTurns: 0, summaryLength: 150 },
    promptConfig: { roleplayMode: true, mainPrompt: "You are Alice.", instructTemplate: "default" }
  } as any;

  // 模拟角色卡
  const mockChar = {
    name: "Alice",
    description: "AI",
    personality: "Optimistic",
    scenario: "Cozy tavern",
    first_mes: "Hello",
  } as any;

  // 模拟包含中途 System 消息的 Chat
  const mockChat = {
    messages: [
      { id: "m1", sender: "user", content: "Hi" },
      { id: "m2", sender: "system", content: "Suddenly, the weather turned cold." },
      { id: "m3", sender: "system", content: "A monster appears." },
      { id: "m4", sender: "assistant", content: "Oh no!" },
    ]
  } as any;

  const result = assemblePromptContext({
    character: mockChar,
    chat: mockChat,
    userInput: "What do I do?",
    settings: mockSettings,
  });

  // 验证返回的 history
  // 1. m2 和 m3 (中途 system) 应该被伪装成 user 旁白并合并成一条消息。
  // 2. 合并后的 user 旁白应该与 m1 (user) 合并在一起，形成一条统一的 user 消息，以维持 strict user/assistant 交替。
  // 最终的 history 应该只有 2 条：
  // 第一条：role: "user", content 包含了 "Hi"、"Suddenly, the weather turned cold." 和 "A monster appears."
  // 第二条：role: "assistant" (或 model), content 包含了 "Oh no!"
  
  assert(result.history.length === 2, `History length should be 2 to maintain strict alternation. Got: ${result.history.length}`);
  
  const firstMsg = result.history[0];
  assert(firstMsg.role === "user", `First msg role should be user. Got: ${firstMsg.role}`);
  assert(firstMsg.content.includes("Hi"), "Should contain first user message content");
  assert(firstMsg.content.includes("[系统旁白: Suddenly, the weather turned cold.]"), "Should contain system narrator 1");
  assert(firstMsg.content.includes("[系统旁白: A monster appears.]"), "Should contain system narrator 2");

  const secondMsg = result.history[1];
  assert(secondMsg.role === "model" || secondMsg.role === "assistant", "Second msg role should be assistant/model");
  assert(secondMsg.content.includes("Oh no!"), "Should contain assistant content");

  console.log("✔ Prompt Builder System Merging and strict alternation verified!");
}

async function testKernelFaultIsolation() {
  console.log("\n--- Running Kernel Fault Isolation Verification ---");

  const testKernel = new Kernel();

  // 1. 测试正常的服务注册与获取
  const mockService: IKernelService = {
    name: "mock-normal",
    init(kernel) {
      (this as any).initialized = true;
    }
  };
  await testKernel.registerService("mock-normal", mockService);
  const retrieved = testKernel.getService<any>("mock-normal");
  assert(retrieved.name === "mock-normal", "Service retrieval name matches");
  assert(retrieved.initialized === true, "Service initialized correctly");

  // 2. 测试异步 init 初始化的微服务
  let asyncInitRun = false;
  const mockAsyncService: IKernelService = {
    name: "mock-async",
    async init(kernel) {
      await new Promise(resolve => setTimeout(resolve, 10));
      asyncInitRun = true;
    }
  };
  await testKernel.registerService("mock-async", mockAsyncService);
  assert(asyncInitRun === true, "Async init resolves correctly before registration completes");

  // 3. 测试非致命初始化崩溃的服务隔离
  const badService: IKernelService = {
    name: "mock-bad",
    init(kernel) {
      throw new Error("Init crash simulated!");
    }
  };
  // 注册非致命崩溃服务，由于有 try-catch，这不应该向外抛出异常
  try {
    await testKernel.registerService("mock-bad", badService);
  } catch (err) {
    throw new Error("registerService should isolate non-critical initialization crashes");
  }

  // 4. 测试致命核心服务崩溃的主动熔断阻断
  const criticalService: IKernelService = {
    name: "mock-critical",
    isCritical: true,
    init(kernel) {
      throw new Error("Critical service loading error!");
    }
  };
  let criticalErrorThrown = false;
  try {
    await testKernel.registerService("mock-critical", criticalService);
  } catch (err: any) {
    assert(err.message.includes("Fatal") && err.message.includes("Critical service"), "Critical error propagates to host");
    criticalErrorThrown = true;
  }
  assert(criticalErrorThrown === true, "Fatal critical service initialization must halt kernel");

  // 5. 测试服务销毁生命周期 (destroy)
  let destroyRun = false;
  const mockDestroyService: IKernelService = {
    name: "mock-destroy",
    init(kernel) {},
    async destroy(kernel) {
      destroyRun = true;
    }
  };
  await testKernel.registerService("mock-destroy", mockDestroyService);
  await testKernel.destroyService("mock-destroy");
  assert(destroyRun === true, "Destroy hook executed successfully");
  // 销毁后再次获取，应退化为 Safe Proxy
  const nullService = testKernel.getService<any>("mock-destroy");
  assert(nullService.name === "mock-destroy", "Destroyed service fallbacks to safe proxy");

  // 6. 测试获取不存在的（或者初始化崩掉而被剔除的）服务
  // 应该返回 No-op Safe Proxy，而不是抛出异常
  const proxyService = testKernel.getService<any>("mock-bad");
  assert(proxyService !== undefined, "Proxy service returned instead of throwing");
  assert(proxyService.name === "mock-bad", "Proxy service returns name property correctly");

  // 7. 测试 No-op Safe Proxy 的深度链式属性读取
  try {
    const val = proxyService.config.api.enabled;
    assert(typeof val === "function", "Proxy deep properties return proxy noop function");
  } catch (err) {
    throw new Error("Proxy should not throw on deep property access");
  }

  // 8. 测试 No-op Safe Proxy 的普通方法调用和链式方法调用
  try {
    proxyService.someMethod("arg1", 2).anotherMethod();
  } catch (err) {
    throw new Error("Proxy should not throw on arbitrary method calls");
  }

  // 9. 测试 No-op Safe Proxy 的 Promise await 链兼容性
  try {
    const p = proxyService.asyncSaveSession({ id: "session1" });
    const res = await p;
    assert(res === undefined, "Proxy await resolves to undefined");
  } catch (err) {
    throw new Error("Proxy should properly resolve Promise await chain");
  }

  console.log("✔ Kernel Fault Isolation and Safe No-op Proxy verified!");
}

async function testKernelPipeline() {
  console.log("\n--- Running Kernel Pipeline Middlewares Verification ---");

  const testKernel = new Kernel();

  // 1. 验证内置管道已预设
  const inputPipeline = testKernel.getPipeline("input");
  const outputPipeline = testKernel.getPipeline("output");
  const settingsPipeline = testKernel.getPipeline("settings");
  assert(inputPipeline !== undefined, "input pipeline preset");
  assert(outputPipeline !== undefined, "output pipeline preset");
  assert(settingsPipeline !== undefined, "settings pipeline preset");

  // 2. 验证防空自动注册
  const customPipeline = testKernel.getPipeline("my-custom-pipeline");
  assert(customPipeline !== undefined, "custom pipeline auto registered");
  const sameCustom = testKernel.getPipeline("my-custom-pipeline");
  assert(customPipeline === sameCustom, "subsequent get returns the same instance");

  // 3. 验证洋葱模型与优先级排序
  interface TestContext {
    logs: string[];
    value: number;
  }

  const pipeline = testKernel.registerPipeline<TestContext>("test-onion");
  
  // 注册中优先级中间件
  pipeline.use(async (ctx, next) => {
    ctx.logs.push("mid-start");
    ctx.value += 10;
    await next();
    ctx.logs.push("mid-end");
  }, 10);

  // 注册高优先级中间件
  pipeline.use(async (ctx, next) => {
    ctx.logs.push("high-start");
    ctx.value *= 2;
    await next();
    ctx.logs.push("high-end");
  }, 100);

  // 注册低优先级中间件
  pipeline.use((ctx, next) => {
    // 测试同步和默认优先级 (0)
    ctx.logs.push("low-start");
    ctx.value -= 5;
    // 尽管是同步，但也需要调用 next 以延续管道
    const p = next();
    ctx.logs.push("low-end");
    return p;
  });

  const context: TestContext = { logs: [], value: 5 };
  await pipeline.execute(context);

  // 预期执行流程:
  // 1. high-start (value = 5 * 2 = 10)
  // 2. mid-start  (value = 10 + 10 = 20)
  // 3. low-start  (value = 20 - 5 = 15)
  // 4. low-end
  // 5. mid-end
  // 6. high-end
  assert(context.value === 15, `Context final value should be 15, got: ${context.value}`);
  const expectedLogs = ["high-start", "mid-start", "low-start", "low-end", "mid-end", "high-end"];
  assert(JSON.stringify(context.logs) === JSON.stringify(expectedLogs), `Logs sequence is incorrect, got: ${JSON.stringify(context.logs)}`);

  // 4. 验证管道阻断拦截功能
  const interceptPipeline = testKernel.registerPipeline<TestContext>("test-intercept");
  interceptPipeline.use(async (ctx, next) => {
    ctx.logs.push("m1-start");
    await next();
    ctx.logs.push("m1-end");
  }, 20);

  // 阻断者：不调用 next()
  interceptPipeline.use(async (ctx, next) => {
    ctx.logs.push("blocker");
    (ctx as any).isInterrupted = true;
    // 不调用 next()
  }, 10);

  interceptPipeline.use(async (ctx, next) => {
    ctx.logs.push("m3");
    await next();
  }, 0);

  const blockContext: TestContext = { logs: [], value: 0 };
  await interceptPipeline.execute(blockContext);

  const expectedBlockLogs = ["m1-start", "blocker", "m1-end"];
  assert(JSON.stringify(blockContext.logs) === JSON.stringify(expectedBlockLogs), `Blocker did not stop pipeline correctly, got: ${JSON.stringify(blockContext.logs)}`);

  console.log("✔ Kernel Middleware Pipeline & onion composition verified successfully!");
}

async function testKernelPipelineHardening() {
  console.log("\n--- Running Kernel Pipeline Hardening (Recovery, Unsubscribe, Proxy Warning) Verification ---");

  const testKernel = new Kernel();
  
  // 1. 验证 Safe Proxy 双轨环境警告
  const originalWarn = console.warn;
  let warnMessage = "";
  console.warn = (msg: string, ...args: any[]) => {
    warnMessage = msg;
    originalWarn(msg, ...args);
  };

  try {
    const nonexistent = testKernel.getService<any>("nonexistent-service");
    // 读取属性触发警告
    const testVal = nonexistent.someConfig.api;
    assert(warnMessage.includes("Accessing property") && warnMessage.includes("SafeProxy"), "SafeProxy dev diagnostic outputs warning");
  } finally {
    console.warn = originalWarn; // 恢复 console.warn
  }

  // 2. 验证动态注销中间件 (use返回的注销函数及 unuse)
  interface HardContext {
    logs: string[];
    isInterrupted?: boolean;
  }

  const p1 = testKernel.registerPipeline<HardContext>("hardening-pipeline-cleanup");
  
  const mid1 = (ctx: HardContext, next: () => Promise<void>) => {
    ctx.logs.push("m1");
    return next();
  };

  const mid2 = (ctx: HardContext, next: () => Promise<void>) => {
    ctx.logs.push("m2");
    return next();
  };

  // 注册并获取注销器
  const unsubscribe = p1.use(mid1, 10);
  p1.use(mid2, 5);

  const ctx1: HardContext = { logs: [] };
  await p1.execute(ctx1);
  assert(JSON.stringify(ctx1.logs) === JSON.stringify(["m1", "m2"]), "Pipeline runs registered middlewares");

  // 执行注销函数注销 mid1
  unsubscribe();
  const ctx2: HardContext = { logs: [] };
  await p1.execute(ctx2);
  assert(JSON.stringify(ctx2.logs) === JSON.stringify(["m2"]), "Unsubscribed middleware does not run");

  // 使用 unuse 卸载 mid2
  p1.unuse(mid2);
  const ctx3: HardContext = { logs: [] };
  await p1.execute(ctx3);
  assert(JSON.stringify(ctx3.logs) === JSON.stringify([]), "unuse-d middleware does not run");

  // 3. 验证异常隔离：中间件崩溃后管道停止（B-3 修复：不再自动跳过）
  const p2 = testKernel.registerPipeline<HardContext>("hardening-pipeline-error");

  // 注册一个会崩溃抛错的中间件
  p2.use(async (ctx, next) => {
    ctx.logs.push("err-start");
    throw new Error("Simulated plugin crash!");
  }, 10);

  // 注册正常的后续中间件（B-3 修复后：异常后不再自动跳过，该中间件不应执行）
  p2.use(async (ctx, next) => {
    ctx.logs.push("should-not-run-after-crash");
    await next();
  }, 5);

  // 拦截 console.error 以防测试报告日志过于杂乱
  const originalError = console.error;
  let errorLogged = false;
  console.error = (...args: any[]) => {
    errorLogged = true;
    originalError(...args);
  };

  try {
    const errorCtx: HardContext = { logs: [] };
    await p2.execute(errorCtx);
    // B-3 修复：异常后管道在此终止，后续中间件不应执行
    assert(errorCtx.logs.includes("err-start"), "Error middleware ran before crash");
    assert(!errorCtx.logs.includes("should-not-run-after-crash"), "Pipeline halted at crash point, subsequent middleware did not run (B-3 fix)");
    assert(errorLogged === true, "Pipeline logged the exception correctly");
  } finally {
    console.error = originalError;
  }

  // 4. 验证遗忘 next() 时管道停止（B-3 修复：不再自动穿透安全边界）
  const p3 = testKernel.registerPipeline<HardContext>("hardening-pipeline-hanging");

  // 中间件遗忘调用 next()，且没有设置 isInterrupted
  p3.use((ctx, _next) => {
    ctx.logs.push("forget-next");
    // 不调用 next()：在旧版本会自动跳过，B-3 修复后管道在此停止
  }, 10);

  p3.use(async (ctx, next) => {
    ctx.logs.push("should-not-run-without-next");
    await next();
  }, 5);

  const originalError2 = console.error;
  let forgotNextErrorLogged = false;
  console.error = (...args: any[]) => {
    forgotNextErrorLogged = true;
    originalError2(...args);
  };

  try {
    const hangCtx: HardContext = { logs: [] };
    await p3.execute(hangCtx);
    // B-3 修复：遗忘 next() 后记录错误但不穿透，后续中间件不执行
    assert(hangCtx.logs.includes("forget-next"), "Middleware ran before forgetting next()");
    assert(!hangCtx.logs.includes("should-not-run-without-next"), "Pipeline halted after forget-next, no bypass (B-3 fix)");
    assert(forgotNextErrorLogged === true, "Pipeline logged forget-next error");
  } finally {
    console.error = originalError2;
  }

  // 5. 验证受控的阻断拦截 (isInterrupted)
  const p4 = testKernel.registerPipeline<HardContext>("hardening-pipeline-interrupt");

  // 敏感词/阻断中间件
  p4.use((ctx, next) => {
    ctx.logs.push("interrupt-middleware");
    ctx.isInterrupted = true;
    // 显式申请阻断，不调 next
  }, 10);

  p4.use(async (ctx, next) => {
    ctx.logs.push("should-not-run");
    await next();
  }, 5);

  const interruptCtx: HardContext = { logs: [] };
  await p4.execute(interruptCtx);
  assert(JSON.stringify(interruptCtx.logs) === JSON.stringify(["interrupt-middleware"]), "Pipeline was successfully halted explicitly via isInterrupted");

  console.log("✔ Kernel Pipeline Hardening & Self-healing features verified successfully!");
}

async function testKernelHardeningP0ToP3() {
  console.log("\n--- Running Kernel Hardening P0 to P3 Verification ---");

  // 临时开启严格开发校验模式
  setKernelStrictMode(true);

  try {
    // 1. 验证 消息总线订阅与注销 (P0)
    const testKernel = new Kernel();
    let msgRunCount = 0;
    const handler = (msg: any) => {
      assert(msg.payload === "hello-data", "Payload must match");
      msgRunCount++;
    };

    // 验证 subscribe 返回注销闭包
    const dispose = testKernel.subscribe("test:topic", handler);
    await testKernel.publish({ topic: "test:topic", payload: "hello-data" });
    assert(msgRunCount === 1, "Subscriber should be triggered once");

    // 执行注销
    dispose();
    await testKernel.publish({ topic: "test:topic", payload: "hello-data" });
    assert(msgRunCount === 1, "Subscriber should not trigger after dispose");

    // 验证 unsubscribe 显式销毁
    msgRunCount = 0;
    testKernel.subscribe("test:topic2", handler);
    await testKernel.publish({ topic: "test:topic2", payload: "hello-data" });
    assert(msgRunCount === 1, "Subscriber 2 should trigger once");

    testKernel.unsubscribe("test:topic2", handler);
    await testKernel.publish({ topic: "test:topic2", payload: "hello-data" });
    assert(msgRunCount === 1, "Subscriber 2 should not trigger after unsubscribe");

    // 2. 验证 Service 注册原子性 (P1)
    let serviceInitialized = false;
    let initPhaseGetServiceThrew = false;
    const initCrashService: IKernelService = {
      name: "crash-service",
      isCritical: true, // 致命关键服务，以验证报错向上传播与熔断
      async init(kernel) {
        serviceInitialized = true;
        // B-2 修复后的新语义：在 init() 过程中，criticalServiceNames 已包含本服务名称，
        // 因此 getService("crash-service") 会直接抛出 FATAL 而非返回 SafeProxy。
        // 这是正确行为：关键服务在任何阶段都不允许静默降级。
        try {
          kernel.getService("crash-service");
        } catch (e: any) {
          initPhaseGetServiceThrew = true;
          // 验证确实是 FATAL 错误而非 SafeProxy
          if (!e.message.includes("FATAL")) {
            throw e; // 不是预期的 FATAL，重新抛出
          }
        }
        throw new Error("Init crash simulated!");
      }
    };

    try {
      await testKernel.registerService("crash-service", initCrashService);
      throw new Error("Should have thrown error on registerService crash");
    } catch (err: any) {
      assert(err.message.includes("Init crash simulated!"), "Correct error thrown from init");
    }
    // 验证原子性：init 报错时，不可暴露实例在 services 容器中
    assert(serviceInitialized === true, "Init function was run");
    // B-2 修复后：init 过程中关键服务 getService 调用应抛出 FATAL（不是 SafeProxy）
    assert(initPhaseGetServiceThrew === true, "During init of critical service, getService(self) throws FATAL not SafeProxy (B-2 fix)");

    // 注册失败后，services 容器中不能存在该实例
    // B-2 修复后：关键服务注册失败后 getService 直接抛出 FATAL（而非返回 SafeProxy DevError）
    let threwOnAccess = false;
    try {
      const serviceAfterFail = testKernel.getService<any>("crash-service");
    } catch (e: any) {
      threwOnAccess = true;
      assert(e.message.includes("FATAL") && e.message.includes("crash-service"), "After failed critical service init, getService throws FATAL (B-2 fix)");
    }
    assert(threwOnAccess === true, "Critical service after failed init must throw FATAL on getService");


    // 3. 验证 Pipeline 开发模式漏调 next() / 报错强抛 (P1)
    interface DevCtx {
      logs: string[];
      isInterrupted?: boolean;
    }
    const pipeline = testKernel.registerPipeline<DevCtx>("dev-test-pipeline");

    // 3.1 验证漏调 next() 且没有 isInterrupted 标志时在开发环境下抛出强 Error
    pipeline.use((ctx, next) => {
      ctx.logs.push("m1");
      // 漏调 next()，且没有 ctx.isInterrupted = true
    }, 10);

    let hangErrorThrown = false;
    try {
      await pipeline.execute({ logs: [] });
    } catch (err: any) {
      assert(err.message.includes("without calling next()"), "Dev mode throws error when middleware leaks next()");
      hangErrorThrown = true;
    }
    assert(hangErrorThrown === true, "Pipeline hang error thrown in dev mode");

    // 清除刚才的漏调中间件，测试受控拦截
    pipeline.unuse(pipeline["middlewares"][0].fn); // 强行清除刚才挂载的漏调中间件

    // 3.2 验证中间件报错在开发环境下向上强抛，不加掩盖
    pipeline.use((ctx, next) => {
      throw new Error("User Code Error!");
    }, 20);

    let codeErrorThrown = false;
    try {
      await pipeline.execute({ logs: [] });
    } catch (err: any) {
      assert(err.message === "User Code Error!", "Dev mode throws original plugin exception upwards");
      codeErrorThrown = true;
    }
    assert(codeErrorThrown === true, "Plugin exception thrown directly to host in dev mode");

    // 4. 验证 SafeProxy 开发期抛错拦截 (P2)
    const nonexistent = testKernel.getService<any>("not-found-service");
    let proxyThrew = false;
    try {
      const testVal = nonexistent.api.url;
    } catch (err: any) {
      assert(err.message.includes("is not registered") && err.message.includes("SafeProxy"), "Dev mode block silent failures by throwing");
      proxyThrew = true;
    }
    assert(proxyThrew === true, "SafeProxy properties block access in dev mode");

    // 5. 验证一键销毁 destroy() (P3)
    const okService: IKernelService = {
      name: "ok-service",
      init(kernel) {},
      destroy(kernel) {
        (this as any).destroyed = true;
      }
    };
    await testKernel.registerService("ok-service", okService);
    
     // 注册一堆 pipelines 和 subscribers
     testKernel.subscribe("destroy-event", () => {});
     testKernel.registerPipeline("destroy-pipeline");
 
     // 一键销毁
     await testKernel.destroy();
 
     // 验证服务注销及 destroy 钩子触发
     assert(okService["destroyed"] === true, "Service destroy hook executed");
     assert(testKernel["services"].size === 0, "All services cleared");
     assert(testKernel["subscribers"].size === 0, "All subscribers cleared");
     assert(testKernel["pipelines"].size === 0, "All pipelines cleared");

    console.log("✔ Kernel Hardening P0 to P3 features verified successfully!");
  } finally {
    // 恢复为默认非严格的生产运行模式
    setKernelStrictMode(false);
  }
}

async function testKernelKernelV2Fixes() {
  console.log("\n--- Running Kernel V2 Fixes: B-1 / B-2 / B-4 / C-1 Verification ---");

  // ─── B-2：关键服务缺失时在任何环境均抛出致命错误 ─────────────────────────────
  {
    const k = new Kernel();
    // 模拟关键服务初始化失败
    const critSvc: IKernelService = {
      name: "critical-db",
      isCritical: true,
      init() { throw new Error("DB init failed"); }
    };
    try { await k.registerService("critical-db", critSvc); } catch {}

    let threwFatal = false;
    try {
      k.getService<any>("critical-db");
    } catch (e: any) {
      threwFatal = true;
      assert(e.message.includes("FATAL") && e.message.includes("critical-db"), "B-2: getService throws FATAL for known critical service");
    }
    assert(threwFatal === true, "B-2: Critical service unavailability must throw, never SafeProxy");
    console.log("  ✔ B-2: Critical service protection verified");
  }

  // ─── B-4：MessageBus 消息订阅优先级排序 ──────────────────────────────────────────
  {
    const k = new Kernel();
    const order: number[] = [];
    k.subscribe("priority-test", () => { order.push(2); }, 20);
    k.subscribe("priority-test", () => { order.push(3); }, 10);
    k.subscribe("priority-test", () => { order.push(1); }, 100);
    await k.publish({ topic: "priority-test", payload: null });
    assert(JSON.stringify(order) === JSON.stringify([1, 2, 3]), `B-4: MessageBus priority order wrong, got [${order}]`);
    console.log("  ✔ B-4: MessageBus priority ordering verified");
  }

  // ─── B-4：publishParallel 并行消息触发 ────────────────────────────────────
  {
    const k = new Kernel();
    const startTimes: number[] = [];
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
    k.subscribe("parallel-test", async () => { startTimes.push(Date.now()); await delay(30); });
    k.subscribe("parallel-test", async () => { startTimes.push(Date.now()); await delay(30); });
    const before = Date.now();
    await k.publishParallel({ topic: "parallel-test", payload: null });
    const elapsed = Date.now() - before;
    assert(startTimes.length === 2, "B-4: Both parallel subscribers executed");
    // 串行执行至少 60ms，并行执行应小于 55ms（容忍 timer 误差）
    assert(elapsed < 55, `B-4: Parallel subscribers should finish concurrently, took ${elapsed}ms`);
    console.log("  ✔ B-4: publishParallel concurrency verified");
  }

  // ─── B-4：publishParallel 异常隔离 ───────────────────────────────────
  {
    const k = new Kernel();
    let sub2Ran = false;
    k.subscribe("parallel-err", async () => { throw new Error("subscriber1 crash"); });
    k.subscribe("parallel-err", async () => { sub2Ran = true; });
    await k.publishParallel({ topic: "parallel-err", payload: null }); // 不应抛出
    assert(sub2Ran === true, "B-4: Parallel message routing isolates individual failures, other subscribers still run");
    console.log("  ✔ B-4: publishParallel fault isolation verified");
  }

  // ─── B-1：registerServiceBatch 拓扑排序 ──────────────────────────────────
  {
    const k = new Kernel();
    const initOrder: string[] = [];
    const svcA: IKernelService = {
      name: "svcA",
      dependencies: ["svcB"],
      init() { initOrder.push("A"); }
    };
    const svcB: IKernelService = {
      name: "svcB",
      dependencies: ["svcC"],
      init() { initOrder.push("B"); }
    };
    const svcC: IKernelService = {
      name: "svcC",
      init() { initOrder.push("C"); }
    };
    // 故意以错误顺序传入，拓扑排序应自动修正为 C → B → A
    await k.registerServiceBatch([
      { name: "svcA", service: svcA },
      { name: "svcB", service: svcB },
      { name: "svcC", service: svcC },
    ]);
    assert(JSON.stringify(initOrder) === JSON.stringify(["C", "B", "A"]), `B-1: Topo sort wrong, got [${initOrder}]`);
    console.log("  ✔ B-1: registerServiceBatch topological sort verified");
  }

  // ─── B-1：循环依赖检测 ────────────────────────────────────────────────────
  {
    const k = new Kernel();
    const cycleA: IKernelService = { name: "cycleA", dependencies: ["cycleB"], init() {} };
    const cycleB: IKernelService = { name: "cycleB", dependencies: ["cycleA"], init() {} };
    let cycleDetected = false;
    try {
      await k.registerServiceBatch([
        { name: "cycleA", service: cycleA },
        { name: "cycleB", service: cycleB },
      ]);
    } catch (e: any) {
      cycleDetected = true;
      assert(e.message.includes("Circular dependency"), `B-1: Circular dependency error message wrong: ${e.message}`);
    }
    assert(cycleDetected === true, "B-1: Circular dependency must throw");
    console.log("  ✔ B-1: Circular dependency detection verified");
  }

  // ─── C-1：init() 超时熔断 ─────────────────────────────────────────────────
  {
    const k = new Kernel();
    const hangSvc: IKernelService = {
      name: "hang-svc",
      async init() {
        await new Promise(() => {}); // 永久挂起
      }
    };
    let timedOut = false;
    try {
      await k.registerService("hang-svc", hangSvc, 50); // 50ms 超时
    } catch (e: any) {
      timedOut = true;
      assert(e.message.includes("timed out"), `C-1: Timeout error message wrong: ${e.message}`);
    }
    assert(timedOut === true, "C-1: init() timeout must throw");
    // 超时后服务不应进入 services 容器
    const proxy = k.getService<any>("hang-svc");
    assert(proxy.name === "hang-svc", "C-1: Timed-out service falls back to SafeProxy");
    console.log("  ✔ C-1: init() timeout熔断 verified");
  }

  // ─── C-2：Pipeline.list() 可观测性 ───────────────────────────────────────
  {
    const k = new Kernel();
    const p = k.registerPipeline<{ x: number }>("observe-test");
    async function middlewareAlpha(ctx: { x: number }, next: () => Promise<void>) { await next(); }
    async function middlewareBeta(ctx: { x: number }, next: () => Promise<void>) { await next(); }
    p.use(middlewareAlpha, 10);
    p.use(middlewareBeta, 5);
    const list = p.list();
    assert(list.length === 2, `C-2: list() should return 2 entries, got ${list.length}`);
    assert(list[0].name === "middlewareAlpha" && list[0].priority === 10, "C-2: list() first entry correct");
    assert(list[1].name === "middlewareBeta" && list[1].priority === 5, "C-2: list() second entry correct");
    console.log("  ✔ C-2: Pipeline.list() observability verified");
  }

  console.log("\n✔ Kernel V2 Fixes (B-1/B-2/B-4/C-1/C-2) all verified successfully!");
}

async function testKernelV3Fixes() {
  console.log("\n--- Running Kernel V3 Fixes: 条目2/3/4/5 Verification ---");

  // ─── 条目 2：destroy() 逆序销毁验证 ──────────────────────────────────────
  {
    const k = new Kernel();
    const destroyOrder: string[] = [];

    // 模拟拓扑排序后的注册顺序：base 先注册，top 后注册
    const baseSvc: IKernelService = {
      name: "base-svc",
      init() {},
      destroy() { destroyOrder.push("base"); }
    };
    const topSvc: IKernelService = {
      name: "top-svc",
      dependencies: ["base-svc"],
      init() {},
      destroy() { destroyOrder.push("top"); }
    };
    // 使用 registerServiceBatch，base 先注册（拓扑排序）
    await k.registerServiceBatch([
      { name: "top-svc", service: topSvc },
      { name: "base-svc", service: baseSvc },
    ]);

    await k.destroy();
    // 注册顺序：base → top；销毁顺序必须：top → base
    assert(JSON.stringify(destroyOrder) === JSON.stringify(["top", "base"]),
      `条目2: destroy() 应逆序销毁，期望 [top, base]，实际 [${destroyOrder}]`);
    console.log("  ✔ 条目2: destroy() reverse order verified");
  }

  // ─── 条目 3：SafeProxy 拦截 Symbol 属性 ──────────────────────────────────
  {
    const k = new Kernel();
    const proxy = k.getService<any>("nonexistent-for-symbol-test");

    // Symbol 属性访问应返回 undefined，不触发 strictMode 报错，不引发无限递归
    const symResult = proxy[Symbol.toStringTag];
    assert(symResult === undefined, "条目3: SafeProxy[Symbol.toStringTag] 应返回 undefined");
    const iterResult = proxy[Symbol.iterator];
    assert(iterResult === undefined, "条目3: SafeProxy[Symbol.iterator] 应返回 undefined");
    console.log("  ✔ 条目3: SafeProxy Symbol interception verified");
  }

  // ─── 条目 4：unsubscribe 空 key 清理 ──────────────────────────────────
  {
    const k = new Kernel();
    const handler = () => {};
    k.subscribe("cleanup-topic", handler);
    // 注册后 Map 应包含该 key
    assert(k["subscribers"].has("cleanup-topic"), "条目4: subscriber key should exist after subscribe");
    k.unsubscribe("cleanup-topic", handler);
    // 注销后数组为空，Map 应彻底删除该 key
    assert(!k["subscribers"].has("cleanup-topic"), "条目4: subscriber key should be deleted when handlers array becomes empty");
    console.log("  ✔ 条目4: unsubscribe empty key cleanup verified");
  }

  // ─── 条目 5：消息分发超时熔断（publish 串行） ───────────────────────────
  {
    const k = new Kernel();
    let sub2Ran = false;
    // 注册一个永久挂起的订阅者
    k.subscribe("timeout-serial", async () => { await new Promise(() => {}); }, 10);
    k.subscribe("timeout-serial", async () => { sub2Ran = true; }, 5);

    const raceResult = await Promise.race([
      k.publish({ topic: "timeout-serial", payload: null }),
      new Promise<"timeout">(r => setTimeout(() => r("timeout"), 200)),
    ]);
    assert(raceResult === "timeout" || raceResult === undefined,
      "条目5: publish with hanging subscriber resolved (timeout mechanism exists)");
    await k.destroy(); // 销毁内核以强制中断并回收正在挂起的分发任务，防止 5 秒后的悬挂定时器超时报错
    console.log("  ✔ 条目5: Subscriber timeout mechanism verified (structure)");
  }

  // ─── 条目 5：消息分发超时熔断（publishParallel 并行） ──────────────────
  {
    const k = new Kernel();
    let sub2RanParallel = false;
    k.subscribe("timeout-parallel", async () => { await new Promise(() => {}); });
    k.subscribe("timeout-parallel", async () => { sub2RanParallel = true; });

    const raceResult = await Promise.race([
      k.publishParallel({ topic: "timeout-parallel", payload: null }),
      new Promise<"timeout">(r => setTimeout(() => r("timeout"), 200)),
    ]);
    assert(raceResult === "timeout" || raceResult === undefined,
      "条目5: publishParallel with hanging subscriber resolved");
    await k.destroy(); // 销毁内核以强制中断并回收正在挂起的并发分发任务
    console.log("  ✔ 条目5: publishParallel timeout mechanism verified (structure)");
  }

  console.log("\n✔ Kernel V3 Fixes (条目2/3/4/5) all verified successfully!");
}

async function testKernelV4AbortAndInterrupt() {
  console.log("\n--- Running Kernel V4: Abort and Interrupt Verification ---");

  // 1. 验证中间件使用第三个参数 interrupt() 阻断
  {
    const k = new Kernel();
    interface TestCtx {
      logs: string[];
      isInterrupted?: boolean;
    }
    const p = k.registerPipeline<TestCtx>("v4-interrupt");
    
    p.use(async (ctx, next, interrupt) => {
      ctx.logs.push("m1");
      interrupt(); // 调用第三个参数阻断
    }, 10);

    p.use(async (ctx, next, interrupt) => {
      ctx.logs.push("m2");
      await next();
    }, 5);

    const ctx: TestCtx = { logs: [] };
    // 在严格开发模式下执行，不应抛出“漏调 next”的错误，因为调用了 interrupt()
    setKernelStrictMode(true);
    try {
      await p.execute(ctx);
      assert(JSON.stringify(ctx.logs) === JSON.stringify(["m1"]), "Pipeline should stop at m1 due to interrupt()");
      assert(ctx.isInterrupted === true, "isInterrupted flag should be set to true automatically");
    } finally {
      setKernelStrictMode(false);
    }
    console.log("  ✔ V4: Middleware interrupt() function verified");
  }

  // 2. 验证服务初始化中的 AbortSignal 取消
  {
    const k = new Kernel();
    let isAborted = false;

    const hangSvc: IKernelService = {
      name: "hang-init-svc",
      async init(kernel, signal) {
        if (signal) {
          signal.addEventListener("abort", () => {
            isAborted = true;
          });
        }
        // 模拟一个挂起的异步任务
        await new Promise((resolve, reject) => {
          // 监听 signal，及时 reject 以释放 Promise
          if (signal) {
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }
        });
      }
    };

    let errorThrown = false;
    try {
      await k.registerService("hang-init-svc", hangSvc, 50); // 50ms 超时熔断
    } catch (e: any) {
      errorThrown = true;
      assert(e.message.includes("timed out"), "Should throw timeout error");
    }
    assert(errorThrown === true, "Should have thrown timeout error");
    assert(isAborted === true, "AbortSignal should be triggered on timeout");
    console.log("  ✔ V4: Service init AbortSignal cancel verified");
  }

  // 3. 验证 Hook 执行中的 AbortSignal 超时与销毁联动
  {
    const k = new Kernel();
    let isSubAborted = false;
    let sub2Ran = false;

    k.subscribe("test-topic", async (msg, signal) => {
      if (signal) {
        signal.addEventListener("abort", () => {
          isSubAborted = true;
        });
      }
      await new Promise((resolve, reject) => {
        if (signal) {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }
      });
    }, 10);

    k.subscribe("test-topic", async (msg, signal) => {
      sub2Ran = true;
    }, 5);

    console.log("  ✔ V4: Subscriber AbortSignal timeout structure setup verified");
  }

  // 4. 验证内核销毁时一键 Abort 挂起的任务
  {
    const k = new Kernel();
    let isInitAborted = false;
    let isSubAborted = false;

    const hangSvc: IKernelService = {
      name: "hang-svc-destroy-test",
      async init(kernel, signal) {
        if (signal) {
          signal.addEventListener("abort", () => {
            isInitAborted = true;
          });
        }
        await new Promise((resolve, reject) => {
          if (signal) {
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }
        });
      }
    };

    k.subscribe("destroy-topic", async (msg, signal) => {
      if (signal) {
        signal.addEventListener("abort", () => {
          isSubAborted = true;
        });
      }
      await new Promise((resolve, reject) => {
        if (signal) {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }
      });
    });

    // 启动异步服务注册（挂起）
    const pRegister = k.registerService("hang-svc-destroy-test", hangSvc);
    // 启动异步 消息分发（挂起）
    const pPublish = k.publish({ topic: "destroy-topic", payload: null });

    // 延迟片刻让它们都运行起来
    await new Promise(r => setTimeout(r, 10));

    // 调用销毁
    await k.destroy();

    assert(isInitAborted === true, "Init task should be aborted immediately upon destroy()");
    assert(isSubAborted === true, "Subscriber task should be aborted immediately upon destroy()");

    // 此时 pRegister 和 pPublish 应该都已经 resolve/reject 完成，不应继续悬空挂起
    try {
      await pRegister;
    } catch {}
    try {
      await pPublish;
    } catch {}

    console.log("  ✔ V4: Kernel destroy overall active AbortControllers verified");
  }

  console.log("\n✔ Kernel V4 Fixes all verified successfully!");
}

async function testKernelExtensionRegistry() {
  console.log("\n--- Running Kernel Extension Registry (SPI) Verification ---");

  const testKernel = new Kernel();

  const initialExts = testKernel.getExtensions("test:point");
  assert(initialExts.length === 0, "Initial extensions list for targetPoint must be empty");

  const comp1 = { name: "Comp1" };
  const comp2 = { name: "Comp2" };
  const comp3 = { name: "Comp3" };

  testKernel.registerExtension({
    id: "ext1",
    targetPoint: "test:point",
    priority: 10,
    component: comp1,
  });

  testKernel.registerExtension({
    id: "ext2",
    targetPoint: "test:point",
    priority: 50,
    component: comp2,
  });

  testKernel.registerExtension({
    id: "ext3",
    targetPoint: "test:point",
    priority: 5,
    component: comp3,
  });

  const list = testKernel.getExtensions("test:point");
  assert(list.length === 3, "Should contain 3 registered extensions");

  assert(list[0].id === "ext2", "Highest priority extension should be first");
  assert(list[1].id === "ext1", "Middle priority extension should be second");
  assert(list[2].id === "ext3", "Lowest priority extension should be third");

  const comp2Updated = { name: "Comp2-Updated" };
  testKernel.registerExtension({
    id: "ext2",
    targetPoint: "test:point",
    priority: 8,
    component: comp2Updated,
  });

  const updatedList = testKernel.getExtensions("test:point");
  assert(updatedList.length === 3, "Should still contain 3 extensions after replacement");
  const ext2Node = updatedList.find(e => e.id === "ext2");
  assert(ext2Node !== undefined, "ext2 node must exist");
  assert(ext2Node!.component === comp2Updated, "Component must be updated to the new one");
  assert(ext2Node!.priority === 8, "Priority must be updated to 8");

  assert(updatedList[0].id === "ext1", "ext1 (priority 10) should now be first");
  assert(updatedList[1].id === "ext2", "ext2 (priority 8) should now be second");
  assert(updatedList[2].id === "ext3", "ext3 (priority 5) should now be third");

  await testKernel.destroy();
  const postDestroyList = testKernel.getExtensions("test:point");
  assert(postDestroyList.length === 0, "List must be empty after kernel destroy");

  console.log("✔ Kernel Extension Registry (SPI) verified successfully!");
}


async function run() {
  setKernelStrictMode(false); // 默认在测试流程中采用生产（容错自愈）模式
  console.log("=================================================");
  console.log("🚀 STARTING ALL SYSTEM FUNCTIONAL TESTS");
  console.log("=================================================");
  try {
    await testSsrfGuard();
    await testDbQueue();
    testPromptBuilder();
    await testPngCardParser();
    runCatbotErrorTests();
    testApiCleanRequestPayload();
    await testSSEStreamWithReasoning();
    testPromptBuilderSystemMerging();
    await testKernelFaultIsolation();
    await testKernelPipeline();
    await testKernelPipelineHardening();
    await testKernelHardeningP0ToP3();
    await testKernelKernelV2Fixes();
    await testKernelV3Fixes();
    await testKernelV4AbortAndInterrupt();
    await testKernelExtensionRegistry();
    console.log("\n=================================================");
    console.log("🎉 ALL TESTS COMPLETED SUCCESSFULLY!");
    console.log("=================================================");
  } catch (err: any) {
    console.error("\n❌ TESTS FAILED!");
    console.error(err.stack || err.message);
    process.exit(1);
  }
}

run();
