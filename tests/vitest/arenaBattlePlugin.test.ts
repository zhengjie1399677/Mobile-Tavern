import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";

import { parseFullscreenPluginPackage } from "../../src/domain/plugins";

const exampleRoot = resolve("examples/arena-battle-plugin");

describe("星穹对决示例插件", () => {
  it("可以打包为受支持的完整插件", () => {
    const files = {
      "manifest.json": readFileSync(resolve(exampleRoot, "manifest.json")),
      "index.html": readFileSync(resolve(exampleRoot, "index.html")),
      "style.css": readFileSync(resolve(exampleRoot, "style.css")),
      "game.js": readFileSync(resolve(exampleRoot, "game.js")),
      "assets/sky-arena.png": readFileSync(resolve(exampleRoot, "assets/sky-arena.png")),
    };

    const plugin = parseFullscreenPluginPackage(zipSync(files, { level: 6 }));

    expect(plugin.manifest.id).toBe("demo.astral-arena");
    expect(plugin.manifest.orientation).toBe("landscape");
    expect(plugin.files["assets/sky-arena.png"].byteLength).toBeGreaterThan(1_000_000);
  });

  it("仓库内安装包可以被直接导入", () => {
    const packageBytes = readFileSync(resolve(exampleRoot, "astral-arena.mtplugin"));
    const plugin = parseFullscreenPluginPackage(new Uint8Array(packageBytes));

    expect(plugin.manifest.name).toBe("星穹对决");
    expect(plugin.files["game.js"].byteLength).toBeGreaterThan(5_000);
  });
});
