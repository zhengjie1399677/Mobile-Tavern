import { unzip } from "fflate";
import type { ToolPluginArtifact, ToolPluginInspection, ToolPluginManifest } from "./contracts";
import {
  canonicalizeToolPluginValue,
  parseToolPluginManifestValue,
} from "./manifestParser";
import {
  parseToolPluginSourceProof,
  TOOL_PLUGIN_SOURCE_PROOF_PATH,
} from "./sourceProof";

export const TOOL_PLUGIN_PACKAGE_LIMITS = {
  compressedBytes: 1024 * 1024,
  uncompressedBytes: 4 * 1024 * 1024,
  fileBytes: 2 * 1024 * 1024,
  entryBytes: 512 * 1024,
  manifestBytes: 64 * 1024,
  sourceProofBytes: 16 * 1024,
  files: 16,
} as const;

const MANIFEST_PATH = "manifest.json";
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;

export async function parseToolPluginPackage(
  input: ArrayBuffer | Uint8Array,
  now = Date.now(),
): Promise<ToolPluginInspection> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > TOOL_PLUGIN_PACKAGE_LIMITS.compressedBytes) {
    throw new Error("TOOL_PLUGIN_PACKAGE_TOO_LARGE");
  }
  const entries = inspectCentralDirectory(bytes);
  const inflated = await inflate(bytes);
  const files: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    if (entry.directory) continue;
    const content = inflated[entry.path];
    if (!content || content.byteLength !== entry.uncompressedSize) {
      throw new Error(`TOOL_PLUGIN_PACKAGE_CORRUPT:${entry.path}`);
    }
    files[entry.path] = content;
  }
  const manifestBytes = files[MANIFEST_PATH];
  if (!manifestBytes) throw new Error("TOOL_PLUGIN_MANIFEST_MISSING");
  if (manifestBytes.byteLength > TOOL_PLUGIN_PACKAGE_LIMITS.manifestBytes) {
    throw new Error("TOOL_PLUGIN_MANIFEST_TOO_LARGE");
  }
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
  } catch {
    throw new Error("TOOL_PLUGIN_MANIFEST_INVALID_JSON");
  }
  const manifest = parseToolPluginManifestValue(manifestValue);
  if (manifest.manifestVersion !== 2 || manifest.runtime.execution !== "worker") {
    throw new Error("TOOL_PLUGIN_PACKAGE_MANIFEST_UNSUPPORTED");
  }
  const computedHash = await computeToolPluginPackageHash(manifest, files);
  if (computedHash !== manifest.contentHash) throw new Error("TOOL_PLUGIN_CONTENT_HASH_MISMATCH");

  let sourceProof;
  const sourceProofBytes = files[TOOL_PLUGIN_SOURCE_PROOF_PATH];
  if (sourceProofBytes) {
    if (sourceProofBytes.byteLength > TOOL_PLUGIN_PACKAGE_LIMITS.sourceProofBytes) {
      throw new Error("TOOL_PLUGIN_SOURCE_PROOF_TOO_LARGE");
    }
    sourceProof = parseToolPluginSourceProof(sourceProofBytes);
  }

  let entryCode: string | undefined;
  if (manifest.runtime.entry) {
    const entry = files[manifest.runtime.entry];
    if (!entry) throw new Error("TOOL_PLUGIN_ENTRY_MISSING");
    if (entry.byteLength > TOOL_PLUGIN_PACKAGE_LIMITS.entryBytes) throw new Error("TOOL_PLUGIN_ENTRY_TOO_LARGE");
    try {
      entryCode = new TextDecoder("utf-8", { fatal: true }).decode(entry);
    } catch {
      throw new Error("TOOL_PLUGIN_ENTRY_INVALID_UTF8");
    }
    assertWorkerSource(entryCode);
  }
  if (manifest.tools.some((tool) => tool.handler?.kind === "worker") && !entryCode) {
    throw new Error("TOOL_PLUGIN_ENTRY_MISSING");
  }
  const artifact: ToolPluginArtifact = {
    pluginId: manifest.id,
    contentHash: manifest.contentHash,
    ...(entryCode ? { entryCode } : {}),
    ...(sourceProof ? { sourceProof } : {}),
    installedAt: now,
  };
  return { manifest, artifact, ...(sourceProof ? { sourceProof } : {}) };
}

export async function computeToolPluginPackageHash(
  manifest: ToolPluginManifest | Omit<ToolPluginManifest, "contentHash">,
  files: Readonly<Record<string, Uint8Array>>,
): Promise<`sha256:${string}`> {
  const { contentHash: _contentHash, ...hashable } = manifest as ToolPluginManifest;
  const fileHashes: string[] = [];
  for (const path of Object.keys(files).filter((path) => (
    path !== MANIFEST_PATH && path !== TOOL_PLUGIN_SOURCE_PROOF_PATH
  )).sort()) {
    const digest = await sha256(files[path]);
    fileHashes.push(`${path}:${digest}`);
  }
  return `sha256:${await sha256(new TextEncoder().encode(
    `${canonicalizeToolPluginValue(hashable)}\n${fileHashes.join("\n")}`,
  ))}`;
}

function assertWorkerSource(source: string): void {
  const forbidden = [
    /\bimportScripts\s*\(/,
    /\bimport\s*\(/,
    /\b(?:Shared)?Worker\s*\(/,
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/,
    /\b(?:indexedDB|caches)\b/,
    /\b(?:eval|Function)\s*\(/,
  ];
  if (forbidden.some((pattern) => pattern.test(source))) {
    throw new Error("TOOL_PLUGIN_ENTRY_FORBIDDEN_API");
  }
  if (!source.includes("MobileTavernToolPlugin")) {
    throw new Error("TOOL_PLUGIN_ENTRY_EXPORT_MISSING");
  }
}

interface ZipEntry {
  path: string;
  uncompressedSize: number;
  directory: boolean;
}

function inflate(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(bytes, (error, data) => {
      if (error) reject(new Error("TOOL_PLUGIN_PACKAGE_INVALID_ZIP"));
      else resolve(data as Record<string, Uint8Array>);
    });
  });
}

function inspectCentralDirectory(bytes: Uint8Array): ZipEntry[] {
  if (bytes.byteLength < 22) throw new Error("TOOL_PLUGIN_PACKAGE_INVALID_ZIP");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minOffset = Math.max(0, bytes.byteLength - 65_557);
  let eocdOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("TOOL_PLUGIN_PACKAGE_INVALID_ZIP");
  const disk = view.getUint16(eocdOffset + 4, true);
  const centralDisk = view.getUint16(eocdOffset + 6, true);
  const diskEntries = view.getUint16(eocdOffset + 8, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    throw new Error("TOOL_PLUGIN_PACKAGE_MULTIDISK_UNSUPPORTED");
  }
  if (totalEntries === 0 || totalEntries > TOOL_PLUGIN_PACKAGE_LIMITS.files) {
    throw new Error("TOOL_PLUGIN_PACKAGE_FILE_LIMIT");
  }
  if (centralOffset + centralSize > eocdOffset) throw new Error("TOOL_PLUGIN_PACKAGE_INVALID_ZIP");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const seen = new Set<string>();
  const entries: ZipEntry[] = [];
  let totalSize = 0;
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== ZIP_CENTRAL_SIGNATURE) {
      throw new Error("TOOL_PLUGIN_PACKAGE_INVALID_ZIP");
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const fileSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if ((flags & 0x1) !== 0) throw new Error("TOOL_PLUGIN_PACKAGE_ENCRYPTED_UNSUPPORTED");
    if (method !== 0 && method !== 8) throw new Error("TOOL_PLUGIN_PACKAGE_COMPRESSION_UNSUPPORTED");
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.byteLength) throw new Error("TOOL_PLUGIN_PACKAGE_INVALID_ZIP");
    let path: string;
    try {
      path = decoder.decode(bytes.subarray(nameStart, nameEnd));
    } catch {
      throw new Error("TOOL_PLUGIN_PACKAGE_INVALID_PATH_ENCODING");
    }
    validatePath(path);
    if (seen.has(path)) throw new Error(`TOOL_PLUGIN_PACKAGE_DUPLICATE_PATH:${path}`);
    seen.add(path);
    if (fileSize > TOOL_PLUGIN_PACKAGE_LIMITS.fileBytes) throw new Error(`TOOL_PLUGIN_PACKAGE_FILE_TOO_LARGE:${path}`);
    totalSize += fileSize;
    if (totalSize > TOOL_PLUGIN_PACKAGE_LIMITS.uncompressedBytes) throw new Error("TOOL_PLUGIN_PACKAGE_UNCOMPRESSED_LIMIT");
    entries.push({ path, uncompressedSize: fileSize, directory: path.endsWith("/") });
    offset = nameEnd + extraLength + commentLength;
  }
  if (offset !== centralOffset + centralSize) throw new Error("TOOL_PLUGIN_PACKAGE_INVALID_ZIP");
  return entries;
}

function validatePath(path: string): void {
  if (!path || path.includes("\\") || path.includes("\0") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new Error(`TOOL_PLUGIN_PACKAGE_UNSAFE_PATH:${path}`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "." || segment === ".." || segment === "" && !path.endsWith("/"))) {
    throw new Error(`TOOL_PLUGIN_PACKAGE_UNSAFE_PATH:${path}`);
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}
