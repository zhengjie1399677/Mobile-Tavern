import { isPrivateIp, validateBaseUrlSecurity } from "../src/utils/security";
import { replaceMacros, getTriggeredLorebookEntries } from "../src/utils/promptBuilder";
import { injectPngMetadata } from "../src/utils/cardParser";
import { CharacterCard, LorebookEntry, Message } from "../src/types";
import { unzlibSync, inflateSync } from "fflate";
import { runCatbotErrorTests } from "./test_catbot_error_handling";
import { cleanRequestPayload } from "../src/utils/apiClient";
import { readSSEStream, safeParseSSEData } from "../src/utils/streamReader";

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

async function run() {
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
