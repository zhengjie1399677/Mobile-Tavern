import type { AgentProviderCapabilities } from "../../domain/agents/contracts";
import type { Message } from "../../types";
import type { IAttachmentService } from "../serviceContracts";

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

export interface MediaProjectionDecision {
  readonly providerId: string;
  readonly messageId: string;
  readonly strategy: "text-only" | "direct" | "derived";
  readonly sourceAssetIds: readonly string[];
  readonly projectedAssetIds: readonly string[];
  readonly reason?: "IMAGE_DIRECT" | "AUDIO_TRANSCRIPT" | "VIDEO_KEYFRAMES";
}

export interface ProviderProjectionTarget {
  readonly providerId: string;
  readonly capabilities: AgentProviderCapabilities;
}

export interface ProviderProjectionResult {
  readonly messages: OpenAiProviderMessage[];
  readonly decision: MediaProjectionDecision;
}

/**
 * 按 Provider 的声明式能力投影 Content Parts，并返回可持久化的降级决定。
 * 领域消息保持不变，临时 Data URL 仅存在于当前请求内。
 */
export async function projectMessagePartsForProvider(
  messages: readonly OpenAiProviderMessage[],
  message: Message,
  attachments: IAttachmentService,
  target: ProviderProjectionTarget,
): Promise<ProviderProjectionResult> {
  if (message.sender !== "user" || !message.parts) {
    return {
      messages: cloneProviderMessages(messages),
      decision: createTextOnlyDecision(target.providerId, message.id),
    };
  }

  const parts: Array<TextProviderPart | ImageProviderPart> = [];
  const sourceAssetIds: string[] = [];
  const projectedAssetIds: string[] = [];
  let usedDirectImage = false;
  let usedAudioTranscript = false;
  let usedVideoFrames = false;
  const hasAudioTranscript = message.parts.some(part =>
    part.type === "text" && part.text.startsWith("[音频转写]"),
  );

  for (const part of message.parts) {
    if (part.type === "text") {
      if (part.text) parts.push({ type: "text", text: part.text });
      continue;
    }

    if (part.type === "image") {
      assertModality(target, "image");
      sourceAssetIds.push(part.assetId);
      await appendImagePart(parts, projectedAssetIds, part.assetId, attachments, target);
      usedDirectImage = true;
      continue;
    }

    if (part.type === "audio" && hasAudioTranscript) {
      sourceAssetIds.push(part.assetId);
      usedAudioTranscript = true;
      continue;
    }

    if (part.type === "video" && part.frameAssetIds && part.frameAssetIds.length > 0) {
      assertModality(target, "image");
      sourceAssetIds.push(part.assetId);
      parts.push({
        type: "text",
        text: `[视频已降级为 ${part.frameAssetIds.length} 个关键帧]`,
      });
      for (const frameAssetId of part.frameAssetIds) {
        await appendImagePart(parts, projectedAssetIds, frameAssetId, attachments, target);
      }
      usedVideoFrames = true;
      continue;
    }

    if (!target.capabilities.inputModalities.includes(part.type)) {
      throw new Error(`MULTIMODAL_PROVIDER_MODALITY_UNSUPPORTED: ${part.type}`);
    }
    // 当前请求方言尚未定义 audio/video/file 的原生 Content Part，必须显式失败。
    throw new Error(`MULTIMODAL_PART_UNSUPPORTED: ${part.type}`);
  }

  if (projectedAssetIds.length === 0) {
    return {
      messages: cloneProviderMessages(messages),
      decision: usedAudioTranscript
        ? {
            providerId: target.providerId,
            messageId: message.id,
            strategy: "derived",
            sourceAssetIds,
            projectedAssetIds: [],
            reason: "AUDIO_TRANSCRIPT",
          }
        : createTextOnlyDecision(target.providerId, message.id),
    };
  }

  const targetIndex = findLatestUserMessageIndex(messages);
  if (targetIndex < 0) throw new Error("MULTIMODAL_USER_MESSAGE_NOT_FOUND");
  const projectedMessages = messages.map((item, index) => index === targetIndex
    ? { ...item, content: parts }
    : cloneProviderMessage(item));
  const decision: MediaProjectionDecision = {
    providerId: target.providerId,
    messageId: message.id,
    strategy: usedVideoFrames ? "derived" : "direct",
    sourceAssetIds,
    projectedAssetIds,
    reason: usedVideoFrames ? "VIDEO_KEYFRAMES" : usedDirectImage ? "IMAGE_DIRECT" : undefined,
  };
  return { messages: projectedMessages, decision };
}

/** 迁移期 OpenAI-compatible 包装；新调用方应传入已解析 Provider 能力。 */
export async function projectMessagePartsToOpenAi(
  messages: readonly OpenAiProviderMessage[],
  message: Message,
  attachments: IAttachmentService,
): Promise<OpenAiProviderMessage[]> {
  const result = await projectMessagePartsForProvider(messages, message, attachments, {
    providerId: "provider.openai-compatible",
    capabilities: {
      inputModalities: ["text", "image", "audio", "video", "file"],
      supportedMimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
      supportsStreaming: true,
      supportsTools: true,
    },
  });
  return result.messages;
}

async function appendImagePart(
  parts: Array<TextProviderPart | ImageProviderPart>,
  projectedAssetIds: string[],
  assetId: string,
  attachments: IAttachmentService,
  target: ProviderProjectionTarget,
): Promise<void> {
  const blob = await attachments.getBlob(assetId);
  if (!blob.type.startsWith("image/")) throw new Error("MULTIMODAL_IMAGE_MIME_INVALID");
  if (
    target.capabilities.supportedMimeTypes
    && !target.capabilities.supportedMimeTypes.includes(blob.type)
  ) {
    throw new Error(`MULTIMODAL_PROVIDER_MIME_UNSUPPORTED: ${blob.type}`);
  }
  if (
    target.capabilities.maxAttachmentBytes !== undefined
    && blob.size > target.capabilities.maxAttachmentBytes
  ) {
    throw new Error("MULTIMODAL_PROVIDER_ATTACHMENT_TOO_LARGE");
  }
  const nextCount = projectedAssetIds.length + 1;
  if (
    target.capabilities.maxAttachments !== undefined
    && nextCount > target.capabilities.maxAttachments
  ) {
    throw new Error("MULTIMODAL_PROVIDER_ATTACHMENT_COUNT_EXCEEDED");
  }
  projectedAssetIds.push(assetId);
  parts.push({
    type: "image_url",
    image_url: { url: await blobToDataUrl(blob), detail: "auto" },
  });
}

function assertModality(target: ProviderProjectionTarget, modality: "image"): void {
  if (!target.capabilities.inputModalities.includes(modality)) {
    throw new Error(`MULTIMODAL_PROVIDER_MODALITY_UNSUPPORTED: ${modality}`);
  }
}

function findLatestUserMessageIndex(messages: readonly OpenAiProviderMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") return index;
  }
  return -1;
}

function createTextOnlyDecision(providerId: string, messageId: string): MediaProjectionDecision {
  return {
    providerId,
    messageId,
    strategy: "text-only",
    sourceAssetIds: [],
    projectedAssetIds: [],
  };
}

function cloneProviderMessages(
  messages: readonly OpenAiProviderMessage[],
): OpenAiProviderMessage[] {
  return messages.map(cloneProviderMessage);
}

function cloneProviderMessage(message: OpenAiProviderMessage): OpenAiProviderMessage {
  return {
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map((part) => part.type === "text"
        ? { ...part }
        : { ...part, image_url: { ...part.image_url } })
      : message.content,
  };
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
