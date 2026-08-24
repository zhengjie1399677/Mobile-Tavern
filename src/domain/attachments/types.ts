export type AttachmentKind = "image" | "audio" | "video" | "file";

export type AttachmentState = "staging" | "committed" | "orphaned";

/**
 * 附件索引元数据。大体积字节必须存放在独立 contents Store，不能混入消息记录。
 */
export interface AttachmentMetadata {
  id: string;
  kind: AttachmentKind;
  mimeType: string;
  originalName: string;
  size: number;
  state: AttachmentState;
  referenceIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AttachmentContentRecord {
  id: string;
  bytes: ArrayBuffer;
  mimeType: string;
}

export interface AttachmentReference {
  referenceId: string;
  assetIds: string[];
}

/** JSON 备份记录；恢复时引用状态由消息快照重新计算，不信任备份中的反向索引。 */
export interface AttachmentBackupRecord {
  id: string;
  kind: AttachmentKind;
  mimeType: string;
  originalName: string;
  size: number;
  createdAt: number;
  updatedAt: number;
  dataBase64: string;
}
