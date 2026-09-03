import { unzip, zip } from "fflate";
import {
  validateThemePackage,
  type CustomThemePackage,
  generateThemeId,
} from "../../utils/themePackage";
import type { ILocalResourceService } from "../../application/serviceContracts";

export const THEME_ZIP_LIMITS = {
  compressedBytes: 150 * 1024 * 1024, // 150MB 压缩包上限（考虑到高清背景视频）
  uncompressedBytes: 350 * 1024 * 1024, // 350MB 解压后上限
  fileBytes: 150 * 1024 * 1024,
  maxFiles: 300,
} as const;

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;

const MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
};

export interface ExtractedMediaFile {
  relativePath: string;
  filename: string;
  file: File;
}

export interface UnpackedThemeZipResult {
  rawThemeJson: string;
  themeJsonPath: string;
  mediaFiles: ExtractedMediaFile[];
}

export interface ImportThemeZipResult {
  theme: CustomThemePackage;
  themeId: string;
  importedResourcesCount: number;
}

/**
 * 校验并清理 ZIP 内部文件路径，防止目录穿越与空字符攻击
 */
export function validateZipEntryPath(path: string): void {
  if (!path || path.includes("\\") || path.includes("\0") || path.startsWith("/") || /^[a-zA-Z]:/.test(path)) {
    throw new Error(`THEME_ZIP_UNSAFE_PATH:${path}`);
  }
  const segments = path.split("/");
  if (segments.some(seg => seg === ".." || seg === "." || (seg === "" && !path.endsWith("/")))) {
    throw new Error(`THEME_ZIP_UNSAFE_PATH:${path}`);
  }
}

/**
 * 异步解压 ZIP 二进制字节
 */
function inflateZipBytes(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(bytes, (err, data) => {
      if (err) {
        reject(new Error("THEME_ZIP_INVALID_ARCHIVE"));
        return;
      }
      resolve(data as Record<string, Uint8Array>);
    });
  });
}

/**
 * 快速检查 Central Directory 并防范 Zip Bomb
 */
function inspectThemeZip(bytes: Uint8Array): {
  entries: Array<{ path: string; uncompressedSize: number; directory: boolean }>;
  uncompressedSize: number;
} {
  if (bytes.byteLength < 22) throw new Error("THEME_ZIP_INVALID_ARCHIVE");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minOffset = Math.max(0, bytes.byteLength - 65_557);
  let eocdOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= minOffset; offset--) {
    if (view.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("THEME_ZIP_INVALID_ARCHIVE");

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  if (totalEntries === 0 || totalEntries > THEME_ZIP_LIMITS.maxFiles) {
    throw new Error("THEME_ZIP_FILE_LIMIT");
  }

  const centralOffset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const entries: Array<{ path: string; uncompressedSize: number; directory: boolean }> = [];
  let uncompressedSize = 0;
  let offset = centralOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== ZIP_CENTRAL_SIGNATURE) {
      throw new Error("THEME_ZIP_INVALID_ARCHIVE");
    }
    const fileSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);

    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.byteLength) throw new Error("THEME_ZIP_INVALID_ARCHIVE");

    const path = decoder.decode(bytes.subarray(nameStart, nameEnd)).replace(/^\.\//, "");
    validateZipEntryPath(path);

    if (fileSize > THEME_ZIP_LIMITS.fileBytes) {
      throw new Error(`THEME_ZIP_FILE_TOO_LARGE:${path}`);
    }
    uncompressedSize += fileSize;
    if (uncompressedSize > THEME_ZIP_LIMITS.uncompressedBytes) {
      throw new Error("THEME_ZIP_UNCOMPRESSED_LIMIT");
    }

    entries.push({
      path,
      uncompressedSize: fileSize,
      directory: path.endsWith("/"),
    });

    offset = nameEnd + extraLength + commentLength;
  }

  return { entries, uncompressedSize };
}

/**
 * 从 ZIP 文件中解包出主题 JSON 与多媒体文件集合
 */
export async function unpackThemeZip(input: Uint8Array | ArrayBuffer): Promise<UnpackedThemeZipResult> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > THEME_ZIP_LIMITS.compressedBytes) {
    throw new Error("THEME_ZIP_TOO_LARGE");
  }

  inspectThemeZip(bytes);
  const files = await inflateZipBytes(bytes);

  // 1. 查找主题配置文件 (优先查找 theme.json 或根目录下唯一 .json)
  let themeJsonPath: string | null = null;
  const jsonPaths = Object.keys(files).filter(path => !path.endsWith("/") && path.toLowerCase().endsWith(".json"));

  if (files["theme.json"]) {
    themeJsonPath = "theme.json";
  } else if (jsonPaths.length === 1) {
    themeJsonPath = jsonPaths[0];
  } else {
    // 寻找包含 theme 的 json
    const matched = jsonPaths.find(p => p.toLowerCase().includes("theme"));
    if (matched) themeJsonPath = matched;
  }

  if (!themeJsonPath || !files[themeJsonPath]) {
    throw new Error("THEME_ZIP_JSON_MISSING");
  }

  const rawThemeJson = new TextDecoder("utf-8").decode(files[themeJsonPath]);

  // 2. 提取多媒体文件（图片、视频、音频）
  const mediaFiles: ExtractedMediaFile[] = [];
  for (const [path, data] of Object.entries(files)) {
    if (path === themeJsonPath || path.endsWith("/")) continue;

    const ext = path.toLowerCase().split(".").pop() ?? "";
    const mimeType = MIME_MAP[ext];
    if (!mimeType) continue; // 忽略非多媒体支持的文件

    const filename = path.split("/").pop() ?? path;
    const blob = new Blob([data], { type: mimeType });
    const file = new File([blob], filename, { type: mimeType });

    mediaFiles.push({
      relativePath: path,
      filename,
      file,
    });
  }

  return {
    rawThemeJson,
    themeJsonPath,
    mediaFiles,
  };
}

/**
 * 从任意 ZIP 中提取所有可用的多媒体资源文件（用于本地资源管理器批量导入）
 */
export async function extractMediaFilesFromZip(input: Uint8Array | ArrayBuffer): Promise<File[]> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > THEME_ZIP_LIMITS.compressedBytes) {
    throw new Error("THEME_ZIP_TOO_LARGE");
  }

  inspectThemeZip(bytes);
  const files = await inflateZipBytes(bytes);
  const mediaList: File[] = [];

  for (const [path, data] of Object.entries(files)) {
    if (path.endsWith("/")) continue;
    const ext = path.toLowerCase().split(".").pop() ?? "";
    const mimeType = MIME_MAP[ext];
    if (!mimeType) continue;

    const filename = path.split("/").pop() ?? path;
    const blob = new Blob([data], { type: mimeType });
    mediaList.push(new File([blob], filename, { type: mimeType }));
  }

  return mediaList;
}

/**
 * 核心执行：解析主题 ZIP 包、素材自动入库、相对路径重映射并返回已验证的 CustomThemePackage
 */
export async function importThemeZipPackage(
  input: Uint8Array | ArrayBuffer,
  localResourceService: ILocalResourceService,
): Promise<ImportThemeZipResult> {
  const { rawThemeJson, mediaFiles } = await unpackThemeZip(input);

  // 1. 将解出的多媒体文件逐一导入本地资源库，记录相对路径/文件名 -> 资源 ID 映射
  const pathToResourceId = new Map<string, string>();
  for (const media of mediaFiles) {
    try {
      const metadata = await localResourceService.importFile(media.file);
      // 记录完整相对路径，如 "assets/bg.png"
      pathToResourceId.set(media.relativePath, metadata.id);
      pathToResourceId.set(`./${media.relativePath}`, metadata.id);
      // 记录纯文件名，如 "bg.png"（兼容用户在根目录或直接引用的写法）
      pathToResourceId.set(media.filename, metadata.id);
      pathToResourceId.set(`./${media.filename}`, metadata.id);
    } catch {
      // 单个非关键文件导入失败时跳过，继续后续流程
    }
  }

  // 2. 解析原始 JSON
  let parsedJson: Record<string, unknown>;
  try {
    parsedJson = JSON.parse(rawThemeJson) as Record<string, unknown>;
  } catch {
    throw new Error("THEME_ZIP_INVALID_JSON");
  }

  // 3. 路径重映射函数
  const rewriteReference = (val: string): string => {
    let result = val;
    for (const [refPath, resourceId] of pathToResourceId.entries()) {
      // 匹配 url("...") 或 url('...') 或 url(...)
      const escaped = refPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const urlPattern = new RegExp(`url\\(\\s*["']?${escaped}["']?\\s*\\)`, "gi");
      result = result.replace(urlPattern, `var(--tavern-resource-${resourceId})`);

      // 匹配纯路径引用（如 media.src）
      if (result.trim() === refPath) {
        result = `tavern-resource://${resourceId}`;
      }
    }
    return result;
  };

  // 4. 重映射 media 中的多媒体路径 (如 background video/audio)
  if (parsedJson.media && typeof parsedJson.media === "object") {
    const mediaObj = parsedJson.media as Record<string, Record<string, unknown>>;
    for (const item of Object.values(mediaObj)) {
      if (item && typeof item.src === "string") {
        item.src = rewriteReference(item.src);
      }
    }
  }

  // 5. 重映射 variables 与 customCss 中的相对资源引用
  if (parsedJson.variables && typeof parsedJson.variables === "object") {
    const varObj = parsedJson.variables as Record<string, unknown>;
    for (const [k, v] of Object.entries(varObj)) {
      if (typeof v === "string") {
        varObj[k] = rewriteReference(v);
      }
    }
  }

  if (typeof parsedJson.customCss === "string") {
    parsedJson.customCss = rewriteReference(parsedJson.customCss);
  }

  // 6. 进行严谨的白名单与安全校验
  const validation = validateThemePackage(parsedJson);
  if (!validation.valid || !validation.sanitized) {
    throw new Error(`THEME_VALIDATION_FAILED: ${validation.errors.join("; ")}`);
  }

  const theme = validation.sanitized;
  const themeId = theme.id ?? generateThemeId(theme.name);
  theme.id = themeId;

  return {
    theme,
    themeId,
    importedResourcesCount: pathToResourceId.size > 0 ? mediaFiles.length : 0,
  };
}

/**
 * 将已有主题与其引用的本地资源反向打包导出为一个可分享的 ZIP 压缩包
 */
export async function exportThemeZipPackage(
  theme: CustomThemePackage,
  localResourceService: ILocalResourceService,
): Promise<Blob> {
  const zipFiles: Record<string, Uint8Array> = {};
  const themeClone = JSON.parse(JSON.stringify(theme)) as CustomThemePackage;

  // 收集主题中引用的所有 tavern-resource://r_xxx 与 var(--tavern-resource-r_xxx)
  const resourceIds = new Set<string>();
  const resourcePattern = /r_[a-z0-9_-]{1,80}/g;

  const serialized = JSON.stringify(themeClone);
  let match: RegExpExecArray | null;
  while ((match = resourcePattern.exec(serialized)) !== null) {
    resourceIds.add(match[0]);
  }

  // 读取所有引用的资源 Blob 并放入 ZIP 的 assets/ 目录
  const idToNewPath = new Map<string, string>();
  for (const id of resourceIds) {
    try {
      const objectUrl = await localResourceService.getObjectUrl(id);
      if (!objectUrl) continue;
      const res = await fetch(objectUrl);
      if (!res.ok) continue;
      const blob = await res.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const ext = blob.type.split("/").pop() ?? "bin";
      const filename = `${id}.${ext}`;
      const relativePath = `assets/${filename}`;
      zipFiles[relativePath] = new Uint8Array(arrayBuffer);
      idToNewPath.set(id, `./${relativePath}`);
    } catch {
      // 忽略无法读取的单项资源
    }
  }

  // 在导出的 theme.json 中将 tavern-resource:// 还原为相对路径
  let themeJsonStr = JSON.stringify(themeClone, null, 2);
  for (const [id, newPath] of idToNewPath.entries()) {
    // 还原 media.src
    themeJsonStr = themeJsonStr.replaceAll(`tavern-resource://${id}`, newPath);
    // 还原 var(--tavern-resource-xxx)
    themeJsonStr = themeJsonStr.replaceAll(`var(--tavern-resource-${id})`, `url("${newPath}")`);
  }

  zipFiles["theme.json"] = new TextEncoder().encode(themeJsonStr);

  // 打包为 zip 二进制
  return new Promise((resolve, reject) => {
    zip(zipFiles, (err, data) => {
      if (err) {
        reject(new Error("THEME_ZIP_EXPORT_FAILED"));
        return;
      }
      resolve(new Blob([data], { type: "application/zip" }));
    });
  });
}
