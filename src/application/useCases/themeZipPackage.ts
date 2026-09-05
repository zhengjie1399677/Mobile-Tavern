import { zip } from "fflate";
import { unpackThemeZip } from "../../domain/themes/themeZipPackage";
import { generateThemeId, validateThemePackage, type CustomThemePackage } from "../../utils/themePackage";
import type { ILocalResourceService } from "../serviceContracts";

export interface ImportThemeZipResult {
  theme: CustomThemePackage;
  themeId: string;
  importedResourcesCount: number;
}

/** 仅转换字符串值，JSON 引号与转义由序列化器处理。 */
function mapStrings(value: unknown, transform: (text: string) => string): unknown {
  if (typeof value === "string") return transform(value);
  if (Array.isArray(value)) return value.map(item => mapStrings(item, transform));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, transform)]));
  }
  return value;
}

/** 资源写入与主题验证由应用层编排；失败时回收本次新建资源。 */
export async function importThemeZipPackage(
  input: Uint8Array | ArrayBuffer,
  resources: ILocalResourceService,
): Promise<ImportThemeZipResult> {
  const { rawThemeJson, themeJsonPath, mediaFiles } = await unpackThemeZip(input);
  let parsed: unknown;
  try { parsed = JSON.parse(rawThemeJson); } catch { throw new Error("THEME_ZIP_INVALID_JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("THEME_ZIP_INVALID_JSON");
  const importedIds: string[] = [];
  const references = new Map<string, string>();
  const themeDirectory = themeJsonPath.slice(0, themeJsonPath.lastIndexOf("/") + 1);
  try {
    for (const media of mediaFiles) {
      const metadata = await resources.importFile(media.file);
      importedIds.push(metadata.id);
      const relative = media.relativePath.startsWith(themeDirectory)
        ? media.relativePath.slice(themeDirectory.length) : media.relativePath;
      for (const path of [media.relativePath, relative, media.filename]) {
        references.set(path, metadata.id);
        references.set(`./${path}`, metadata.id);
      }
    }
    const rewritten = mapStrings(parsed, value => {
      const resourceId = references.get(value.trim());
      if (resourceId) return resources.getResourceReference(resourceId);
      return value.replace(/url\(\s*["']?([^"')]+?)["']?\s*\)/gi, (match, path: string) => {
        const id = references.get(path.trim());
        return id ? resources.getCssReference(id) : match;
      });
    });
    const validation = validateThemePackage(rewritten);
    if (!validation.valid || !validation.sanitized) {
      throw new Error(`THEME_VALIDATION_FAILED: ${validation.errors.join("; ")}`);
    }
    const theme = validation.sanitized;
    const themeId = theme.id ?? generateThemeId(theme.name);
    return { theme: { ...theme, id: themeId }, themeId, importedResourcesCount: importedIds.length };
  } catch (error) {
    await Promise.all(importedIds.map(id => resources.deleteResource(id)));
    throw error;
  }
}

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
  "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/wav": "wav",
  "audio/ogg": "ogg", "audio/flac": "flac",
};

/** 完整导出引用资源；缺失资源必须失败，避免产生不可恢复的分享包。 */
export async function exportThemeZipPackage(theme: CustomThemePackage, resources: ILocalResourceService): Promise<Blob> {
  const ids = new Set<string>();
  mapStrings(theme, value => {
    for (const match of value.matchAll(/(?:tavern-resource:\/\/|--tavern-resource-)(r_[a-z0-9_-]{1,80})/g)) ids.add(match[1]);
    return value;
  });
  const files: Record<string, Uint8Array> = {};
  const paths = new Map<string, string>();
  for (const id of ids) {
    const url = await resources.getObjectUrl(id);
    if (!url) throw new Error(`THEME_ZIP_RESOURCE_MISSING:${id}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`THEME_ZIP_RESOURCE_MISSING:${id}`);
    const blob = await response.blob();
    const ext = MIME_EXTENSIONS[blob.type];
    if (!ext) throw new Error(`THEME_ZIP_RESOURCE_TYPE:${blob.type}`);
    const path = `assets/${id}.${ext}`;
    files[path] = new Uint8Array(await blob.arrayBuffer());
    paths.set(id, `./${path}`);
  }
  const exported = mapStrings(theme, value => value
    .replace(/tavern-resource:\/\/(r_[a-z0-9_-]{1,80})/g, (match, id: string) => paths.get(id) ?? match)
    .replace(/var\(--tavern-resource-(r_[a-z0-9_-]{1,80})\)/g,
      (match, id: string) => paths.has(id) ? `url("${paths.get(id)}")` : match));
  files["theme.json"] = new TextEncoder().encode(JSON.stringify(exported, null, 2));
  return new Promise((resolve, reject) => zip(files, (error, bytes) => {
    if (error) reject(new Error("THEME_ZIP_EXPORT_FAILED"));
    else resolve(new Blob([bytes], { type: "application/zip" }));
  }));
}
