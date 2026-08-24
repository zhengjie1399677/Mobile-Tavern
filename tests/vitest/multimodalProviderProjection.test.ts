import { describe, expect, it } from "vitest";
import { projectMessagePartsToOpenAi } from "../../src/application/useCases/multimodalProviderProjection";
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

  it("明确拒绝尚未定义 Provider 投影的音频，不静默丢弃", async () => {
    const message: Message = {
      id: "message-2",
      sender: "user",
      content: "",
      timestamp: 1,
      contentVersion: 2,
      parts: [{ type: "audio", assetId: "att_audio1" }],
    };

    await expect(projectMessagePartsToOpenAi(
      [{ role: "user", content: "" }],
      message,
      attachmentService(new Blob()),
    )).rejects.toThrow("MULTIMODAL_PART_UNSUPPORTED");
  });
});
