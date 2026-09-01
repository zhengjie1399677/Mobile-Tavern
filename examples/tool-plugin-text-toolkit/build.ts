import { resolve } from "node:path";
import { buildToolPluginPackage } from "../../sdk/tool-plugin/src/packageBuilder";
import { textToolkitManifest } from "./manifest";

const root = resolve("examples/tool-plugin-text-toolkit");
await buildToolPluginPackage({
  manifest: textToolkitManifest,
  entryPoint: resolve(root, "src/index.ts"),
  outputFile: resolve(root, "text-toolkit.mttool"),
});
