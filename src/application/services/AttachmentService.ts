import type {
  AttachmentKind,
  AttachmentBackupRecord,
  AttachmentMetadata,
  AttachmentReference,
} from "../../domain/attachments/types";
import {
  deleteCollectableAttachments,
  listAttachmentMetadata,
  loadAttachmentContent,
  loadAttachmentMetadata,
  reconcileAttachmentReferences,
  patchAttachmentReferences,
  saveStagedAttachment,
  addAttachmentStorage,
  deleteUnreferencedAttachments,
  replaceAttachmentStorage,
} from "../../infrastructure/attachments/attachmentStorage";
import type { IAttachmentService, IKernel } from "../serviceContracts";
import { KernelServices } from "../serviceContracts";

const MAX_ATTACHMENT_BYTES: Record<AttachmentKind, number> = {
  image: 20 * 1024 * 1024,
  audio: 100 * 1024 * 1024,
  video: 256 * 1024 * 1024,
  file: 50 * 1024 * 1024,
};
const MAX_TOTAL_ATTACHMENT_BYTES = 1024 * 1024 * 1024;

type DetectedFile = { kind: AttachmentKind; mimeType: string };

export class AttachmentService implements IAttachmentService {
  readonly name = KernelServices.Attachments;
  readonly isCritical = false;
  readonly dependencies = [] as const;

  private readonly objectUrls = new Map<string, string>();
  private destroyed = true;

  init(_kernel: IKernel): void {
    this.destroyed = false;
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    for (const url of this.objectUrls.values()) URL.revokeObjectURL(url);
    this.objectUrls.clear();
  }

  async stageFile(file: File): Promise<AttachmentMetadata> {
    this.assertReady();
    const detected = await detectFile(file);
    if (file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES[detected.kind]) {
      throw new Error("ATTACHMENT_SIZE_INVALID");
    }
    const existing = await listAttachmentMetadata();
    if (existing.reduce((total, item) => total + item.size, 0) + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error("ATTACHMENT_TOTAL_LIMIT");
    }
    this.assertReady();
    const now = Date.now();
    const metadata: AttachmentMetadata = {
      id: `att_${crypto.randomUUID().replace(/-/g, "")}`,
      kind: detected.kind,
      mimeType: detected.mimeType,
      originalName: normalizeName(file.name),
      size: file.size,
      state: "staging",
      referenceIds: [],
      createdAt: now,
      updatedAt: now,
    };
    await saveStagedAttachment(metadata, file);
    return metadata;
  }

  listAttachments(): Promise<AttachmentMetadata[]> {
    this.assertReady();
    return listAttachmentMetadata();
  }

  getMetadata(id: string): Promise<AttachmentMetadata | null> {
    this.assertReady();
    assertAttachmentId(id);
    return loadAttachmentMetadata(id);
  }

  async getBlob(id: string): Promise<Blob> {
    this.assertReady();
    assertAttachmentId(id);
    const blob = await loadAttachmentContent(id);
    if (!blob) throw new Error("ATTACHMENT_NOT_FOUND");
    return blob;
  }

  async getObjectUrl(id: string): Promise<string> {
    this.assertReady();
    assertAttachmentId(id);
    const cached = this.objectUrls.get(id);
    if (cached) return cached;
    const blob = await this.getBlob(id);
    this.assertReady();
    const url = URL.createObjectURL(blob);
    this.objectUrls.set(id, url);
    return url;
  }

  async reconcileReferences(references: readonly AttachmentReference[]): Promise<void> {
    this.assertReady();
    await reconcileAttachmentReferences(references);
  }

  async patchReferences(
    references: readonly AttachmentReference[],
    removedReferenceIds: readonly string[] = [],
  ): Promise<void> {
    this.assertReady();
    await patchAttachmentReferences(references, removedReferenceIds);
  }

  async collectGarbage(cutoffTime: number): Promise<string[]> {
    this.assertReady();
    const removed = await deleteCollectableAttachments(cutoffTime);
    for (const id of removed) {
      const url = this.objectUrls.get(id);
      if (url) URL.revokeObjectURL(url);
      this.objectUrls.delete(id);
    }
    return removed;
  }

  async exportAttachments(assetIds?: readonly string[]): Promise<AttachmentBackupRecord[]> {
    this.assertReady();
    const requestedIds = assetIds ? new Set(assetIds) : null;
    const metadata = (await listAttachmentMetadata())
      .filter(item => !requestedIds || requestedIds.has(item.id));
    if (requestedIds && metadata.length !== requestedIds.size) throw new Error("ATTACHMENT_NOT_FOUND");
    return Promise.all(metadata.map(async item => ({
      id: item.id,
      kind: item.kind,
      mimeType: item.mimeType,
      originalName: item.originalName,
      size: item.size,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      dataBase64: bytesToBase64(new Uint8Array(await (await this.getBlob(item.id)).arrayBuffer())),
    })));
  }

  async importAttachments(records: readonly AttachmentBackupRecord[]): Promise<string[]> {
    this.assertReady();
    const current = await listAttachmentMetadata();
    const currentById = new Map(current.map((item) => [item.id, item]));
    const decoded = this.decodeBackupRecords(records, currentById);
    // 同 ID 已存在时除元数据外还必须校验字节一致，防止备份与库内内容静默分叉。
    for (const item of decoded) {
      const existing = currentById.get(item.metadata.id);
      if (!existing) continue;
      const stored = await loadAttachmentContent(item.metadata.id);
      if (!stored) throw new Error("ATTACHMENT_BACKUP_ID_CONFLICT");
      const storedBytes = new Uint8Array(await stored.arrayBuffer());
      const incomingBytes = new Uint8Array(item.bytes);
      if (storedBytes.byteLength !== incomingBytes.byteLength
        || !storedBytes.every((value, index) => value === incomingBytes[index])) {
        throw new Error("ATTACHMENT_BACKUP_CONTENT_CONFLICT");
      }
    }
    const inserted = decoded.filter((item) => !currentById.has(item.metadata.id));
    const existingBytes = current.reduce((total, item) => total + item.size, 0);
    const insertedBytes = inserted.reduce((total, item) => total + item.metadata.size, 0);
    if (existingBytes + insertedBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error("ATTACHMENT_TOTAL_LIMIT");
    }
    await addAttachmentStorage(inserted);
    return inserted.map((item) => item.metadata.id);
  }

  async discardUnreferencedAttachments(assetIds: readonly string[]): Promise<void> {
    this.assertReady();
    const removed = await deleteUnreferencedAttachments(assetIds);
    for (const id of removed) {
      const url = this.objectUrls.get(id);
      if (url) URL.revokeObjectURL(url);
      this.objectUrls.delete(id);
    }
  }

  async replaceAttachments(
    records: readonly AttachmentBackupRecord[],
    references: readonly AttachmentReference[] = [],
  ): Promise<void> {
    this.assertReady();
    const referenceIdsByAsset = new Map<string, Set<string>>();
    for (const reference of references) {
      for (const assetId of new Set(reference.assetIds)) {
        const referenceIds = referenceIdsByAsset.get(assetId) ?? new Set<string>();
        referenceIds.add(reference.referenceId);
        referenceIdsByAsset.set(assetId, referenceIds);
      }
    }
    const decoded = this.decodeBackupRecords(records).map(({ metadata, bytes }) => {
      const referenceIds = Array.from(referenceIdsByAsset.get(metadata.id) ?? []).sort();
      return {
        metadata: {
          ...metadata,
          state: referenceIds.length > 0 ? "committed" as const : "staging" as const,
          referenceIds,
        },
        bytes,
      };
    });
    const ids = new Set(decoded.map((item) => item.metadata.id));
    if (decoded.reduce((total, item) => total + item.metadata.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error("ATTACHMENT_TOTAL_LIMIT");
    }
    for (const assetId of referenceIdsByAsset.keys()) {
      if (!ids.has(assetId)) throw new Error("ATTACHMENT_NOT_FOUND");
    }
    for (const url of this.objectUrls.values()) URL.revokeObjectURL(url);
    this.objectUrls.clear();
    await replaceAttachmentStorage(decoded);
  }

  private assertReady(): void {
    if (this.destroyed) throw new Error("ATTACHMENT_SERVICE_DESTROYED");
  }

  private decodeBackupRecords(
    records: readonly AttachmentBackupRecord[],
    existingById: ReadonlyMap<string, AttachmentMetadata> = new Map(),
  ): Array<{ metadata: AttachmentMetadata; bytes: ArrayBuffer }> {
    const ids = new Set<string>();
    return records.map((record) => {
      assertAttachmentId(record.id);
      if (ids.has(record.id)) throw new Error("ATTACHMENT_BACKUP_DUPLICATE_ID");
      ids.add(record.id);
      const bytes = base64ToBytes(record.dataBase64);
      if (bytes.byteLength !== record.size || record.size <= 0) {
        throw new Error("ATTACHMENT_BACKUP_SIZE_INVALID");
      }
      const detected = detectSignature(bytes);
      if (!detected || detected.kind !== record.kind || detected.mimeType !== record.mimeType) {
        throw new Error("ATTACHMENT_BACKUP_SIGNATURE_INVALID");
      }
      if (record.size > MAX_ATTACHMENT_BYTES[record.kind]) {
        throw new Error("ATTACHMENT_BACKUP_SIZE_INVALID");
      }
      const existing = existingById.get(record.id);
      if (existing && (
        existing.kind !== record.kind
        || existing.mimeType !== record.mimeType
        || existing.size !== record.size
      )) {
        throw new Error("ATTACHMENT_BACKUP_ID_CONFLICT");
      }
      const now = Date.now();
      return {
        metadata: {
          id: record.id,
          kind: record.kind,
          mimeType: record.mimeType,
          originalName: normalizeName(record.originalName),
          size: record.size,
          state: "staging",
          referenceIds: [],
          createdAt: Number.isFinite(record.createdAt) ? record.createdAt : now,
          updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : now,
        },
        bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      };
    });
  }
}

async function detectFile(file: File): Promise<DetectedFile> {
  const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const detected = detectSignature(bytes);
  if (!detected) throw new Error("ATTACHMENT_SIGNATURE_INVALID");
  const declaredMime = file.type.trim().toLowerCase();
  if (declaredMime && declaredMime !== detected.mimeType) {
    throw new Error("ATTACHMENT_SIGNATURE_INVALID");
  }
  return detected;
}

function detectSignature(bytes: Uint8Array): DetectedFile | null {
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: "image", mimeType: "image/png" };
  }
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return { kind: "image", mimeType: "image/jpeg" };
  if (ascii(bytes, 0, 4) === "GIF8") return { kind: "image", mimeType: "image/gif" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return { kind: "image", mimeType: "image/webp" };
  }
  if (ascii(bytes, 4, 4) === "ftyp") return detectIsoMedia(bytes);
  if (hasPrefix(bytes, [0x49, 0x44, 0x33]) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return { kind: "audio", mimeType: "audio/mpeg" };
  }
  if (ascii(bytes, 0, 4) === "OggS") return { kind: "audio", mimeType: "audio/ogg" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") {
    return { kind: "audio", mimeType: "audio/wav" };
  }
  if (hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: "video", mimeType: "video/webm" };
  return null;
}

function detectIsoMedia(bytes: Uint8Array): DetectedFile {
  const brand = ascii(bytes, 8, 4);
  if (["M4A ", "M4B ", "M4P "].includes(brand)) return { kind: "audio", mimeType: "audio/mp4" };
  return { kind: "video", mimeType: "video/mp4" };
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function normalizeName(name: string): string {
  const normalized = Array.from(name.trim())
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 0x1f && codePoint !== 0x7f;
    })
    .join("");
  return (normalized || "未命名附件").slice(0, 160);
}

function assertAttachmentId(id: string): void {
  if (!/^att_[a-z0-9_-]{1,96}$/.test(id)) throw new Error("ATTACHMENT_ID_INVALID");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error("ATTACHMENT_BACKUP_BASE64_INVALID");
  }
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    throw new Error("ATTACHMENT_BACKUP_BASE64_INVALID");
  }
}
