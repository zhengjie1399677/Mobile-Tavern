// @vitest-environment node
/**
 * 远端实机连通性（opt-in）。
 *
 * 默认跳过：只有显式提供 `MCP_LIVE_SERVER_URL` 时才跑，避免 CI 依赖外部网络
 * （`TEST-CONTROLLED`）。用法：
 *   $env:MCP_LIVE_SERVER_URL="https://example.com/mcp"; npx vitest run tests/vitest/externalSourceMcpLive.test.ts
 */
import { describe, expect, it } from "vitest";
import { openExternalSource } from "@/src/application/externalSources/externalSourceService";
import { createConnectorRegistry } from "@/src/domain/externalSources/registry";
import {
  MCP_SOURCE_KIND,
  MCP_STREAMABLE_HTTP_TRANSPORT,
  createMcpConnectorDriver,
} from "@/src/infrastructure/externalSources/mcp/mcpConnectorDriver";

const liveEndpoint = process.env.MCP_LIVE_SERVER_URL;

describe.skipIf(!liveEndpoint)("远端 MCP 实机（opt-in）", () => {
  it(
    "能连接并投影真实 server 的能力",
    async () => {
      const registry = createConnectorRegistry();
      registry.register(createMcpConnectorDriver());
      const handle = await openExternalSource(
        {
          schemaVersion: 1,
          id: "live",
          kind: MCP_SOURCE_KIND,
          displayName: "远端实机",
          endpoint: liveEndpoint,
          transport: MCP_STREAMABLE_HTTP_TRANSPORT,
          era: "auto",
          enabled: true,
        },
        { registry, timeoutMs: 30_000 },
      );
      try {
        console.log(
          `[live-mcp] server=${handle.snapshot.serverName}/${handle.snapshot.serverVersion} ` +
            `protocol=${handle.snapshot.negotiatedProtocolVersion} ` +
            `tools=${handle.snapshot.tools.length} resources=${handle.snapshot.resources.length} ` +
            `prompts=${handle.snapshot.prompts.length} unsupported=${handle.snapshot.unsupportedCapabilities.join("|")} ` +
            `warnings=${handle.snapshot.warnings.join("|")}`,
        );
        expect(handle.snapshot.serverName).toBeTruthy();
        expect(handle.snapshot.tools.length).toBeGreaterThan(0);
      } finally {
        await handle.dispose();
      }
    },
    60_000,
  );
});
