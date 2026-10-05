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
import {
  ExternalSourceRuntimeService,
  flattenExternalContent,
  type ExternalSourceStorePort,
} from "@/src/application/services/ExternalSourceRuntimeService";
import type { ExternalCapabilitySource } from "@/src/domain/externalSources/contracts";
import {
  __externalSourceStorageTest,
  deleteExternalSource,
  getExternalSource,
  listExternalSources,
  setExternalSourceEnabled,
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
  return mcp;
}

beforeAll(async () => {
  httpServer = createServer(toNodeHandler(createMcpHandler(() => createFixtureServer())));
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

async function createRuntimeFixture(sources: readonly ExternalCapabilitySource[]) {
  const store = createMemoryStore(sources);
  const agentRuntime = new AgentRuntimeService(journal);
  const kernel = { getService: () => agentRuntime, hasService: () => true } as unknown as IKernel;
  await agentRuntime.init(kernel);
  const service = new ExternalSourceRuntimeService({
    store,
    loadDriver: async () => createMcpConnectorDriver(),
  });
  await service.init(kernel);
  return { store, agentRuntime, service };
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
});

describe("外部能力源运行时（真实 Agent Runtime + 本地 MCP 夹具）", () => {
  it("把 tools/call 投影为 AgentToolDefinition，默认 ask，并扩展组合快照", async () => {
    const { agentRuntime, service } = await createRuntimeFixture([source()]);
    try {
      const tools = agentRuntime.listTools().filter((tool) => tool.name.startsWith("mcp.fixture."));
      expect(tools.map((tool) => tool.name).sort()).toEqual(["mcp.fixture.add", "mcp.fixture.echo"]);
      for (const tool of tools) {
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
      expect(composed.contributionOrder.tool).toHaveLength(2);
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
      ).toHaveLength(2);
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
});
