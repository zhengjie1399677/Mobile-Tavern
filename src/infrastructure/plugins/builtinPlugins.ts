import astralGame from "../../../examples/astral-rift-plugin/game.js?raw";
import astralHtml from "../../../examples/astral-rift-plugin/index.html?raw";
import astralManifest from "../../../examples/astral-rift-plugin/manifest.json?raw";
import astralStyle from "../../../examples/astral-rift-plugin/style.css?raw";
import rainGame from "../../../examples/pixi-arena-plugin/game.js?raw";
import rainHtml from "../../../examples/pixi-arena-plugin/index.html?raw";
import rainManifest from "../../../examples/pixi-arena-plugin/manifest.json?raw";
import rainStyle from "../../../examples/pixi-arena-plugin/style.css?raw";
import type { FullscreenPluginManifest, InstalledFullscreenPlugin } from "../../domain/plugins";

const encoder = new TextEncoder();

const BUILTIN_PLUGINS = [
  createBuiltinPlugin(astralManifest, astralHtml, astralStyle, astralGame),
  createBuiltinPlugin(rainManifest, rainHtml, rainStyle, rainGame),
];

export function listBuiltinPlugins(): InstalledFullscreenPlugin[] {
  return [...BUILTIN_PLUGINS];
}

function createBuiltinPlugin(
  manifestSource: string,
  html: string,
  style: string,
  game: string,
): InstalledFullscreenPlugin {
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
