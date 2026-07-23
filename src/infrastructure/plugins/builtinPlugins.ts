import astralGameUrl from "../../../examples/astral-rift-plugin/game.js?url";
import astralHtmlUrl from "../../../examples/astral-rift-plugin/index.html?url";
import astralManifestUrl from "../../../examples/astral-rift-plugin/manifest.json?url";
import astralStyleUrl from "../../../examples/astral-rift-plugin/style.css?url";
import rainGameUrl from "../../../examples/pixi-arena-plugin/game.js?url";
import rainHtmlUrl from "../../../examples/pixi-arena-plugin/index.html?url";
import rainManifestUrl from "../../../examples/pixi-arena-plugin/manifest.json?url";
import rainStyleUrl from "../../../examples/pixi-arena-plugin/style.css?url";
import type { FullscreenPluginManifest, InstalledFullscreenPlugin } from "../../domain/plugins";

const encoder = new TextEncoder();

/**
 * 列出内置全屏插件。
 *
 * 生产构建中插件文件通过 `?url` 作为独立静态资源打包（不内联为字符串），
 * 调用时按需 fetch 加载。这使 PluginManagerSection chunk 从 ~2.3MB 降至 ~50KB。
 */
export async function listBuiltinPlugins(): Promise<InstalledFullscreenPlugin[]> {
  const [astral, rain] = await Promise.all([
    loadBuiltinPlugin(astralManifestUrl, astralHtmlUrl, astralStyleUrl, astralGameUrl),
    loadBuiltinPlugin(rainManifestUrl, rainHtmlUrl, rainStyleUrl, rainGameUrl),
  ]);
  return [astral, rain];
}

async function loadBuiltinPlugin(
  manifestUrl: string,
  htmlUrl: string,
  styleUrl: string,
  gameUrl: string,
): Promise<InstalledFullscreenPlugin> {
  const [manifestSource, html, style, game] = await Promise.all([
    fetch(manifestUrl).then((r) => r.text()),
    fetch(htmlUrl).then((r) => r.text()),
    fetch(styleUrl).then((r) => r.text()),
    fetch(gameUrl).then((r) => r.text()),
  ]);
  const manifest = JSON.parse(manifestSource) as FullscreenPluginManifest;
  const files = {
    "manifest.json": encoder.encode(manifestSource),
    [manifest.entry]: encoder.encode(html),
    "style.css": encoder.encode(style),
    "game.js": encoder.encode(game),
  };
  return {
    id: manifest.id,
    manifest,
    files,
    installedAt: 0,
    updatedAt: 0,
    uncompressedSize: Object.values(files).reduce((sum, file) => sum + file.byteLength, 0),
    builtin: true,
  };
}
