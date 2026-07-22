import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parseFullscreenPluginPackage } from "../../src/domain/plugins";
import { listBuiltinPlugins } from "../../src/infrastructure/plugins/builtinPlugins";

const exampleRoot = resolve("examples/astral-rift-plugin");

describe("星渊终焉 PixiJS 示例插件", () => {
  it("使用适配强 CSP 的 PixiJS 静态实现并提供多阶段战斗", () => {
    const source = readFileSync(resolve(exampleRoot, "src/game.ts"), "utf8");

    expect(source).toContain('import "pixi.js/unsafe-eval";');
    expect(source).toContain("enterPhase(2)");
    expect(source).toContain("activateUltimate");
  });

  it("生成的安装包可通过第三方插件解析器", () => {
    const packageBytes = readFileSync(resolve(exampleRoot, "astral-rift.mtplugin"));
    const plugin = parseFullscreenPluginPackage(new Uint8Array(packageBytes));

    expect(plugin.manifest.id).toBe("demo.astral-rift");
    expect(plugin.manifest.version).toBe("1.0.0");
    expect(plugin.manifest.orientation).toBe("landscape");
    expect(plugin.files["game.js"].byteLength).toBeGreaterThan(100_000);
    expect(new TextDecoder().decode(plugin.files["game.js"])).toContain("astral-record");
    expect(new TextDecoder().decode(plugin.files["game.js"])).toContain("data:image/webp;base64");
  });

  it("正式前端包内包含星渊终焉和夜雨试剑两个只读插件", () => {
    const plugins = listBuiltinPlugins();

    expect(plugins.map((plugin) => plugin.id)).toEqual(["demo.astral-rift", "demo.rain-sword-duel"]);
    for (const plugin of plugins) {
      expect(plugin.builtin).toBe(true);
      expect(plugin.files[plugin.manifest.entry].byteLength).toBeGreaterThan(100);
      expect(plugin.files["game.js"].byteLength).toBeGreaterThan(100_000);
    }
  });
});
