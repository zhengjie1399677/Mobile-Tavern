import type {
  IKernel,
  ILocalResourceService,
} from "../serviceContracts";
import type {
  LocalResourceKind,
  LocalResourceMetadata,
} from "../../domain/resources/types";
import {
  deleteLocalResource,
  listLocalResourceMetadata,
  loadLocalResourceContent,
  saveLocalResource,
} from "../../infrastructure/resources/localResourceStorage";

const STYLE_ID = "tavern-local-resource-variables";
const RESOURCE_REFERENCE_PREFIX = "tavern-resource://";
const RESOURCE_ID_PATTERN = /^[a-z0-9_-]{1,80}$/;
const MAX_RESOURCE_BYTES: Record<LocalResourceKind, number> = {
  image: 20 * 1024 * 1024,
  audio: 100 * 1024 * 1024,
  video: 256 * 1024 * 1024,
};
const MAX_TOTAL_RESOURCE_BYTES = 512 * 1024 * 1024;

export class LocalResourceService implements ILocalResourceService {
  name = "localResources";
  isCritical = false;
  dependencies = [] as const;

  private objectUrls = new Map<string, string>();
  private metadata = new Map<string, LocalResourceMetadata>();
  private destroyed = false;

  async init(_kernel: IKernel, signal?: AbortSignal): Promise<void> {
    this.destroyed = false;
    const resources = await listLocalResourceMetadata();
    if (signal?.aborted) return;
    this.metadata = new Map(resources.map(resource => [resource.id, resource]));

    // 图片会直接用于主题 CSS，因此启动时恢复其稳定变量。音视频保持按需加载，避免大文件常驻。
    for (const resource of resources) {
      if (resource.kind !== "image" || signal?.aborted) continue;
      try {
        await this.getObjectUrl(resource.id);
      } catch {
        // 元数据存在但文件字节损坏时跳过单项，不能让整个非关键资源服务启动失败。
      }
    }
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    for (const url of this.objectUrls.values()) URL.revokeObjectURL(url);
    this.objectUrls.clear();
    this.metadata.clear();
    if (typeof document !== "undefined") document.getElementById(STYLE_ID)?.remove();
  }

  async listResources(): Promise<LocalResourceMetadata[]> {
    const resources = await listLocalResourceMetadata();
    this.metadata = new Map(resources.map(resource => [resource.id, resource]));
    return resources;
  }

  async importFile(file: File): Promise<LocalResourceMetadata> {
    this.assertReady();
    const kind = detectKind(file);
    if (file.size <= 0 || file.size > MAX_RESOURCE_BYTES[kind]) {
      throw new Error("LOCAL_RESOURCE_SIZE_INVALID");
    }
    const storedResources = await listLocalResourceMetadata();
    const storedBytes = storedResources.reduce((total, resource) => total + resource.size, 0);
    if (storedBytes + file.size > MAX_TOTAL_RESOURCE_BYTES) {
      throw new Error("LOCAL_RESOURCE_TOTAL_LIMIT");
    }
    const now = Date.now();
    const id = createResourceId();
    const metadata: LocalResourceMetadata = {
      id,
      name: normalizeName(file.name),
      kind,
      mimeType: normalizeMimeType(file.type, kind),
      size: file.size,
      createdAt: now,
      updatedAt: now,
    };
    await saveLocalResource(metadata, file);
    this.assertReady();
    this.metadata.set(id, metadata);
    const url = URL.createObjectURL(file);
    this.objectUrls.set(id, url);
    this.renderCssVariables();
    return metadata;
  }

  async deleteResource(id: string): Promise<void> {
    this.assertResourceId(id);
    await deleteLocalResource(id);
    const url = this.objectUrls.get(id);
    if (url) URL.revokeObjectURL(url);
    this.objectUrls.delete(id);
    this.metadata.delete(id);
    this.renderCssVariables();
  }

  async getObjectUrl(id: string): Promise<string> {
    this.assertReady();
    this.assertResourceId(id);
    const cached = this.objectUrls.get(id);
    if (cached) return cached;
    const blob = await loadLocalResourceContent(id);
    if (!blob) throw new Error("LOCAL_RESOURCE_NOT_FOUND");
    this.assertReady();
    const url = URL.createObjectURL(blob);
    this.objectUrls.set(id, url);
    this.renderCssVariables();
    return url;
  }

  getResourceReference(id: string): string {
    this.assertResourceId(id);
    return `${RESOURCE_REFERENCE_PREFIX}${id}`;
  }

  async resolveResourceReference(reference: string): Promise<string> {
    if (!reference.startsWith(RESOURCE_REFERENCE_PREFIX)) {
      throw new Error("LOCAL_RESOURCE_REFERENCE_INVALID");
    }
    const id = reference.slice(RESOURCE_REFERENCE_PREFIX.length);
    this.assertResourceId(id);
    return this.getObjectUrl(id);
  }

  getCssReference(id: string): string {
    this.assertResourceId(id);
    return `var(--tavern-resource-${id})`;
  }

  private renderCssVariables(): void {
    if (typeof document === "undefined") return;
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.setAttribute("data-tavern-local-resources", "true");
      document.head.appendChild(style);
    }
    const declarations = Array.from(this.objectUrls.entries())
      .filter(([id]) => this.metadata.has(id))
      .map(([id, url]) => `  --tavern-resource-${id}: url("${url}");`)
      .join("\n");
    style.textContent = `:root {\n${declarations}\n}`;
  }

  private assertReady(): void {
    if (this.destroyed) throw new Error("LOCAL_RESOURCE_SERVICE_DESTROYED");
  }

  private assertResourceId(id: string): void {
    if (!RESOURCE_ID_PATTERN.test(id)) throw new Error("LOCAL_RESOURCE_ID_INVALID");
  }
}

function detectKind(file: File): LocalResourceKind {
  const mimeType = file.type.toLowerCase();
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  if (mimeType === "image/svg+xml" || extension === "svg") {
    throw new Error("LOCAL_RESOURCE_TYPE_UNSUPPORTED");
  }
  if (mimeType.startsWith("image/") && mimeType !== "image/svg+xml") return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";

  if (["png", "jpg", "jpeg", "webp", "gif", "avif"].includes(extension)) return "image";
  if (["mp4", "webm", "mov", "m4v"].includes(extension)) return "video";
  if (["mp3", "m4a", "aac", "wav", "ogg", "flac"].includes(extension)) return "audio";
  throw new Error("LOCAL_RESOURCE_TYPE_UNSUPPORTED");
}

function normalizeMimeType(mimeType: string, kind: LocalResourceKind): string {
  const normalized = mimeType.trim().toLowerCase();
  return normalized || `${kind}/unknown`;
}

function normalizeName(name: string): string {
  const normalized = name.trim().replace(/[\u0000-\u001F\u007F]/g, "");
  return (normalized || "未命名资源").slice(0, 160);
}

function createResourceId(): string {
  return `r_${crypto.randomUUID().replace(/-/g, "")}`;
}
