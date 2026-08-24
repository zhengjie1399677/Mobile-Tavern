import type { IAttachmentService } from "../serviceContracts";
import type { Message } from "../../types";

interface TextProviderPart {
  type: "text";
  text: string;
}

interface ImageProviderPart {
  type: "image_url";
  image_url: { url: string; detail: "auto" };
}

export interface OpenAiProviderMessage {
  role: string;
  content: string | Array<TextProviderPart | ImageProviderPart>;
  name?: string;
}

/**
 * 把领域 Content Parts 投影到 OpenAI-compatible 请求；消息记录本身不保存 Provider 方言。
 */
export async function projectMessagePartsToOpenAi(
  messages: readonly OpenAiProviderMessage[],
  message: Message,
  attachments: IAttachmentService,
): Promise<OpenAiProviderMessage[]> {
  if (message.sender !== "user" || !message.parts) return messages.map(item => ({ ...item }));
  const parts: Array<TextProviderPart | ImageProviderPart> = [];
  for (const part of message.parts) {
    if (part.type === "text") {
      if (part.text) parts.push({ type: "text", text: part.text });
      continue;
    }
    if (part.type !== "image") throw new Error(`MULTIMODAL_PART_UNSUPPORTED: ${part.type}`);
    const blob = await attachments.getBlob(part.assetId);
    if (!blob.type.startsWith("image/")) throw new Error("MULTIMODAL_IMAGE_MIME_INVALID");
    parts.push({
      type: "image_url",
      image_url: { url: await blobToDataUrl(blob), detail: "auto" },
    });
  }
  if (!parts.some(part => part.type === "image_url")) return messages.map(item => ({ ...item }));

  let targetIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      targetIndex = index;
      break;
    }
  }
  if (targetIndex < 0) throw new Error("MULTIMODAL_USER_MESSAGE_NOT_FOUND");
  return messages.map((item, index) => index === targetIndex
    ? { ...item, content: parts }
    : { ...item });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}
