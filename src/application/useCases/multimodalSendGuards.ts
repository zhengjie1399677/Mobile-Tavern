import type { AgentProviderCapabilities } from "../../domain/agents/contracts";
import type { MessageContentPart } from "../../domain/messages/messageContent";

/** 音频转写文本部件的前缀：投影层据此判断普通音频是否已有转写。 */
export const AUDIO_TRANSCRIPT_PREFIX = "[音频转写]";

export function hasAudioTranscriptPart(parts: readonly MessageContentPart[]): boolean {
  return parts.some((part) => part.type === "text" && part.text.startsWith(AUDIO_TRANSCRIPT_PREFIX));
}

export type MultimodalSendRefusal =
  | { kind: "audio-processor-missing" }
  | { kind: "audio-transcription-disabled" }
  | { kind: "video-fallback-missing" }
  | { kind: "modality-unsupported"; partType: string };

export interface MultimodalSendGuardInput {
  /** 待投影的非文本部件（附件或已排队用户消息的媒体部件）。 */
  parts: readonly MessageContentPart[];
  /**
   * 同一消息里是否已有 `[音频转写]` 文本部件。
   * 必须由调用方从**完整**部件列表（含文本）算出：`parts` 已经滤掉文本，
   * 在这里重新查找永远为假，会把「已有转写、只是重发」的音频误判成缺转写。
   */
  hasAudioTranscript?: boolean;
  providerCapabilities: AgentProviderCapabilities;
  /** Agent Profile 未启用音频 ASR 处理器（仅在 Agent 链路且可查处理器时有意义）。 */
  plainAudioProcessorMissing: boolean;
  /** 普通音频附件既没有转写文本、也没有开启 OpenAI 文件转写 —— 投影一定会失败。 */
  plainAudioTranscriptionDisabled: boolean;
  /** Agent Profile 未启用视频关键帧处理器。 */
  videoKeyframesMissing: boolean;
}

/**
 * 落库前的多模态预检：返回拒绝原因，或 null 表示可以发送。
 *
 * 存在的意义是**时序**：投影（projectMessagePartsForProvider）在消息落库之后才执行，
 * 它抛错会留下一条永远发不出去、重发还会再炸的用户消息。所以可判定的拒绝必须提前到这里。
 * 这里只看客户端能确定的条件，不预设「服务端是否支持音频」，避免拦掉服务端其实接受的载荷。
 */
export function resolveMultimodalSendRefusal(
  input: MultimodalSendGuardInput,
): MultimodalSendRefusal | null {
  const { parts, providerCapabilities } = input;
  const plainAudioParts = parts.filter((part) => part.type === "audio" && part.purpose !== "model-input");

  if (plainAudioParts.length > 0) {
    if (input.plainAudioProcessorMissing) return { kind: "audio-processor-missing" };
    if (input.plainAudioTranscriptionDisabled && input.hasAudioTranscript !== true) {
      return { kind: "audio-transcription-disabled" };
    }
  }

  const hasVideo = parts.some((part) => part.type === "video");
  if (hasVideo && input.videoKeyframesMissing) return { kind: "video-fallback-missing" };

  const unsupportedPart = parts.find((part) => {
    if (part.type === "audio") {
      return part.purpose === "model-input"
        && !providerCapabilities.inputModalities.includes("audio");
    }
    const requiredModality = part.type === "video" ? "image" : part.type;
    return !providerCapabilities.inputModalities.includes(requiredModality);
  });
  if (unsupportedPart) return { kind: "modality-unsupported", partType: unsupportedPart.type };

  return null;
}

export function describeMultimodalSendRefusal(refusal: MultimodalSendRefusal): string {
  switch (refusal.kind) {
    case "audio-processor-missing":
      return "当前 Agent Profile 未启用音频 ASR 降级，无法把音频发送给当前 Provider。";
    case "audio-transcription-disabled":
      return "发送音频前需要启用 OpenAI ASR 文件转写。请在 设置 → 语音 中启用后再发送。";
    case "video-fallback-missing":
      return "当前 Agent Profile 未启用视频关键帧降级，无法把视频发送给当前 Provider。";
    case "modality-unsupported":
      return `当前 Provider 未声明 ${refusal.partType} 输入能力，请切换 Provider 或配置媒体降级。`;
    default:
      return "当前消息的多模态载荷无法发送，请检查附件与 Provider 配置。";
  }
}
