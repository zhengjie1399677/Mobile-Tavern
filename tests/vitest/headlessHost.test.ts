import "fake-indexeddb/auto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { parseHeadlessConfig } from "../../headless/config";
import { bootstrapHeadlessHost, type HeadlessHostInstance } from "../../headless/bootstrap";
import { startHeadlessServer, type HeadlessServerHandle } from "../../headless/server";
import { KernelServices } from "../../src/application/serviceContracts";
import type { CharacterCard } from "../../src/types";

describe("Headless Host & API Gateway Integration Tests", () => {
  const TEST_PORT = 19123;
  const TEST_HOST = "127.0.0.1";
  const TEST_API_KEY = "test_headless_token_abcdef123456";
  const tempDir = path.join(process.cwd(), "tests", `temp_headless_${Date.now()}`);

  let hostInstance: HeadlessHostInstance;
  let serverHandle: HeadlessServerHandle;

  interface TestResponse<T = unknown> {
    status: number;
    json(): Promise<T>;
    text(): Promise<string>;
  }

  function request<T = unknown>(
    urlPath: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
    } = {},
  ): Promise<TestResponse<T>> {
    return new Promise((resolve, reject) => {
      const payload = options.body ? JSON.stringify(options.body) : undefined;
      const headers: Record<string, string> = {
        ...(payload ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      };
      if (payload) {
        headers["Content-Length"] = Buffer.byteLength(payload).toString();
      }

      const req = http.request(
        {
          hostname: TEST_HOST,
          port: TEST_PORT,
          path: urlPath,
          method: options.method || "GET",
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          res.on("end", () => {
            const bodyStr = Buffer.concat(chunks).toString("utf8");
            resolve({
              status: res.statusCode || 0,
              text: async () => bodyStr,
              json: async () => (bodyStr ? (JSON.parse(bodyStr) as T) : ({} as T)),
            });
          });
        },
      );
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  beforeAll(async () => {
    const config = parseHeadlessConfig({
      HEADLESS_PORT: TEST_PORT,
      HEADLESS_HOST: TEST_HOST,
      HEADLESS_DATA_DIR: tempDir,
      HEADLESS_API_KEY: TEST_API_KEY,
    });

    hostInstance = await bootstrapHeadlessHost(config);
    serverHandle = await startHeadlessServer(hostInstance);
  });

  afterAll(async () => {
    if (serverHandle) {
      await serverHandle.close();
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should successfully initialize Kernel and mount core services in Headless mode", () => {
    const kernel = hostInstance.kernel;
    expect(kernel).toBeDefined();
    expect(kernel.hasService(KernelServices.Database)).toBe(true);
    expect(kernel.hasService(KernelServices.Character)).toBe(true);
    expect(kernel.hasService(KernelServices.Prompt)).toBe(true);
    expect(kernel.hasService(KernelServices.LLM)).toBe(true);
    expect(kernel.hasService(KernelServices.AgentRuntime)).toBe(true);
    expect(kernel.hasService(KernelServices.DataMigration)).toBe(true);
  });

  it("should respond to /health without requiring an API key", async () => {
    const res = await request<{ status: string; mode: string }>("/health");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.mode).toBe("headless");
  });

  it("should reject requests without authorization token when HEADLESS_API_KEY is configured", async () => {
    const res = await request<{ error: { code: number } }>("/api/host/status");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe(401);
  });

  it("should allow authorized requests with Bearer token", async () => {
    const res = await request<{
      status: string;
      mode: string;
      charactersCount: number;
      sessionsCount: number;
    }>("/api/host/status", {
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.mode).toBe("headless");
    expect(typeof body.charactersCount).toBe("number");
    expect(typeof body.sessionsCount).toBe("number");
  });

  it("should list models via OpenAI compatible /v1/models endpoint", async () => {
    const res = await request<{ object: string; data: Array<{ id: string }> }>("/v1/models", {
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("list");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((m) => m.id === "mobile-tavern-default")).toBe(true);
  });

  it("should validate chat completion requests on /v1/chat/completions", async () => {
    const res = await request<{ error: { code: number; type: string } }>("/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
      body: {
        model: "mobile-tavern-default",
        messages: [],
      },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(400);
    expect(body.error.type).toBe("invalid_request_error");
  });

  it("should save and retrieve a character card through the Native Host protocol", async () => {
    const testCharacter: CharacterCard = {
      id: "char_headless_test_01",
      name: "测试助手小灵",
      description: "运行于无头模式下的测试助手",
      personality: "冷静、聪明且乐于助人",
      first_mes: "你好！我是无头模式下运行的小灵，很高兴为您服务。",
      mes_example: "",
      scenario: "测试环境",
      creator: "Mobile-Tavern-Headless",
      character_version: "1.0.0",
      tags: ["test", "headless"],
    };

    // 1. 保存角色
    const postRes = await request<{ success: boolean; characterId: string }>("/api/host/characters", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
      body: testCharacter,
    });
    expect(postRes.status).toBe(200);
    const postResult = await postRes.json();
    expect(postResult.success).toBe(true);
    expect(postResult.characterId).toBe("char_headless_test_01");

    // 2. 查验角色出现在列表中
    const listRes = await request<{ characters: Array<{ id: string; name: string }> }>("/api/host/characters", {
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
    });
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    const found = listBody.characters.find((c) => c.id === "char_headless_test_01");
    expect(found).toBeDefined();
    expect(found?.name).toBe("测试助手小灵");

    // 3. 查验该角色已被同步映射到 /v1/models 中
    const modelsRes = await request<{ data: Array<{ id: string }> }>("/v1/models", {
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
    });
    const modelsBody = await modelsRes.json();
    expect(modelsBody.data.some((m) => m.id === "测试助手小灵")).toBe(true);
  });

  it("should create sessions via Native Host protocol", async () => {
    const res = await request<{
      success: boolean;
      session: { characterId: string; title: string };
    }>("/api/host/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
      body: {
        characterId: "char_headless_test_01",
        title: "无头模式自动会话",
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.session.characterId).toBe("char_headless_test_01");
    expect(body.session.title).toBe("无头模式自动会话");
  });

  it("should export full backup and persist snapshot to disk", async () => {
    // 1. 测试导出备份
    const exportRes = await request<{
      version: number;
      magic: string;
      characters: Array<{ id: string }>;
    }>("/api/host/backup/export", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
    });
    expect(exportRes.status).toBe(200);
    const backupJson = await exportRes.json();
    expect(backupJson.version).toBe(6);
    expect(backupJson.magic).toBe("MOBILE_TAVERN_UNIFIED_BACKUP");
    expect(Array.isArray(backupJson.characters)).toBe(true);
    expect(backupJson.characters.some((c) => c.id === "char_headless_test_01")).toBe(true);

    // 2. 测试保存持久化快照到磁盘
    const snapshotPath = await hostInstance.saveSnapshot();
    expect(fs.existsSync(snapshotPath)).toBe(true);
    const snapshotContent = fs.readFileSync(snapshotPath, "utf8");
    expect(snapshotContent).toContain("char_headless_test_01");
  });
});
