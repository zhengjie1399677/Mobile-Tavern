import { describe, expect, it, vi } from "vitest";
import { ToolPluginHttpClient } from "../../src/infrastructure/toolPlugins/toolPluginHttpClient";

const policy = {
  allowedOrigins: ["https://api.example.com"],
  allowedMethods: ["GET"] as const,
  maxRequestsPerCall: 1,
  maxRequestBytes: 1024,
  maxResponseBytes: 1024,
};

describe("Tool Plugin 宿主 HTTP 代理", () => {
  it("按精确 Origin 放行并在宿主侧注入凭据", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret");
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = new ToolPluginHttpClient(fetchImpl);
    await expect(client.request({ method: "GET", url: "https://api.example.com/data", credentialIds: ["key"] }, {
      pluginId: "example",
      policy,
      credentials: [{ id: "key", label: "Key", required: true, injection: { location: "header", name: "Authorization", prefix: "Bearer " } }],
      resolveCredential: async () => "secret",
      signal: new AbortController().signal,
    })).resolves.toEqual({ status: 200, contentType: "application/json", body: { ok: true } });
  });

  it("拒绝未声明 Origin 和重定向", async () => {
    const client = new ToolPluginHttpClient(async () => new Response(null, { status: 302 }));
    const context = { pluginId: "example", policy, credentials: [], resolveCredential: async () => "", signal: new AbortController().signal };
    await expect(client.request({ method: "GET", url: "https://evil.example/data" }, context)).rejects.toThrow("ORIGIN_DENIED");
    await expect(client.request({ method: "GET", url: "https://api.example.com/data" }, context)).rejects.toThrow("REDIRECT_DENIED");
  });
});
