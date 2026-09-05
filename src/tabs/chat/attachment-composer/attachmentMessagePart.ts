import type { MessageContentPart } from "../../../domain/messages/messageContent";
import type { PendingAttachment } from "./PendingAttachmentStrip";

export function toMessageAttachmentPart(item: PendingAttachment): MessageContentPart {
  const { metadata } = item;
  if (metadata.kind === "image") return { type: "image", assetId: metadata.id };
  if (metadata.kind === "audio") {
    return {
      type: "audio",
      assetId: metadata.id,
      purpose: item.purpose === "model-input" ? "model-input" : undefined,
    };
  }
  if (metadata.kind === "video") return { type: "video", assetId: metadata.id };
  return { type: "file", assetId: metadata.id, displayName: metadata.originalName };
}
