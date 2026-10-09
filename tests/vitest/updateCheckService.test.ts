import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateCheckService } from "../../src/application/services/UpdateCheckService";

/**
 * 回归背景（2026-10-10）：更新检查从阿里云函数计算迁到本仓库自有服务器——
 * 客户端 GET `https://neural-node.xyz/version.json`，服务端从 downloads 目录实时推导
 * "最新版本 + 发布日期 + 固定下载链接"，**是否为新版本由客户端用 compareVersions 判定**。
 */
const versionPayload = {
  success: true,
  latestVersion: "1.9.3",
  releaseDate: "2026-10-10",
  fileName: "mobile-tavern-1.9.3-release.apk",
  size: 18961744,
  sha256: "5f8495b76bda743e79f960a5b5d87286a66a62960ddea4ba4b6c8b917210ed1e",
  downloadUrl: "https://neural-node.xyz/dl/latest",
  versionedUrl: "https://neural-node.xyz/dl/mobile-tavern-1.9.3-release.apk",
  message: "Mobile Tavern v1.9.3 · 2026-10-10",
};

function stubFetch(payload: unknown) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: typeof input === "string" ? input : input.toString(),
      method: (init?.method || "GET").toUpperCase(),
    });
    return new Response(JSON.stringify(payload), { status: 200 });
  });
  return calls;
}

describe("更新检查（自有服务器 version.json）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("读到更高的 latestVersion 时判定有更新，并带出发布日期与固定下载链接", async () => {
    stubFetch(versionPayload);
    const service = new UpdateCheckService();

    const res = await service.checkUpdate("1.9.2", undefined, true);

    expect(res.hasUpdate).toBe(true);
    expect(res.latestVersion).toBe("1.9.3");
    expect(res.releaseDate).toBe("2026-10-10");
    expect(res.downloadUrl).toBe("https://neural-node.xyz/dl/latest");
    expect(res.message).toContain("2026-10-10");
  });

  it("版本相同或更高时不再提示更新", async () => {
    stubFetch(versionPayload);
    const service = new UpdateCheckService();

    expect((await service.checkUpdate("1.9.3", undefined, true)).hasUpdate).toBe(false);
    expect((await service.checkUpdate("2.0.0", undefined, true)).hasUpdate).toBe(false);
  });

  it("没有 latestVersion 的非新版本响应不会误报更新", async () => {
    stubFetch({ success: false, message: "当前已是最新版本" });
    const service = new UpdateCheckService();

    const res = await service.checkUpdate("1.9.3", undefined, true);

    expect(res.hasUpdate).toBe(false);
    expect(res.latestVersion).toBe("1.9.3");
  });
});
