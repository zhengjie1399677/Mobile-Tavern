import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listBuiltinPluginMetadata,
  loadBuiltinPluginById,
} from "../../src/infrastructure/plugins/builtinPlugins";

describe("内置游戏按需加载", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("首页只读取 manifest，启动时才读取目标游戏资源", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isAstral = url.includes("astral-rift");
      if (url.includes("manifest")) {
        return new Response(JSON.stringify({
          id: isAstral ? "demo.astral-rift" : "demo.rain-sword-duel",
          name: isAstral ? "星渊终焉" : "夜雨试剑",
          version: "1.0.0",
          entry: "index.html",
        }));
      }
      return new Response(url.endsWith(".html") ? "<main />" : "/* resource */");
    });
    vi.stubGlobal("fetch", fetchMock);

    const metadata = await listBuiltinPluginMetadata();
    expect(metadata).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes("manifest"))).toBe(true);

    fetchMock.mockClear();
    const plugin = await loadBuiltinPluginById("demo.astral-rift");
    expect(plugin.id).toBe("demo.astral-rift");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("game"))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("manifest"))).toBe(false);
  });
});
