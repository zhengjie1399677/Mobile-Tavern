/**
 * 内核服务测试套件
 *
 * 覆盖：
 *  - testMultiMessageService：MultiMessageService 用户消息入队与会话持久化
 *  - testScriptServiceDecoupling：ScriptService 桥接注入与降级
 *  - testOutputPipeline：output 管道中间件编排（表格记忆/MVU/野牛/总结）
 *  - testChatStreamService：ChatStreamService SSE 流式分片解析
 *  - testKeyManagerDynamicFetch：KeyManager 动态获取 token 与 AES-GCM 解密
 *  - testUpdateCheckService：UpdateCheckService 版本检测与字段白名单
 */

import { Kernel } from "../../src/kernel/Kernel";
import { IKernelService } from "../../src/kernel/types";
import { MultiMessageService } from "../../src/kernel/services/MultiMessageService";
import { ChatStreamService } from "../../src/kernel/services/ChatStreamService";
import {
  tableMemoryMiddleware,
  mvuScriptMiddleware,
  bisonModeMiddleware,
  autoSummaryMiddleware
} from "../../src/kernel/middlewares/outputMiddlewares";
import { assert } from "./testUtils";

export async function testMultiMessageService() {
  console.log("\n--- Running MultiMessageService Verification ---");
  const testKernel = new Kernel();

  let savedSession: any = null;
  const mockDbService: IKernelService = {
    name: "database",
    init() { },
    async saveSession(session: any) {
      savedSession = session;
    },
    async appendSessionMessage() { },
  };

  const multiMsgService = new MultiMessageService();

  await testKernel.registerService("database", mockDbService);
  await testKernel.registerService("multiMessage", multiMsgService);

  const initialSession = {
    id: "test-sess",
    characterId: "char-1",
    title: "Test Session",
    createdAt: Date.now(),
    messages: [
      { id: "msg_1", sender: "assistant", content: "Hello!" }
    ],
    summaries: [],
    variables: {}
  };

  const updated = await multiMsgService.queueUserMessage(initialSession as any, "  Hello, this is message 1.  ");

  assert(updated.messages.length === 2, "Should append user message");
  assert(updated.messages[1].sender === "user", "Sender should be user");
  assert(updated.messages[1].content === "Hello, this is message 1.", "Content should be trimmed");
  assert(savedSession !== null, "Session should be saved to database service");
  assert(savedSession.id === "test-sess", "Saved session ID matches");
  assert(savedSession.messages[1].content === "Hello, this is message 1.", "Saved session has the user message");

  await testKernel.destroy();
  console.log("✔ MultiMessageService verified successfully!");
}

export async function testScriptServiceDecoupling() {
  console.log("\n--- Running ScriptService Decoupling Verification ---");
  const { ScriptService } = await import("../../src/kernel/services/ScriptService");
  const testKernel = new Kernel();
  const scriptService = new ScriptService();
  await testKernel.registerService("script", scriptService);

  // 1. 验证在没有注入 bridge 的情况下，方法能安全降级（不崩溃）
  const result1 = await scriptService.executeMvuScript({ id: "sess-1", variables: { stat_data: { hp: 50 } } } as any, "test");
  assert(result1.variables.stat_data.hp === 50, "Should safely return session without mutating variables");

  const result2 = scriptService.initializeMvuFromCharacter({ name: "银霜" } as any);
  assert(typeof result2 === "object" && result2 !== null, "Should return empty object");

  // 2. 注入 mock bridge 验证功能正常触发
  const mockBridge = {
    executeMvuScript: async (session: any, content: string) => {
      return { ...session, variables: { stat_data: { hp: 100 } } };
    },
    parseMvuMessage: (messageContent: string, currentVariables: any) => {
      return { stat_data: { hp: 100 } };
    },
    initializeMvuFromCharacter: (char: any) => {
      return { stat_data: { hp: 99 } };
    },
    notifyVariablesUpdated: (session: any) => { }
  };

  scriptService.registerBridge(mockBridge);

  const result3 = await scriptService.executeMvuScript({ id: "sess-1", variables: { stat_data: { hp: 50 } } } as any, "test");
  assert(result3.variables.stat_data.hp === 100, "Should use injected bridge logic to modify variables");

  const result4 = scriptService.initializeMvuFromCharacter({ name: "银霜" } as any);
  assert(result4.stat_data.hp === 99, "Should use injected bridge logic to initialize variables");

  await testKernel.destroy();
  console.log("✔ ScriptService Decoupling verified successfully!");
}

export async function testOutputPipeline() {
  console.log("\n--- Running Output Pipeline Verification ---");
  const testKernel = new Kernel();

  const mockDbService: IKernelService = {
    name: "database",
    init() { },
    async saveSession() { }
  };
  // 阶段 C 迁移：中间件已切换到 KernelServices.Memory.getStateTable() / getSummary() 子模块
  // 旧 tableMemory / autoSummary 服务已从注册表移除并标记 @deprecated
  const mockStateTable = {
    initDefaultSheets(_charName: string) {
      return [];
    },
    processTableMemory(_mem: any, content: string) {
      return {
        updatedMemory: [{ id: "sheet_status_and_relation", rows: [["char", "100"]] }],
        cleanContent: content.replace(/\nupdateRow\s*\([^)]*\)/gi, "").replace(/\n_.set\s*\([^)]*\)/gi, "").trim(),
        hasChanges: true
      };
    }
  };
  const mockSummary = {
    async checkAndSummarize(session: any) {
      return { ...session, summaries: [{ id: "sum_auto", content: "自动整理" }] };
    }
  };
  const mockMemoryService: IKernelService = {
    name: "memory",
    init() { },
    getStateTable() { return mockStateTable; },
    getSummary() { return mockSummary; }
  };
  const mockScriptService: IKernelService = {
    name: "script",
    init() { },
    async executeMvuScript(session: any, content: string) {
      return { ...session, variables: { ...session.variables, scriptRan: true } };
    }
  };

  await testKernel.registerService("database", mockDbService);
  await testKernel.registerService("memory", mockMemoryService);
  await testKernel.registerService("script", mockScriptService);

  const outputPipeline = testKernel.registerPipeline("output");
  outputPipeline.use(tableMemoryMiddleware, 100);
  outputPipeline.use(mvuScriptMiddleware, 90);
  outputPipeline.use(bisonModeMiddleware, 80);
  outputPipeline.use(autoSummaryMiddleware, 70);

  const initialSession = {
    id: "sess_1",
    characterId: "char_1",
    title: "Session 1",
    createdAt: Date.now(),
    messages: [{ id: "msg_ai_1", sender: "assistant" as const, content: '你好\nupdateRow("好感关系表", {"好感度": "100"})\n_.set("scriptRan", true)', timestamp: Date.now() }],
    summaries: [],
    variables: {},
    tableMemory: []
  };

  const outputCtx: any = {
    kernel: testKernel,
    session: initialSession,
    responseText: '你好\nupdateRow("好感关系表", {"好感度": "100"})\n_.set("scriptRan", true)',
    reasoningText: "",
    settings: { enableTableMemory: true, enableScriptExecution: true, enableBisonMode: false },
    activeCharacter: { name: "银霜", personality: "傲娇" },
    controller: new AbortController(),
    isStillActive: true,
    isBisonConsecutive: false,
    bisonRemainingCount: 0
  };

  await outputPipeline.execute(outputCtx);

  const result = outputCtx.resultSession;
  assert(result !== undefined, "Output resultSession must be populated");
  assert(result.tableMemory[0].rows[0][1] === "100", "Table memory updated by TableMemoryMiddleware");
  assert(result.messages[0].content === "你好", "Message content cleaned by TableMemoryMiddleware");
  assert(result.variables.scriptRan === true, "MVU variables updated by MvuScriptMiddleware");
  assert(result.summaries.length === 1 && result.summaries[0].id === "sum_auto", "AutoSummary ran successfully");

  await testKernel.destroy();
  console.log("✔ Output Pipeline Middlewares verified successfully!");
}

export async function testChatStreamService() {
  console.log("\n--- Running ChatStreamService Verification ---");
  const testKernel = new Kernel();

  const mockLlmService: IKernelService = {
    name: "llm",
    init() { },
    async universalFetch() {
      const sseContent =
        `data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n` +
        `data: {"choices":[{"delta":{"reasoning_content":"Thinking"}}]}\n\n` +
        `data: [DONE]\n\n`;

      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseContent));
          controller.close();
        }
      }));
    }
  };

  const chatStream = new ChatStreamService();

  await testKernel.registerService("llm", mockLlmService);
  await testKernel.registerService("chatStream", chatStream);

  const generator = chatStream.streamLlmResponse({
    baseUrl: "http://mock",
    apiKey: "mock",
    reqBody: {}
  });

  const chunks: any[] = [];
  for await (const chunk of generator) {
    chunks.push(chunk);
  }

  assert(chunks.length >= 2, "Should receive SSE chunks");
  assert(chunks[0].choices[0].delta.content === "Hello", "Content chunk parsed");
  assert(chunks[1].choices[0].delta.reasoning_content === "Thinking", "Reasoning content chunk parsed");

  await testKernel.destroy();
  console.log("✔ ChatStreamService verified successfully!");
}

export async function testKeyManagerDynamicFetch() {
  console.log("\n--- Running KeyManager Dynamic Fetch & Decryption Verification ---");
  const { getValidToken, getTrialKey, decryptAesGcm } = await import("../../src/utils/keyManager");

  const aesKeyHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const originalText = "sk-or-v1-my-mock-openrouter-key-987654";

  const cryptoNode = await import("crypto");
  const iv = cryptoNode.randomBytes(12);
  const cipher = cryptoNode.createCipheriv("aes-256-gcm", Buffer.from(aesKeyHex, "hex"), iv);
  let ciphertext = cipher.update(originalText, "utf8", "hex");
  ciphertext += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");

  const decrypted = await decryptAesGcm(ciphertext, aesKeyHex, iv.toString("hex"), tag);
  assert(decrypted === originalText, "Web Crypto GCM Decryption matches original plaintext");

  const originalFetch = global.fetch;

  let issueTokenCalled = false;
  let getKeyCalled = false;

  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === "string" ? input : input.toString();

    if (urlStr.includes("/api/issue-token")) {
      issueTokenCalled = true;
      const payload = {
        deviceId: "test_dev_123",
        exp: Math.floor(Date.now() / 1000) + 1800
      };
      const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const signature = cryptoNode
        .createHmac("sha256", "default_local_hmac_sign_key_123456")
        .update(payloadStr)
        .digest("base64url");
      return new Response(JSON.stringify({
        token: `${payloadStr}.${signature}`,
        expiresAt: payload.exp * 1000
      }));
    }

    if (urlStr.includes("/api/get-key")) {
      getKeyCalled = true;
      const auth = init?.headers ? (init.headers as any)["Authorization"] : "";
      assert(auth && auth.startsWith("Bearer "), "Should carry Authorization Bearer Token");

      return new Response(JSON.stringify({
        ciphertext,
        iv: iv.toString("hex"),
        tag
      }));
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }) as any;

  try {
    const token = await getValidToken();
    assert(token.includes("."), "Token must contain payload and signature separator '.'");
    assert(issueTokenCalled === true, "issue-token api was invoked");

    const trialKey = await getTrialKey();
    assert(trialKey === originalText, "getTrialKey decrypted key correctly");
    assert(getKeyCalled === true, "get-key api was invoked");
  } finally {
    global.fetch = originalFetch;
  }

  console.log("✔ KeyManager Dynamic Fetch & Decryption verified successfully!");
}

export async function testUpdateCheckService() {
  console.log("\n--- Running UpdateCheckService & OSS Signer Verification ---");
  const { Kernel } = await import("../../src/kernel/Kernel");
  const { UpdateCheckService } = await import("../../src/kernel/services/UpdateCheckService");

  const testKernel = new Kernel();
  const updateService = new UpdateCheckService();
  await testKernel.registerService("updateCheck", updateService);

  const originalFetch = global.fetch;
  let fetchParams: any = null;

  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === "string" ? input : input.toString();
    fetchParams = {
      url: urlStr,
      body: JSON.parse(init?.body as string || "{}")
    };

    return new Response(JSON.stringify({
      success: true,
      data: {
        latestVersion: "1.6.0",
        downloadUrl: "https://mobile-backup-001.oss-cn-hangzhou.aliyuncs.com/updates/app-release-v1.6.0.apk?Signature=mock"
      }
    }));
  }) as any;

  try {
    const res = await updateService.checkUpdate("1.6.0");
    assert(res.hasUpdate === true, "Should detect update correctly");
    assert(res.latestVersion === "1.6.0", "Latest version should be set correctly");
    assert(res.downloadUrl === "https://mobile-backup-001.oss-cn-hangzhou.aliyuncs.com/updates/app-release-v1.6.0.apk?Signature=mock", "Download URL matches mock response");
    assert(fetchParams.body.clientVersion === "1.6.0", "Client version should be sent to the API");
    assert(fetchParams.body.userCredential !== undefined, "User credential should be uploaded");
    assert(fetchParams.body.timestamp !== undefined, "Timestamp should be uploaded");
    // 安全验证：客户端不应再上传签名相关字段（密钥已移除，签名验证机制已废弃）
    assert(fetchParams.body.encryptedAlgorithm === undefined, "encryptedAlgorithm field must NOT be uploaded (security fix: client no longer holds HMAC secret)");
    assert(fetchParams.body.signature === undefined, "signature field must NOT be uploaded (client does not participate in signing)");
  } finally {
    global.fetch = originalFetch;
    await testKernel.destroy();
  }

  console.log("✔ UpdateCheckService verified successfully!");
}
