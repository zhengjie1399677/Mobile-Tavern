import { describe, expect, it, vi } from "vitest";
import { safeFetch } from "../../server/safeFetch";

describe("Node 代理逐跳 SSRF 校验", () => {
  it("在请求重定向目标前再次校验并阻止私网地址", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/admin" },
    }));
    const validateUrl = vi.fn(async (url: string) => {
      if (url.includes("127.0.0.1")) throw new Error("PRIVATE_TARGET");
    });

    await expect(safeFetch("https://api.example.test/v1", {}, {
      fetchImpl,
      validateUrl,
    })).rejects.toThrow("PRIVATE_TARGET");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(validateUrl).toHaveBeenCalledTimes(2);
  });

  it("跨源重定向剥离认证头", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, {
        status: 307,
        headers: { location: "https://other.example.test/next" },
      }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await safeFetch("https://api.example.test/start", {
      headers: { Authorization: "Bearer secret", "X-Trace": "kept" },
    }, { fetchImpl, validateUrl: async () => undefined });

    const secondInit = fetchImpl.mock.calls[1][1];
    const headers = new Headers(secondInit?.headers);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.get("x-trace")).toBe("kept");
    expect(secondInit?.redirect).toBe("manual");
  });

  it("超过重定向上限后停止", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, {
      status: 302,
      headers: { location: "/again" },
    }));

    await expect(safeFetch("https://api.example.test/start", {}, {
      fetchImpl,
      validateUrl: async () => undefined,
      maxRedirects: 2,
    })).rejects.toThrow("TOO_MANY_REDIRECTS");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

