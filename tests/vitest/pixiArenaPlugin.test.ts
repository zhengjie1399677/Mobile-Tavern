import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parseFullscreenPluginPackage } from "../../src/domain/plugins";

const exampleRoot = resolve("examples/pixi-arena-plugin");

describe("霓虹围城 PixiJS 示例插件", () => {
  it("显式启用无 unsafe-eval 环境的 PixiJS 静态兼容实现", () => {
    const source = readFileSync(resolve(exampleRoot, "src/game.ts"), "utf8");

    expect(source).toContain('import "pixi.js/unsafe-eval";');
  });

  it("仓库内安装包可以被直接导入", () => {
    const packageBytes = readFileSync(resolve(exampleRoot, "pixi-neon-siege.mtplugin"));
    const plugin = parseFullscreenPluginPackage(new Uint8Array(packageBytes));

    expect(plugin.manifest.id).toBe("demo.pixi-neon-siege");
    expect(plugin.manifest.orientation).toBe("landscape");
    expect(plugin.files["game.js"].byteLength).toBeGreaterThan(100_000);
    expect(new TextDecoder().decode(plugin.files["game.js"])).toContain("pixiReady");
    expect(plugin.files["assets/sky-arena.png"].byteLength).toBeGreaterThan(1_000_000);
  });
});
