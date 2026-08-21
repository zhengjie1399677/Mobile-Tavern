export type LocalResourceKind = "image" | "video" | "audio";

export interface LocalResourceMetadata {
  id: string;
  name: string;
  kind: LocalResourceKind;
  mimeType: string;
  size: number;
  createdAt: number;
  updatedAt: number;
}

export interface LocalResourceContentRecord {
  id: string;
  blob: Blob;
}
