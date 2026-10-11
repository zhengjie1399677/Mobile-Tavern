import { describe, expect, it } from "vitest";
import {
  describeMultimodalSendRefusal,
  hasAudioTranscriptPart,
  resolveMultimodalSendRefusal,
  type MultimodalSendGuardInput,
} from "../../src/application/useCases/multimodalSendGuards";
import { buildSendFailureAlert } from "../../src/application/useCases/sendFailureDiagnostics";
import type { AgentProviderCapabilities } from "../../src/domain/agents/contracts";
import type { MessageContentPart } from "../../src/domain/messages/messageContent";

const AUDIO_PROVIDER: AgentProviderCapabilities = {
  inputModalities: ["text", "image", "audio"],
  supportedMimeTypes: ["image/png", "audio/wav", "audio/mpeg"],
  supportsStreaming: true,
  supportsTools: true,
};

const TEXT_ONLY_PROVIDER: AgentProviderCapabilities = {
  inputModalities: ["text"],
  supportsStreaming: true,
  supportsTools: false,
};

function guard(overrides: Partial<MultimodalSendGuardInput> = {}): MultimodalSendGuardInput {
  return {
    parts: [],
    hasAudioTranscript: false,
    providerCapabilities: AUDIO_PROVIDER,
    plainAudioProcessorMissing: false,
    plainAudioTranscriptionDisabled: false,
    videoKeyframesMissing: false,
    visionUnsupported: false,
    ...overrides,
  };
}

const PLAIN_AUDIO: MessageContentPart = { type: "audio", assetId: "att_1" };
const VOICE_AUDIO: MessageContentPart = { type: "audio", assetId: "att_2", purpose: "model-input" };

describe("多模态发送前预检", () => {
  it("识别转写文本部件", () => {
    expect(hasAudioTranscriptPart([{ type: "text", text: "[音频转写]\n你好" }])).toBe(true);
    expect(hasAudioTranscriptPart([{ type: "text", text: "你好" }])).toBe(false);
  });

  it("放行没有任何多模态部件的纯文本发送", () => {
    expect(resolveMultimodalSendRefusal(guard())).toBeNull();
  });

  it("普通音频缺转写且未开启 ASR 时拒绝", () => {
    expect(resolveMultimodalSendRefusal(guard({
      parts: [PLAIN_AUDIO],
      plainAudioTranscriptionDisabled: true,
    }))).toEqual({ kind: "audio-transcription-disabled" });
  });

  it("已有转写文本的音频消息可以重发（不因未开启 ASR 被误拒）", () => {
    expect(resolveMultimodalSendRefusal(guard({
      parts: [PLAIN_AUDIO],
      hasAudioTranscript: true,
      plainAudioTranscriptionDisabled: true,
    }))).toBeNull();
  });

  it("Profile 未启用 ASR 处理器时优先报处理器缺失", () => {
    expect(resolveMultimodalSendRefusal(guard({
      parts: [PLAIN_AUDIO],
      plainAudioProcessorMissing: true,
      plainAudioTranscriptionDisabled: true,
    }))).toEqual({ kind: "audio-processor-missing" });
  });

  it("模型原生语音输入按 Provider 能力判定，不看 supportsAudioInput 配置", () => {
    expect(resolveMultimodalSendRefusal(guard({ parts: [VOICE_AUDIO] }))).toBeNull();
    expect(resolveMultimodalSendRefusal(guard({
      parts: [VOICE_AUDIO],
      providerCapabilities: TEXT_ONLY_PROVIDER,
    }))).toEqual({ kind: "modality-unsupported", partType: "audio" });
  });

  it("普通音频不受 Provider 音频能力限制（它走转写而不是 input_audio）", () => {
    expect(resolveMultimodalSendRefusal(guard({
      parts: [PLAIN_AUDIO],
      providerCapabilities: TEXT_ONLY_PROVIDER,
    }))).toBeNull();
  });

  it("图片与视频受视觉能力与关键帧降级约束", () => {
    const image: MessageContentPart = { type: "image", assetId: "att_3" };
    expect(resolveMultimodalSendRefusal(guard({ parts: [image], visionUnsupported: true })))
      .toEqual({ kind: "vision-unsupported" });
    const video: MessageContentPart = { type: "video", assetId: "att_4" };
    expect(resolveMultimodalSendRefusal(guard({ parts: [video], videoKeyframesMissing: true })))
      .toEqual({ kind: "video-fallback-missing" });
    expect(resolveMultimodalSendRefusal(guard({
      parts: [video],
      providerCapabilities: TEXT_ONLY_PROVIDER,
    }))).toEqual({ kind: "modality-unsupported", partType: "video" });
  });

  it("每种拒绝都有可执行的提示文案", () => {
    const kinds = [
      "audio-processor-missing",
      "audio-transcription-disabled",
      "video-fallback-missing",
      "vision-unsupported",
    ] as const;
    for (const kind of kinds) {
      expect(describeMultimodalSendRefusal({ kind }).length).toBeGreaterThan(8);
    }
    expect(describeMultimodalSendRefusal({ kind: "modality-unsupported", partType: "audio" }))
      .toContain("audio");
  });
});

describe("发送失败提示分流", () => {
  it("客户端投影错误给出本地解释，不甩锅给服务端", () => {
    const alert = buildSendFailureAlert("MULTIMODAL_AUDIO_FORMAT_UNSUPPORTED: audio/mp4");
    expect(alert).toContain("wav");
    expect(alert).not.toContain("服务端反馈不支持音频载荷");
  });

  it("缺转写的投影错误指向设置页而不是模型", () => {
    const alert = buildSendFailureAlert("MULTIMODAL_AUDIO_ATTACHMENT_REQUIRES_TRANSCRIPT");
    expect(alert).toContain("ASR");
    expect(alert).not.toContain("服务端");
  });

  it("服务端音频载荷错误保留能力提示，但不点名不存在的模型", () => {
    const alert = buildSendFailureAlert("400 Invalid value: input_audio");
    expect(alert).toContain("服务端反馈不支持音频载荷");
    expect(alert).not.toContain("Gemini 3.8");
    expect(alert).not.toContain("GPT-Audio");
  });

  it("与音频无关的错误只保留原始信息", () => {
    const alert = buildSendFailureAlert("network timeout");
    expect(alert).toBe("发送失败，对话连接异常: network timeout");
  });
});
