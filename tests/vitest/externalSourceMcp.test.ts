// @vitest-environment node
/**
 * 外部能力通道 M0 回归。
 *
 * 使用官方 SDK 的 Node 传输在 127.0.0.1 起临时 MCP 服务作为本地夹具，
 * 不依赖任何外部网络或 CDN（`TEST-CONTROLLED`）。
 * 必须跑在 node 环境：happy-dom 的 fetch 会施加浏览器同源策略，
 * 而真实 WebView 走 Native Adapter / 原生 fetch，不受该限制。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  openExternalSource,
  type OpenedExternalSource,
} from "@/src/application/externalSources/externalSourceService";
import {
  createConnectorRegistry,
  type ConnectorRegistry,
} from "@/src/domain/externalSources/registry";
import {
  assessExternalJsonSchema,
  createExternalValueSchema,
  projectModelVisibleJsonSchema,
} from "@/src/domain/externalSources/schemaBounds";
import {
  MCP_SOURCE_KIND,
  MCP_STREAMABLE_HTTP_TRANSPORT,
  createMcpConnectorDriver,
} from "@/src/infrastructure/externalSources/mcp/mcpConnectorDriver";

let httpServer: Server;
let registry: ConnectorRegistry;
let endpoint = "";
const opened: OpenedExternalSource[] = [];

function createFixtureServer(): McpServer {
  const mcp = new McpServer({ name: "fixture-server", version: "1.2.3" });
  mcp.registerTool(
    "echo",
    {
      description: "回显输入文本",
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.object({ text: z.string() }),
    },
    async (args) => ({
      content: [{ type: "text", text: args.text }],
      structuredContent: { text: args.text },
    }),
  );
  mcp.registerTool(
    "add",
    {
      description: "两数求和",
      inputSchema: z.object({ a: z.number(), b: z.number() }),
    },
    async (args) => ({
      content: [{ type: "text", text: String(args.a + args.b) }],
    }),
  );
  mcp.registerPrompt(
    "greet",
    {
      description: "打招呼模板",
      argsSchema: z.object({ name: z.string() }),
    },
    () => ({ messages: [{ role: "user", content: { type: "text", text: "hello" } }] }),
  );
  return mcp;
}

beforeAll(async () => {
  // 现代入口按请求创建 server 实例并自行处理 era 判定；legacy 保持官方默认的 stateless 兼容。
  const handler = createMcpHandler(() => createFixtureServer());
  httpServer = createServer(toNodeHandler(handler));
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;
  endpoint = `http://127.0.0.1:${address.port}/mcp`;

  registry = createConnectorRegistry();
  registry.register(createMcpConnectorDriver());
});

afterAll(async () => {
  for (const handle of opened) await handle.dispose().catch(() => undefined);
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

function sourceInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "fixture",
    kind: MCP_SOURCE_KIND,
    displayName: "本地夹具",
    endpoint,
    transport: MCP_STREAMABLE_HTTP_TRANSPORT,
    era: "auto",
    enabled: true,
    ...overrides,
  };
}

async function openFixture(overrides: Record<string, unknown> = {}): Promise<OpenedExternalSource> {
  const handle = await openExternalSource(sourceInput(overrides), {
    registry,
    timeoutMs: 10_000,
    deps: { clientInfo: { name: "mobile-tavern-test", version: "0.0.0" } },
  });
  opened.push(handle);
  return handle;
}

describe("外部能力通道 M0（本地 MCP 夹具）", () => {
  it("连接夹具并投影中立能力快照", async () => {
    const handle = await openFixture();
    const { snapshot } = handle;

    expect(snapshot.sourceId).toBe("fixture");
    expect(snapshot.serverName).toBe("fixture-server");
    expect(snapshot.serverVersion).toBe("1.2.3");
    // 夹具走现代入口（createMcpHandler），因此必须协商到 2026-07-28 而不是回退 legacy。
    expect(snapshot.negotiatedProtocolVersion).toBe("2026-07-28");

    const toolNames = snapshot.tools.map((tool) => tool.qualifiedName);
    expect(toolNames).toContain("mcp.fixture.echo");
    expect(toolNames).toContain("mcp.fixture.add");
    const echo = snapshot.tools.find((tool) => tool.localName === "echo");
    expect(echo?.description).toBe("回显输入文本");
    expect(echo?.inputSchema).toMatchObject({ type: "object" });

    expect(snapshot.prompts.map((prompt) => prompt.name)).toContain("greet");
    expect(snapshot.resources).toHaveLength(0);
    expect(snapshot.warnings).toHaveLength(0);
  });

  it("调用外部工具并把结果收口为中立结构", async () => {
    const handle = await openFixture();
    const controller = new AbortController();
    const result = await handle.connected.callTool(
      "echo",
      { text: "你好" },
      { signal: controller.signal, timeoutMs: 10_000 },
    );

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({ text: "你好" });
    expect(result.content).toEqual([{ type: "text", text: "你好" }]);
  });

  it("未注册的 kind / transport 与未启用来源显式失败", async () => {
    await expect(openFixture({ kind: "unknown-kind" })).rejects.toThrow(
      /EXTERNAL_SOURCE_KIND_UNSUPPORTED/,
    );
    await expect(openFixture({ transport: "stdio" })).rejects.toThrow(
      /EXTERNAL_SOURCE_TRANSPORT_UNSUPPORTED/,
    );
    await expect(openFixture({ enabled: false })).rejects.toThrow(/EXTERNAL_SOURCE_DISABLED/);
    await expect(openFixture({ endpoint: "not-a-url" })).rejects.toThrow();
  });

  it("释放后连接关闭且 dispose 幂等", async () => {
    const handle = await openFixture();
    await handle.dispose();
    await handle.dispose();

    const controller = new AbortController();
    await expect(
      handle.connected.callTool(
        "echo",
        { text: "after-dispose" },
        { signal: controller.signal, timeoutMs: 5_000 },
      ),
    ).rejects.toThrow();
  });
});

describe("外部 JSON Schema 收口", () => {
  it("已登记子集判定为受支持", () => {
    const assessment = assessExternalJsonSchema({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { text: { type: "string", maxLength: 10 } },
      required: ["text"],
      additionalProperties: false,
    });
    expect(assessment.supported).toBe(true);
    expect(assessment.unsupportedKeywords).toHaveLength(0);
  });

  it("未登记关键字降级并保留原因，不用放宽 .mttool 子集", () => {
    const assessment = assessExternalJsonSchema({
      type: "object",
      properties: { target: { $ref: "#/$defs/target" } },
    });
    expect(assessment.supported).toBe(false);
    expect(assessment.unsupportedKeywords).toContain("$.properties.target.$ref");
  });

  it("投影后的 Schema 不含未登记关键字，按类型校验值", () => {
    const projected = projectModelVisibleJsonSchema({
      type: "object",
      properties: { target: { $ref: "#/$defs/target", type: "string" } },
    });
    expect(JSON.stringify(projected)).not.toContain("$ref");

    const schema = createExternalValueSchema({ type: "number" });
    expect(schema.safeParse(1).success).toBe(true);
    expect(schema.safeParse("1").success).toBe(false);
  });
});

describe("Connector 注册表", () => {
  it("重复注册与注销行为可预测", () => {
    const isolated = createConnectorRegistry();
    const unregister = isolated.register(createMcpConnectorDriver());
    expect(isolated.listKinds()).toEqual([
      { kind: MCP_SOURCE_KIND, transports: [MCP_STREAMABLE_HTTP_TRANSPORT] },
    ]);
    expect(() => isolated.register(createMcpConnectorDriver())).toThrow(
      /EXTERNAL_SOURCE_KIND_ALREADY_REGISTERED/,
    );
    unregister();
    expect(isolated.resolve(MCP_SOURCE_KIND)).toBeUndefined();
  });
});
