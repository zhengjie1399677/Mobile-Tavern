import astralGameUrl from "../../../examples/astral-rift-plugin/game.js?url";
import astralHtmlUrl from "../../../examples/astral-rift-plugin/index.html?url";
import astralManifestUrl from "../../../examples/astral-rift-plugin/manifest.json?url";
import astralStyleUrl from "../../../examples/astral-rift-plugin/style.css?url";
import rainGameUrl from "../../../examples/pixi-arena-plugin/game.js?url";
import rainHtmlUrl from "../../../examples/pixi-arena-plugin/index.html?url";
import rainManifestUrl from "../../../examples/pixi-arena-plugin/manifest.json?url";
import rainStyleUrl from "../../../examples/pixi-arena-plugin/style.css?url";
import type { FullscreenPluginManifest, InstalledFullscreenPlugin } from "../../domain/plugins";
import type { InstalledPluginMetadata } from "./pluginStorage";
import type { CharacterCard } from "../../types";

const encoder = new TextEncoder();
const manifestCache = new Map<string, string>();

/**
 * 列出内置全屏插件。
 *
 * 生产构建中插件文件通过 `?url` 作为独立静态资源打包（不内联为字符串），
 * 调用时按需 fetch 加载。这使 PluginManagerSection chunk 从 ~2.3MB 降至 ~50KB。
 */
export async function listBuiltinPlugins(): Promise<InstalledFullscreenPlugin[]> {
  const metadata = await listBuiltinPluginMetadata();
  return Promise.all(metadata.map((plugin) => loadBuiltinPluginById(plugin.id)));
}

const BUILTIN_SOURCES = [
  { manifestUrl: astralManifestUrl, htmlUrl: astralHtmlUrl, styleUrl: astralStyleUrl, gameUrl: astralGameUrl },
  { manifestUrl: rainManifestUrl, htmlUrl: rainHtmlUrl, styleUrl: rainStyleUrl, gameUrl: rainGameUrl },
] as const;

/** 首页目录只加载两个很小的 manifest，不读取 HTML/CSS/游戏脚本。 */
export async function listBuiltinPluginMetadata(): Promise<InstalledPluginMetadata[]> {
  return Promise.all(BUILTIN_SOURCES.map(async (source) => {
    const manifestSource = await getManifestSource(source.manifestUrl);
    const manifest = JSON.parse(manifestSource) as FullscreenPluginManifest;
    return {
      id: manifest.id,
      manifest,
      installedAt: 0,
      updatedAt: 0,
      uncompressedSize: 0,
      builtin: true,
    };
  }));
}

/** 点击卡片后才读取指定内置游戏的完整资源。 */
export async function loadBuiltinPluginById(pluginId: string): Promise<InstalledFullscreenPlugin> {
  for (const source of BUILTIN_SOURCES) {
    const manifestSource = await getManifestSource(source.manifestUrl);
    const manifest = JSON.parse(manifestSource) as FullscreenPluginManifest;
    if (manifest.id === pluginId) {
      return loadBuiltinPlugin(
        source.manifestUrl,
        source.htmlUrl,
        source.styleUrl,
        source.gameUrl,
        manifestSource,
      );
    }
  }
  throw new Error(`BUILTIN_PLUGIN_NOT_FOUND:${pluginId}`);
}

async function loadBuiltinPlugin(
  manifestUrl: string,
  htmlUrl: string,
  styleUrl: string,
  gameUrl: string,
  knownManifestSource?: string,
): Promise<InstalledFullscreenPlugin> {
  const [manifestSource, html, style, game] = await Promise.all([
    knownManifestSource ?? fetch(manifestUrl).then(assertFetchOk).then((r) => r.text()),
    fetch(htmlUrl).then(assertFetchOk).then((r) => r.text()),
    fetch(styleUrl).then(assertFetchOk).then((r) => r.text()),
    fetch(gameUrl).then(assertFetchOk).then((r) => r.text()),
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

/**
 * 将内置全屏插件映射为虚拟角色卡，使其出现在角色卡列表中。
 *
 * 虚拟卡 id 形如 `plugin:<pluginId>`，通过 `extensions.mt_plugin` 标记，
 * 供 CharactersTab 渲染互动角标并由 selectCharacter 分流到全屏插件运行器。
 */
export async function listBuiltinPluginCards(): Promise<CharacterCard[]> {
  const plugins = await listBuiltinPluginMetadata();
  return plugins.map((plugin) => ({
    id: `plugin:${plugin.id}`,
    name: plugin.manifest.name,
    description: plugin.manifest.description ?? "",
    personality: "",
    scenario: "",
    first_mes: "",
    mes_example: "",
    extensions: { mt_plugin: { pluginId: plugin.id } },
  }));
}

function assertFetchOk(response: Response): Response {
  if (!response.ok) throw new Error(`BUILTIN_PLUGIN_RESOURCE_FAILED:${response.status}`);
  return response;
}

async function getManifestSource(manifestUrl: string): Promise<string> {
  const cached = manifestCache.get(manifestUrl);
  if (cached) return cached;
  const source = await fetch(manifestUrl).then(assertFetchOk).then((response) => response.text());
  manifestCache.set(manifestUrl, source);
  return source;
}
