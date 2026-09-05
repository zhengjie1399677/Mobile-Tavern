import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { build } from "esbuild";
import { zipSync } from "fflate";
import type { ToolPluginManifestDefinition } from "./index";

const MANIFEST_PATH = "manifest.json";
const DETERMINISTIC_ZIP_TIME = new Date("1980-01-01T00:00:00.000Z");

export interface CreateToolPluginPackageOptions {
  readonly manifest: ToolPluginManifestDefinition;
  readonly entryCode?: string;
}

export interface BuildToolPluginPackageOptions {
  readonly manifest: ToolPluginManifestDefinition;
  readonly entryPoint: string;
  readonly outputFile: string;
  readonly minify?: boolean;
}

export function createToolPluginPackage(options: CreateToolPluginPackageOptions): Uint8Array {
  assertPackageDefinition(options);
  const entryPath = options.manifest.runtime.entry;
  const files: Record<string, Uint8Array> = {};
  if (entryPath && options.entryCode) files[entryPath] = new TextEncoder().encode(options.entryCode);
  const contentHash = computePackageHash(options.manifest, files);
  files[MANIFEST_PATH] = new TextEncoder().encode(JSON.stringify({
    ...options.manifest,
    contentHash,
  }, null, 2));
  return zipSync(files, { level: 6, mtime: DETERMINISTIC_ZIP_TIME });
}

export async function buildToolPluginPackage(options: BuildToolPluginPackageOptions): Promise<void> {
  if (!options.manifest.runtime.entry) throw new Error("TOOL_PLUGIN_SDK_ENTRY_REQUIRED");
  const result = await build({
    entryPoints: [options.entryPoint],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome100", "safari15"],
    minify: options.minify ?? true,
    legalComments: "none",
    write: false,
  });
  const entryCode = result.outputFiles[0]?.text;
  if (!entryCode) throw new Error("TOOL_PLUGIN_SDK_BUILD_EMPTY");
  const archive = createToolPluginPackage({ manifest: options.manifest, entryCode });
  await mkdir(dirname(options.outputFile), { recursive: true });
  await writeFile(options.outputFile, archive);
}

function assertPackageDefinition(options: CreateToolPluginPackageOptions): void {
  const entryPath = options.manifest.runtime.entry;
  if (options.manifest.format !== "mobile-tavern.tool-plugin" || options.manifest.manifestVersion !== 2) {
    throw new Error("TOOL_PLUGIN_SDK_MANIFEST_UNSUPPORTED");
  }
  if (options.manifest.runtime.execution !== "worker") {
    throw new Error("TOOL_PLUGIN_SDK_RUNTIME_UNSUPPORTED");
  }
  if (entryPath && !options.entryCode) throw new Error("TOOL_PLUGIN_SDK_ENTRY_REQUIRED");
  if (!entryPath && options.entryCode) throw new Error("TOOL_PLUGIN_SDK_ENTRY_UNDECLARED");
  if (entryPath && !options.entryCode?.includes("MobileTavernToolPlugin")) {
    throw new Error("TOOL_PLUGIN_SDK_ENTRY_EXPORT_MISSING");
  }
}

function computePackageHash(
  manifest: ToolPluginManifestDefinition,
  files: Readonly<Record<string, Uint8Array>>,
): `sha256:${string}` {
  const fileHashes = Object.keys(files).sort().map((path) => `${path}:${sha256(files[path])}`);
  return `sha256:${sha256(new TextEncoder().encode(
    `${canonicalize(JSON.parse(JSON.stringify(manifest)))}\n${fileHashes.join("\n")}`,
  ))}`;
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalize(record[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
