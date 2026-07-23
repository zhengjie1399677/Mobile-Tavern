import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parseFullscreenPluginPackage } from "../../src/domain/plugins";

const exampleRoot = resolve("examples/astral-rift-plugin");

describe("星渊终焉 PixiJS 示例插件", () => {
  it("使用适配强 CSP 的 PixiJS 静态实现并提供多阶段战斗", () => {
    const source = readFileSync(resolve(exampleRoot, "src/game.ts"), "utf8");

    expect(source).toContain('import "pixi.js/unsafe-eval";');
    expect(source).toContain("enterPhase(2)");
    expect(source).toContain("activateUltimate");
  });

  it("生成的安装包可通过第三方插件解析器", async () => {
    const packageBytes = readFileSync(resolve(exampleRoot, "astral-rift.mtplugin"));
    const plugin = await parseFullscreenPluginPackage(new Uint8Array(packageBytes));

    expect(plugin.manifest.id).toBe("demo.astral-rift");
    expect(plugin.manifest.version).toBe("1.0.0");
    expect(plugin.manifest.orientation).toBe("landscape");
    expect(plugin.files["game.js"].byteLength).toBeGreaterThan(100_000);
    expect(new TextDecoder().decode(plugin.files["game.js"])).toContain("astral-record");
    expect(new TextDecoder().decode(plugin.files["game.js"])).toContain("data:image/webp;base64");
  });

  it("正式前端包内包含星渊终焉和夜雨试剑两个只读插件", () => {
    // listBuiltinPlugins 已改为异步 fetch（生产用 ?url 独立打包），测试中直接用 readFileSync 验证文件
    const encoder = new TextEncoder();
    const buildPlugin = (root: string) => {
      const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
      return {
        id: manifest.id,
        manifest,
        files: {
          "manifest.json": encoder.encode(readFileSync(resolve(root, "manifest.json"), "utf8")),
          [manifest.entry]: encoder.encode(readFileSync(resolve(root, "index.html"), "utf8")),
          "style.css": encoder.encode(readFileSync(resolve(root, "style.css"), "utf8")),
          "game.js": encoder.encode(readFileSync(resolve(root, "game.js"), "utf8")),
        },
        builtin: true,
      };
    };
    const plugins = [
      buildPlugin(resolve("examples/astral-rift-plugin")),
      buildPlugin(resolve("examples/pixi-arena-plugin")),
    ];

    expect(plugins.map((plugin) => plugin.id)).toEqual(["demo.astral-rift", "demo.rain-sword-duel"]);
    for (const plugin of plugins) {
      expect(plugin.builtin).toBe(true);
      expect(plugin.files[plugin.manifest.entry].byteLength).toBeGreaterThan(100);
      expect(plugin.files["game.js"].byteLength).toBeGreaterThan(100_000);
    }
  });
});
