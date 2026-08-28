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

interface AudioProviderPart {
  type: "input_audio";
  input_audio: { data: string; format: "wav" | "mp3" };
}

export interface OpenAiProviderMessage {
  role: string;
  content: string | Array<TextProviderPart | ImageProviderPart | AudioProviderPart> | null;
  name?: string;
  tool_calls?: readonly OpenAiProviderToolCall[];
  tool_call_id?: string;
  /**
   * 思维链内容（DeepSeek/GLM/Qwen 思考模式返回）。
   * DeepSeek 官方要求：携带 tools 的请求必须完整回传历史 reasoning_content，否则 400。
   */
  reasoning_content?: string;
}

export interface OpenAiProviderToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

export interface MediaProjectionDecision {
  readonly providerId: string;
  readonly messageId: string;
  readonly strategy: "text-only" | "direct" | "derived";
  readonly sourceAssetIds: readonly string[];
  readonly projectedAssetIds: readonly string[];
  readonly reason?: "IMAGE_DIRECT" | "AUDIO_DIRECT" | "AUDIO_TRANSCRIPT" | "VIDEO_KEYFRAMES";
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

  const parts: Array<TextProviderPart | ImageProviderPart | AudioProviderPart> = [];
  const sourceAssetIds: string[] = [];
  const projectedAssetIds: string[] = [];
  let usedDirectImage = false;
  let usedDirectAudio = false;
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

    if (part.type === "audio") {
      sourceAssetIds.push(part.assetId);
      if (part.purpose === "model-input") {
        assertModality(target, "audio");
        await appendAudioPart(parts, projectedAssetIds, part.assetId, attachments, target);
        usedDirectAudio = true;
        continue;
      }
      if (hasAudioTranscript) {
        usedAudioTranscript = true;
        continue;
      }
      throw new Error("MULTIMODAL_AUDIO_ATTACHMENT_REQUIRES_TRANSCRIPT");
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
    reason: usedVideoFrames
      ? "VIDEO_KEYFRAMES"
      : usedDirectAudio
        ? "AUDIO_DIRECT"
        : usedDirectImage
          ? "IMAGE_DIRECT"
          : undefined,
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
      supportedMimeTypes: [
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "audio/wav",
        "audio/mpeg",
      ],
      supportsStreaming: true,
      supportsTools: true,
    },
  });
  return result.messages;
}

async function appendImagePart(
  parts: Array<TextProviderPart | ImageProviderPart | AudioProviderPart>,
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

async function appendAudioPart(
  parts: Array<TextProviderPart | ImageProviderPart | AudioProviderPart>,
  projectedAssetIds: string[],
  assetId: string,
  attachments: IAttachmentService,
  target: ProviderProjectionTarget,
): Promise<void> {
  const blob = await attachments.getBlob(assetId);
  const format = blob.type === "audio/wav"
    ? "wav"
    : blob.type === "audio/mpeg"
      ? "mp3"
      : null;
  if (!format) throw new Error(`MULTIMODAL_AUDIO_FORMAT_UNSUPPORTED: ${blob.type || "unknown"}`);
  assertAttachmentConstraints(blob, projectedAssetIds.length + 1, target);
  projectedAssetIds.push(assetId);
  parts.push({
    type: "input_audio",
    input_audio: { data: await blobToBase64(blob), format },
  });
}

function assertAttachmentConstraints(
  blob: Blob,
  nextCount: number,
  target: ProviderProjectionTarget,
): void {
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
  if (
    target.capabilities.maxAttachments !== undefined
    && nextCount > target.capabilities.maxAttachments
  ) {
    throw new Error("MULTIMODAL_PROVIDER_ATTACHMENT_COUNT_EXCEEDED");
  }
}

function assertModality(target: ProviderProjectionTarget, modality: "image" | "audio"): void {
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
        : part.type === "image_url"
          ? { ...part, image_url: { ...part.image_url } }
          : { ...part, input_audio: { ...part.input_audio } })
      : message.content,
    tool_calls: message.tool_calls?.map((call) => ({
      ...call,
      function: { ...call.function },
    })),
  };
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return `data:${blob.type};base64,${await blobToBase64(blob)}`;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
