import { describe, expect, it } from "vitest";
import {
  projectMessagePartsForProvider,
  projectMessagePartsToOpenAi,
} from "../../src/application/useCases/multimodalProviderProjection";
import type { IAttachmentService } from "../../src/application/serviceContracts";
import type { Message } from "../../src/types";

function attachmentService(blob: Blob): IAttachmentService {
  return {
    name: "attachments",
    init: () => undefined,
    stageFile: async () => { throw new Error("not used"); },
    listAttachments: async () => [],
    getMetadata: async () => null,
    getBlob: async () => blob,
    getObjectUrl: async () => "blob:test",
    reconcileReferences: async () => undefined,
    patchReferences: async () => undefined,
    collectGarbage: async () => [],
    exportAttachments: async () => [],
    replaceAttachments: async () => undefined,
  };
}

describe("多模态 Provider 投影", () => {
  it("只改写最后一条 user 消息并生成 OpenAI image_url 数据", async () => {
    const messages = [
      { role: "system", content: "system" },
      { role: "user", content: "旧问题" },
      { role: "assistant", content: "旧回答" },
      { role: "user", content: "看看这张图" },
    ] as const;
    const message: Message = {
      id: "message-1",
      sender: "user",
      content: "看看这张图",
      timestamp: 1,
      contentVersion: 2,
      parts: [
        { type: "text", text: "看看这张图" },
        { type: "image", assetId: "att_image1", alt: "风景" },
      ],
    };

    const projected = await projectMessagePartsToOpenAi(
      messages,
      message,
      attachmentService(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })),
    );

    expect(projected.slice(0, 3)).toEqual(messages.slice(0, 3));
    expect(projected[3]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "看看这张图" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AQID", detail: "auto" } },
      ],
    });
  });

  it("把明确标记为模型输入的 WAV 音频投影为 OpenAI input_audio", async () => {
    const message: Message = {
      id: "message-2",
      sender: "user",
      content: "",
      timestamp: 1,
      contentVersion: 2,
      parts: [{ type: "audio", assetId: "att_audio1", purpose: "model-input" }],
    };

    const result = await projectMessagePartsForProvider(
      [{ role: "user", content: "" }],
      message,
      attachmentService(new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" })),
      {
        providerId: "provider.audio",
        capabilities: {
          inputModalities: ["text", "audio"],
          supportedMimeTypes: ["audio/wav", "audio/mpeg"],
          supportsStreaming: true,
          supportsTools: false,
        },
      },
    );

    expect(result.messages[0].content).toEqual([{
      type: "input_audio",
      input_audio: { data: "AQID", format: "wav" },
    }]);
    expect(result.decision).toEqual({
      providerId: "provider.audio",
      messageId: "message-2",
      strategy: "direct",
      sourceAssetIds: ["att_audio1"],
      projectedAssetIds: ["att_audio1"],
      reason: "AUDIO_DIRECT",
    });
  });

  it("不会把普通音频附件误当作模型语音输入", async () => {
    const message: Message = {
      id: "message-attachment-audio",
      sender: "user",
      content: "",
      timestamp: 1,
      contentVersion: 2,
      parts: [{ type: "audio", assetId: "att_audio1" }],
    };

    await expect(projectMessagePartsToOpenAi(
      [{ role: "user", content: "" }],
      message,
      attachmentService(new Blob([], { type: "audio/wav" })),
    )).rejects.toThrow("MULTIMODAL_AUDIO_ATTACHMENT_REQUIRES_TRANSCRIPT");
  });

  it("记录 Provider、原始资产与视频关键帧降级决定", async () => {
    const message: Message = {
      id: "message-video",
      sender: "user",
      content: "分析视频",
      timestamp: 1,
      contentVersion: 2,
      parts: [
        { type: "text", text: "分析视频" },
        {
          type: "video",
          assetId: "att_video1",
          frameAssetIds: ["att_frame1", "att_frame2"],
        },
      ],
    };
    const service = attachmentService(
      new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }),
    );

    const result = await projectMessagePartsForProvider(
      [{ role: "user", content: "分析视频" }],
      message,
      service,
      {
        providerId: "provider.vision",
        capabilities: {
          inputModalities: ["text", "image"],
          supportedMimeTypes: ["image/jpeg"],
          supportsStreaming: true,
          supportsTools: false,
        },
      },
    );

    expect(result.decision).toEqual({
      providerId: "provider.vision",
      messageId: "message-video",
      strategy: "derived",
      sourceAssetIds: ["att_video1"],
      projectedAssetIds: ["att_frame1", "att_frame2"],
      reason: "VIDEO_KEYFRAMES",
    });
    expect(result.messages[0].content).toEqual([
      { type: "text", text: "分析视频" },
      { type: "text", text: "[视频已降级为 2 个关键帧]" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AQID", detail: "auto" } },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AQID", detail: "auto" } },
    ]);
  });

  it("按声明式 Provider 能力拒绝未启用的图片输入", async () => {
    const message: Message = {
      id: "message-image-rejected",
      sender: "user",
      content: "图片",
      timestamp: 1,
      contentVersion: 2,
      parts: [{ type: "image", assetId: "att_image1" }],
    };

    await expect(projectMessagePartsForProvider(
      [{ role: "user", content: "图片" }],
      message,
      attachmentService(new Blob([], { type: "image/png" })),
      {
        providerId: "provider.text",
        capabilities: {
          inputModalities: ["text"],
          supportsStreaming: true,
          supportsTools: false,
        },
      },
    )).rejects.toThrow("MULTIMODAL_PROVIDER_MODALITY_UNSUPPORTED: image");
  });
});
