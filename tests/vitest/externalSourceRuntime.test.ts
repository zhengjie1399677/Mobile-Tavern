// @vitest-environment node
/**
 * M1 回归：外部能力源配置存储 + 运行时投影（tools/call → AgentToolDefinition）。
 *
 * 使用真实 AgentRuntimeService 与真实本地 MCP 夹具，验证注册、审批默认值、
 * 组合快照扩展、执行链路与撤销语义；存储用 fake-indexeddb 走真实 IDB 协议。
 */
import "fake-indexeddb/auto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { IKernel } from "@/src/kernel/types";
import { AgentRuntimeService } from "@/src/application/services/AgentRuntimeService";
import { ComposerCommandService } from "@/src/application/services/ComposerCommandService";
import {
  ExternalSourceRuntimeService,
  flattenExternalContent,
  type ExternalSourceStorePort,
} from "@/src/application/services/ExternalSourceRuntimeService";
import type { ExternalCapabilitySource } from "@/src/domain/externalSources/contracts";
import { KernelServices } from "@/src/application/serviceContracts";
import {
  buildExternalSourceAuthHeaders,
  externalSourceCredentialKey,
} from "@/src/domain/externalSources/contracts";
import {
  __externalSourceStorageTest,
  deleteExternalSourceCredential,
  deleteExternalSource,
  getExternalSource,
  getExternalSourceCredentialStatus,
  listExternalSources,
  resolveExternalSourceCredential,
  setExternalSourceEnabled,
  setExternalSourceCredential,
  upsertExternalSource,
} from "@/src/infrastructure/externalSources/externalSourceStorage";
import { createMcpConnectorDriver } from "@/src/infrastructure/externalSources/mcp/mcpConnectorDriver";

const journal = {
  append: async () => undefined,
  appendMany: async () => undefined,
  listBySession: async () => [],
  replace: async () => undefined,
  deleteBySession: async () => undefined,
};

let httpServer: Server;
let endpoint = "";
const receivedAuthorization: Array<string | undefined> = [];

function createFixtureServer(): McpServer {
  const mcp = new McpServer({ name: "runtime-fixture", version: "2.0.0" });
  mcp.registerTool(
    "echo",
    { description: "回显", inputSchema: z.object({ text: z.string() }) },
    async (args) => ({ content: [{ type: "text", text: args.text }] }),
  );
  mcp.registerTool(
    "add",
    { description: "求和", inputSchema: z.object({ a: z.number(), b: z.number() }) },
    async (args) => ({ content: [{ type: "text", text: String(args.a + args.b) }] }),
  );
  mcp.registerResource(
    "readme",
    "file:///readme.txt",
    { title: "README", mimeType: "text/plain" },
    async (uri) => ({ contents: [{ uri: uri.href, text: "远端资料正文" }] }),
  );
  mcp.registerPrompt(
    "greet",
    { description: "打招呼模板", argsSchema: z.object({ name: z.string() }) },
    (args) => ({ messages: [{ role: "user", content: { type: "text", text: `你好，${args.name}` } }] }),
  );
  return mcp;
}

beforeAll(async () => {
  const nodeHandler = toNodeHandler(createMcpHandler(() => createFixtureServer()));
  httpServer = createServer((request, response) => {
    receivedAuthorization.push(request.headers.authorization as string | undefined);
    nodeHandler(request, response);
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/mcp`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

function source(overrides: Partial<ExternalCapabilitySource> = {}): ExternalCapabilitySource {
  return {
    schemaVersion: 1,
    id: "fixture",
    kind: "mcp",
    displayName: "运行时夹具",
    endpoint,
    transport: "streamable-http",
    era: "auto",
    enabled: true,
    ...overrides,
  };
}

interface MemoryStore extends ExternalSourceStorePort {
  setEnabled(id: string, enabled: boolean): void;
}

function createMemoryStore(sources: readonly ExternalCapabilitySource[]): MemoryStore {
  const map = new Map(sources.map((item) => [item.id, item]));
  return {
    list: async () => [...map.values()],
    get: async (id) => map.get(id) ?? null,
    setEnabled: (id, enabled) => {
      const current = map.get(id);
      if (current) map.set(id, { ...current, enabled });
    },
  };
}

async function createRuntimeFixture(
  sources: readonly ExternalCapabilitySource[],
  resolveAuthHeaders?: (
    source: ExternalCapabilitySource,
  ) => Promise<Readonly<Record<string, string>> | undefined>,
) {
  const store = createMemoryStore(sources);
  const agentRuntime = new AgentRuntimeService(journal);
  const composer = new ComposerCommandService();
  const kernel = {
    getService: (name: string) =>
      (name === KernelServices.ComposerCommands ? composer : agentRuntime),
    hasService: () => true,
  } as unknown as IKernel;
  await agentRuntime.init(kernel);
  composer.init(kernel);
  const service = new ExternalSourceRuntimeService({
    store,
    loadDriver: async () => createMcpConnectorDriver(),
    ...(resolveAuthHeaders ? { resolveAuthHeaders } : {}),
  });
  await service.init(kernel);
  return { store, agentRuntime, composer, service };
}

const toolContext = () => ({
  sessionId: "session",
  turnId: "turn",
  callId: "call",
  signal: new AbortController().signal,
});

describe("外部能力源配置存储", () => {
  beforeEach(async () => {
    await __externalSourceStorageTest.reset();
  });

  it("保存、读取、启停与删除走独立 IndexedDB", async () => {
    const saved = await upsertExternalSource(source());
    expect(saved.createdAt).toBeGreaterThan(0);
    expect(await listExternalSources()).toHaveLength(1);

    await setExternalSourceEnabled("fixture", false);
    expect((await getExternalSource("fixture"))?.enabled).toBe(false);

    await deleteExternalSource("fixture");
    expect(await listExternalSources()).toHaveLength(0);
  });

  it("非法配置在落库前被 Schema 拒绝", async () => {
    await expect(upsertExternalSource({ ...source(), endpoint: "not-a-url" })).rejects.toThrow();
    await expect(upsertExternalSource({ ...source(), id: "Bad Id" })).rejects.toThrow();
    await expect(upsertExternalSource({ ...source(), kind: "MCP" })).rejects.toThrow();
  });

  it("凭据加密落盘：状态可查、明文不可读、可删除", async () => {
    await setExternalSourceCredential("fixture", "sk-plain-secret-value");
    const status = await getExternalSourceCredentialStatus("fixture");
    expect(status).toMatchObject({ key: "fixture", configured: true });
    expect(JSON.stringify(status)).not.toContain("sk-plain-secret-value");

    const raw = await __externalSourceStorageTest.dumpCredentials();
    expect(JSON.stringify(raw)).not.toContain("sk-plain-secret-value");
    expect(await resolveExternalSourceCredential("fixture")).toBe("sk-plain-secret-value");

    await deleteExternalSourceCredential("fixture");
    expect((await getExternalSourceCredentialStatus("fixture")).configured).toBe(false);
    await expect(setExternalSourceCredential("fixture", "   ")).rejects.toThrow(
      /EXTERNAL_SOURCE_CREDENTIAL_EMPTY/,
    );
  });

  it("默认存储的 IndexedDB 记录（带 createdAt/updatedAt）可以直接重连而不触发 unrecognized_keys", async () => {
    // 红检背景：记录里带 createdAt/updatedAt，而 externalCapabilitySourceSchema 是 .strict()。
    // 早期 defaultStore 直接把存储记录透传给运行时，导致"导入/探测 MCP 后"报
    // `Unrecognized keys: "createdAt", "updatedAt"`（与 API Key 无关）。
    const saved = await upsertExternalSource(source());
    expect(saved.createdAt).toBeGreaterThan(0);

    const agentRuntime = new AgentRuntimeService(journal);
    const composer = new ComposerCommandService();
    const kernel = {
      getService: (name: string) =>
        (name === KernelServices.ComposerCommands ? composer : agentRuntime),
      hasService: () => true,
    } as unknown as IKernel;
    await agentRuntime.init(kernel);
    composer.init(kernel);

    // 刻意不注入 store：走生产同款 defaultStore()，必须自己剥掉存储元数据
    const service = new ExternalSourceRuntimeService({
      loadDriver: async () => createMcpConnectorDriver(),
    });
    await service.init(kernel);
    try {
      const diagnostics = service.getDiagnostics();
      expect(diagnostics.failures).toEqual({});
      expect(diagnostics.connectedSources).toContain("fixture");
    } finally {
      await service.destroy();
      await agentRuntime.destroy();
      await __externalSourceStorageTest.reset();
    }
  });
});

describe("静态凭据到请求头的映射", () => {
  it("默认 bearer、可自定义头名、无秘密时不注入", () => {
    expect(buildExternalSourceAuthHeaders({}, "sk-1")).toEqual({
      Authorization: "Bearer sk-1",
    });
    expect(
      buildExternalSourceAuthHeaders({ authHeader: "X-API-Key", authScheme: "raw" }, "sk-2"),
    ).toEqual({ "X-API-Key": "sk-2" });
    expect(buildExternalSourceAuthHeaders({}, null)).toBeUndefined();
  });

  it("凭据键优先 authRef，缺省用来源 id", () => {
    expect(externalSourceCredentialKey({ id: "a" })).toBe("a");
    expect(externalSourceCredentialKey({ id: "a", authRef: "team-token" })).toBe("team-token");
  });
});

describe("外部能力源运行时（真实 Agent Runtime + 本地 MCP 夹具）", () => {
  it("静态凭据注入到真实请求头，未配置时不发送", async () => {
    receivedAuthorization.length = 0;
    const withCredential = await createRuntimeFixture([source()], async () => ({
      Authorization: "Bearer test-secret",
    }));
    await withCredential.service.destroy();
    await withCredential.agentRuntime.destroy();
    expect(receivedAuthorization).toContain("Bearer test-secret");

    receivedAuthorization.length = 0;
    const withoutCredential = await createRuntimeFixture([source()], async () => undefined);
    await withoutCredential.service.destroy();
    await withoutCredential.agentRuntime.destroy();
    expect(receivedAuthorization.every((value) => value === undefined)).toBe(true);
  });

  it("把 tools/call 投影为 AgentToolDefinition，默认 ask，并扩展组合快照", async () => {
    const { agentRuntime, service } = await createRuntimeFixture([source()]);
    try {
      const tools = agentRuntime.listTools().filter((tool) => tool.name.startsWith("mcp.fixture."));
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "mcp.fixture.add",
        "mcp.fixture.echo",
        "mcp.fixture.resources.list",
        "mcp.fixture.resources.read",
      ]);
      for (const tool of tools.filter((item) => !item.name.includes(".resources."))) {
        expect(tool.policy).toBe("ask");
        expect(tool.sideEffect).toBe("external");
        expect(tool.permissions).toEqual(["external.source.fixture"]);
      }

      const composed = service.extendComposition({
        profileId: "mobile-tavern.base",
        profileVersion: 1,
        pluginVersions: {},
        providerBindings: {},
        contributionOrder: { tool: [] },
        capabilityDecisions: {},
      });
      expect(composed.pluginVersions).toEqual({ "external-source/fixture": "2.0.0" });
      expect(composed.contributionOrder.tool).toHaveLength(4);
      expect(composed.contributionOrder.tool).toEqual(
        expect.arrayContaining(["mcp.fixture.add", "mcp.fixture.echo"]),
      );

      expect(service.getDiagnostics()).toMatchObject({
        connectedSources: ["fixture"],
        failures: {},
      });
    } finally {
      await service.destroy();
      await agentRuntime.destroy();
    }
  });

  it("执行走外部连接并压平内容，撤销后立即失败", async () => {
    const { store, agentRuntime, service } = await createRuntimeFixture([source()]);
    try {
      const echo = agentRuntime.listTools().find((tool) => tool.name === "mcp.fixture.echo");
      const add = agentRuntime.listTools().find((tool) => tool.name === "mcp.fixture.add");
      expect(echo).toBeDefined();

      await expect(echo!.execute({ text: "你好" }, toolContext())).resolves.toMatchObject({
        isError: false,
        text: "你好",
      });
      await expect(add!.execute({ a: 2, b: 40 }, toolContext())).resolves.toMatchObject({
        text: "42",
      });

      store.setEnabled("fixture", false);
      await expect(echo!.execute({ text: "撤销后" }, toolContext())).rejects.toThrow(
        /EXTERNAL_SOURCE_REVOKED/,
      );
    } finally {
      await service.destroy();
      await agentRuntime.destroy();
    }
  });

  it("单个来源不可用时只记录失败，不影响其它来源", async () => {
    const broken = source({ id: "broken", displayName: "不可用来源", endpoint: "http://127.0.0.1:1/mcp" });
    const { agentRuntime, service } = await createRuntimeFixture([source(), broken]);
    try {
      expect(service.getDiagnostics().connectedSources).toEqual(["fixture"]);
      expect(Object.keys(service.getDiagnostics().failures)).toEqual(["broken"]);
      expect(
        agentRuntime.listTools().filter((tool) => tool.name.startsWith("mcp.fixture.")),
      ).toHaveLength(4);
    } finally {
      await service.destroy();
      await agentRuntime.destroy();
    }
  });

  it("内容块压平只保留文本与类型占位", () => {
    expect(
      flattenExternalContent([
        { type: "text", text: "第一段" },
        { type: "text", text: "第二段" },
        { type: "image", data: "…" },
      ]),
    ).toBe("第一段\n第二段\n[image]");
    expect(flattenExternalContent([null, 42, {}])).toBe("");
  });

  it("远端资源暴露为只读工具，且只允许读取已声明 URI", async () => {
    const { agentRuntime, service } = await createRuntimeFixture([source()]);
    try {
      const list = agentRuntime.listTools().find((tool) => tool.name === "mcp.fixture.resources.list");
      const read = agentRuntime.listTools().find((tool) => tool.name === "mcp.fixture.resources.read");
      expect(list?.policy).toBe("allow");
      expect(list?.sideEffect).toBe("none");
      expect(read?.policy).toBe("ask");

      const listed = (await list!.execute({}, toolContext())) as {
        resources: Array<{ uri: string; name: string }>;
      };
      expect(listed.resources.map((item) => item.uri)).toContain("file:///readme.txt");

      await expect(read!.execute({ uri: "file:///readme.txt" }, toolContext())).resolves.toMatchObject({
        uri: "file:///readme.txt",
        text: "远端资料正文",
      });
      // 白名单收口：模型不能借宿主去抓任意 URI。
      await expect(read!.execute({ uri: "file:///etc/passwd" }, toolContext())).rejects.toThrow(
        /EXTERNAL_SOURCE_RESOURCE_NOT_ADVERTISED/,
      );
    } finally {
      await service.destroy();
      await agentRuntime.destroy();
    }
  });

  it("来源提示词注册为输入框命令，执行只回填草稿且撤销即失效", async () => {
    const { store, agentRuntime, composer, service } = await createRuntimeFixture([source()]);
    try {
      const greet = composer
        .list("mobile-tavern.base")
        .find((command) => command.owner === "external-source/fixture");
      expect(greet).toMatchObject({
        name: "mcp.fixture.greet",
        label: "greet",
        acceptsArgument: true,
      });

      const request = { profileId: "mobile-tavern.base", sessionId: "session", argument: "世界" };
      await expect(composer.execute("mcp.fixture.greet", request)).resolves.toBe("你好，世界");

      store.setEnabled("fixture", false);
      await expect(composer.execute("mcp.fixture.greet", request)).rejects.toThrow(
        /EXTERNAL_SOURCE_REVOKED/,
      );
    } finally {
      await service.destroy();
      await agentRuntime.destroy();
    }
  });
});
