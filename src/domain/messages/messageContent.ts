export interface TextMessageContentPart {
  readonly type: "text";
  readonly text: string;
}

export interface ImageMessageContentPart {
  readonly type: "image";
  readonly assetId: string;
  readonly alt?: string;
}

export interface AudioMessageContentPart {
  readonly type: "audio";
  readonly assetId: string;
  readonly transcriptAssetId?: string;
}

export interface VideoMessageContentPart {
  readonly type: "video";
  readonly assetId: string;
  readonly transcriptAssetId?: string;
  readonly frameAssetIds?: readonly string[];
}

export interface FileMessageContentPart {
  readonly type: "file";
  readonly assetId: string;
  readonly displayName: string;
}

export type MessageContentPart =
  | TextMessageContentPart
  | ImageMessageContentPart
  | AudioMessageContentPart
  | VideoMessageContentPart
  | FileMessageContentPart;

const ATTACHMENT_ID_PATTERN = /^att_[a-z0-9_-]{1,96}$/;

function assertAttachmentId(id: string): void {
  if (!ATTACHMENT_ID_PATTERN.test(id)) {
    throw new Error(`MESSAGE_ATTACHMENT_ID_INVALID: ${id}`);
  }
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

/** 在领域边界验证并复制 Content Parts，避免外部可变引用进入消息记录。 */
export function normalizeMessageContentParts(
  parts: readonly MessageContentPart[],
): MessageContentPart[] {
  if (parts.length === 0) throw new Error("MESSAGE_CONTENT_EMPTY");

  const normalized = parts.map((part): MessageContentPart => {
    switch (part.type) {
      case "text":
        return { type: "text", text: part.text };
      case "image":
        assertAttachmentId(part.assetId);
        return {
          type: "image",
          assetId: part.assetId,
          alt: normalizeOptionalText(part.alt),
        };
      case "audio":
        assertAttachmentId(part.assetId);
        if (part.transcriptAssetId) assertAttachmentId(part.transcriptAssetId);
        return {
          type: "audio",
          assetId: part.assetId,
          transcriptAssetId: part.transcriptAssetId,
        };
      case "video":
        assertAttachmentId(part.assetId);
        if (part.transcriptAssetId) assertAttachmentId(part.transcriptAssetId);
        for (const frameId of part.frameAssetIds ?? []) assertAttachmentId(frameId);
        return {
          type: "video",
          assetId: part.assetId,
          transcriptAssetId: part.transcriptAssetId,
          frameAssetIds: part.frameAssetIds ? [...part.frameAssetIds] : undefined,
        };
      case "file": {
        assertAttachmentId(part.assetId);
        const displayName = part.displayName.trim();
        if (!displayName) throw new Error("MESSAGE_FILE_DISPLAY_NAME_INVALID");
        return { type: "file", assetId: part.assetId, displayName };
      }
    }
  });

  if (
    normalized.every((part) => part.type === "text" && part.text.length === 0)
  ) {
    throw new Error("MESSAGE_CONTENT_EMPTY");
  }
  return normalized;
}

/** 提取兼容旧聊天、Prompt、摘要和记忆链路所需的纯文本投影。 */
export function getMessageContentText(parts: readonly MessageContentPart[]): string {
  return parts
    .filter((part): part is TextMessageContentPart => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

/** 编辑兼容文本投影时同步更新唯一权威 Content Parts，附件原位保留。 */
export function replaceMessageText(
  parts: readonly MessageContentPart[],
  text: string,
): MessageContentPart[] {
  const normalized = normalizeMessageContentParts(parts);
  const next: MessageContentPart[] = [];
  let textInserted = false;
  for (const part of normalized) {
    if (part.type !== "text") {
      next.push(part);
      continue;
    }
    if (!textInserted && text.length > 0) {
      next.push({ type: "text", text });
      textInserted = true;
    }
  }
  if (!textInserted && text.length > 0) next.unshift({ type: "text", text });
  if (next.length === 0) throw new Error("MESSAGE_CONTENT_EMPTY");
  return next;
}

/** 返回消息直接或派生引用的全部附件 ID，保持首次出现顺序并去重。 */
export function collectMessageAssetIds(
  parts: readonly MessageContentPart[],
): string[] {
  if (parts.length === 0) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | undefined) => {
    if (!id || seen.has(id)) return;
    assertAttachmentId(id);
    seen.add(id);
    ids.push(id);
  };

  for (const part of normalizeMessageContentParts(parts)) {
    if (part.type === "text") continue;
    add(part.assetId);
    if (part.type === "audio" || part.type === "video") {
      add(part.transcriptAssetId);
    }
    if (part.type === "video") {
      for (const frameId of part.frameAssetIds ?? []) add(frameId);
    }
  }
  return ids;
}
