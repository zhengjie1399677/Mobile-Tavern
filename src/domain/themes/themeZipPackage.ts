import { unzip } from "fflate";

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
