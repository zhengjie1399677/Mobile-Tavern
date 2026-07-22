import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { zipSync } from "fflate";

const root = resolve("examples/pixi-arena-plugin");
await mkdir(resolve(root, "assets"), { recursive: true });
await build({
  entryPoints: [resolve(root, "src/game.ts")],
  outfile: resolve(root, "game.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome100", "safari15"],
  minify: true,
  loader: { ".webp": "dataurl" },
  legalComments: "none",
  define: { __PIXI_VERSION__: JSON.stringify("8.18.1") },
});

const names = ["manifest.json", "index.html", "style.css", "game.js"];
const files = Object.fromEntries(await Promise.all(names.map(async (name) => [name, new Uint8Array(await readFile(resolve(root, name)))])));
await writeFile(resolve(root, "rain-sword-duel.mtplugin"), zipSync(files, { level: 6 }));
