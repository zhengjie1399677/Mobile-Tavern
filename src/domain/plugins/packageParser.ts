import { unzip } from "fflate";
import type { FullscreenPluginManifest, InstalledFullscreenPlugin } from "./types";

export const PLUGIN_PACKAGE_LIMITS = {
  compressedBytes: 25 * 1024 * 1024,
  uncompressedBytes: 100 * 1024 * 1024,
  fileBytes: 32 * 1024 * 1024,
  entryBytes: 2 * 1024 * 1024,
  manifestBytes: 64 * 1024,
  files: 512,
} as const;

const MANIFEST_PATH = "manifest.json";
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;

export async function parseFullscreenPluginPackage(
  input: ArrayBuffer | Uint8Array,
  now = Date.now()
): Promise<InstalledFullscreenPlugin> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > PLUGIN_PACKAGE_LIMITS.compressedBytes) {
    throw new Error("PLUGIN_PACKAGE_TOO_LARGE");
  }
  const inspection = inspectZipCentralDirectory(bytes);
  const inflated = await inflatePackage(bytes);
  const files: Record<string, Uint8Array> = {};
  for (const entry of inspection.entries) {
    if (entry.directory) continue;
    const data = inflated[entry.path];
    if (!data || data.byteLength !== entry.uncompressedSize) {
      throw new Error(`PLUGIN_PACKAGE_CORRUPT:${entry.path}`);
    }
    files[entry.path] = data;
  }

  const manifestBytes = files[MANIFEST_PATH];
  if (!manifestBytes) throw new Error("PLUGIN_MANIFEST_MISSING");
  if (manifestBytes.byteLength > PLUGIN_PACKAGE_LIMITS.manifestBytes) {
    throw new Error("PLUGIN_MANIFEST_TOO_LARGE");
  }
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
  } catch {
    throw new Error("PLUGIN_MANIFEST_INVALID_JSON");
  }
  const manifest = validateManifest(manifestValue);
  const entry = files[manifest.entry];
  if (!entry) throw new Error("PLUGIN_ENTRY_MISSING");
  if (entry.byteLength > PLUGIN_PACKAGE_LIMITS.entryBytes) throw new Error("PLUGIN_ENTRY_TOO_LARGE");

  return {
    id: manifest.id,
    manifest,
    files,
    installedAt: now,
    updatedAt: now,
    uncompressedSize: inspection.uncompressedSize,
  };
}

interface ZipEntryInspection {
  path: string;
  uncompressedSize: number;
  directory: boolean;
}

function inflatePackage(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  // fflate 异步 unzip 内部走 setTimeout 分块路径（非 Web Worker），天然不阻塞主线程。
  // inspectZipCentralDirectory 已完成安全校验（路径穿越/加密/文件数/大小），此处只负责解压。
  // 签名为 unzip(data, cb)，回调参数为 (err, data)。
  return new Promise((resolve, reject) => {
    unzip(
      bytes,
      (err, data) => {
        if (err) {
          reject(new Error("PLUGIN_PACKAGE_INVALID_ZIP"));
          return;
        }
        resolve(data as Record<string, Uint8Array>);
      }
    );
  });
}

function inspectZipCentralDirectory(bytes: Uint8Array): {
  entries: ZipEntryInspection[];
  uncompressedSize: number;
} {
  if (bytes.byteLength < 22) throw new Error("PLUGIN_PACKAGE_INVALID_ZIP");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minOffset = Math.max(0, bytes.byteLength - 65_557);
  let eocdOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= minOffset; offset--) {
    if (view.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("PLUGIN_PACKAGE_INVALID_ZIP");

  const disk = view.getUint16(eocdOffset + 4, true);
  const centralDisk = view.getUint16(eocdOffset + 6, true);
  const diskEntries = view.getUint16(eocdOffset + 8, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    throw new Error("PLUGIN_PACKAGE_MULTIDISK_UNSUPPORTED");
  }
  if (totalEntries === 0 || totalEntries > PLUGIN_PACKAGE_LIMITS.files) {
    throw new Error("PLUGIN_PACKAGE_FILE_LIMIT");
  }
  if (centralOffset + centralSize > eocdOffset) throw new Error("PLUGIN_PACKAGE_INVALID_ZIP");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const seen = new Set<string>();
  const entries: ZipEntryInspection[] = [];
  let uncompressedSize = 0;
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index++) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== ZIP_CENTRAL_SIGNATURE) {
      throw new Error("PLUGIN_PACKAGE_INVALID_ZIP");
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const fileSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if ((flags & 0x1) !== 0) throw new Error("PLUGIN_PACKAGE_ENCRYPTED_UNSUPPORTED");
    if (method !== 0 && method !== 8) throw new Error("PLUGIN_PACKAGE_COMPRESSION_UNSUPPORTED");
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.byteLength) throw new Error("PLUGIN_PACKAGE_INVALID_ZIP");
    let path: string;
    try {
      path = decoder.decode(bytes.subarray(nameStart, nameEnd));
    } catch {
      throw new Error("PLUGIN_PACKAGE_INVALID_PATH_ENCODING");
    }
    validatePackagePath(path);
    if (seen.has(path)) throw new Error(`PLUGIN_PACKAGE_DUPLICATE_PATH:${path}`);
    seen.add(path);
    if (fileSize > PLUGIN_PACKAGE_LIMITS.fileBytes) throw new Error(`PLUGIN_PACKAGE_FILE_TOO_LARGE:${path}`);
    uncompressedSize += fileSize;
    if (uncompressedSize > PLUGIN_PACKAGE_LIMITS.uncompressedBytes) {
      throw new Error("PLUGIN_PACKAGE_UNCOMPRESSED_LIMIT");
    }
    entries.push({ path, uncompressedSize: fileSize, directory: path.endsWith("/") });
    offset = nameEnd + extraLength + commentLength;
  }
  if (offset !== centralOffset + centralSize) throw new Error("PLUGIN_PACKAGE_INVALID_ZIP");
  return { entries, uncompressedSize };
}

function validatePackagePath(path: string): void {
  if (!path || path.includes("\\") || path.includes("\0") || path.startsWith("/") || /^[a-zA-Z]:/.test(path)) {
    throw new Error(`PLUGIN_PACKAGE_UNSAFE_PATH:${path}`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === ".." || segment === "." || segment === "" && !path.endsWith("/"))) {
    throw new Error(`PLUGIN_PACKAGE_UNSAFE_PATH:${path}`);
  }
}

function validateManifest(value: unknown): FullscreenPluginManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PLUGIN_MANIFEST_INVALID");
  const record = value as Record<string, unknown>;
  if (record.format !== "mobile-tavern.plugin" || record.manifestVersion !== 1 || record.type !== "fullscreen") {
    throw new Error("PLUGIN_MANIFEST_UNSUPPORTED");
  }
  if (typeof record.id !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(record.id) || record.id.length > 96) {
    throw new Error("PLUGIN_MANIFEST_INVALID_ID");
  }
  if (typeof record.name !== "string" || !record.name.trim() || record.name.length > 80) {
    throw new Error("PLUGIN_MANIFEST_INVALID_NAME");
  }
  if (typeof record.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(record.version)) {
    throw new Error("PLUGIN_MANIFEST_INVALID_VERSION");
  }
  if (typeof record.entry !== "string") throw new Error("PLUGIN_MANIFEST_INVALID_ENTRY");
  validatePackagePath(record.entry);
  if (!/\.html?$/i.test(record.entry)) throw new Error("PLUGIN_MANIFEST_INVALID_ENTRY");
  const orientation = record.orientation;
  if (orientation !== undefined && orientation !== "portrait" && orientation !== "landscape" && orientation !== "auto") {
    throw new Error("PLUGIN_MANIFEST_INVALID_ORIENTATION");
  }
  for (const field of ["description", "author"] as const) {
    if (record[field] !== undefined && typeof record[field] !== "string") throw new Error(`PLUGIN_MANIFEST_INVALID_${field.toUpperCase()}`);
  }
  // 权限声明白名单校验
  const ALLOWED_PERMISSIONS = ["llm.chat", "llm.chatStream", "llm.preset.list"];
  const permissions = record.permissions;
  let safePermissions: string[] | undefined;
  if (permissions !== undefined) {
    if (!Array.isArray(permissions) || permissions.length === 0 ||
        permissions.some((p) => typeof p !== "string" || !ALLOWED_PERMISSIONS.includes(p))) {
      throw new Error("PLUGIN_MANIFEST_INVALID_PERMISSIONS");
    }
    safePermissions = permissions as string[];
  }
  // LLM 配置校验：syncPreset 必须布尔；llm 存在时隐式要求 permissions 含对应 llm.* 权限
  const llm = record.llm;
  let safeLlm: { syncPreset: boolean } | undefined;
  if (llm !== undefined) {
    if (!llm || typeof llm !== "object" || typeof (llm as Record<string, unknown>).syncPreset !== "boolean") {
      throw new Error("PLUGIN_MANIFEST_INVALID_LLM");
    }
    if (!(safePermissions ?? []).some((p) => p.startsWith("llm."))) {
      throw new Error("PLUGIN_MANIFEST_LLM_REQUIRES_PERMISSION");
    }
    safeLlm = { syncPreset: (llm as { syncPreset: boolean }).syncPreset };
  }
  const safeOrientation = orientation === "portrait" || orientation === "landscape" || orientation === "auto"
    ? orientation
    : undefined;
  return {
    format: "mobile-tavern.plugin",
    manifestVersion: 1,
    id: record.id,
    name: record.name.trim(),
    version: record.version,
    type: "fullscreen",
    entry: record.entry,
    ...(typeof record.description === "string" ? { description: record.description.slice(0, 500) } : {}),
    ...(typeof record.author === "string" ? { author: record.author.slice(0, 120) } : {}),
    ...(safeOrientation ? { orientation: safeOrientation } : {}),
    ...(safePermissions ? { permissions: safePermissions as FullscreenPluginManifest["permissions"] } : {}),
    ...(safeLlm ? { llm: safeLlm } : {}),
  };
}
