import { describe, expect, it } from "vitest";
import {
  collectMessageAssetIds,
  getMessageContentText,
  normalizeMessageContentParts,
  replaceMessageText,
  type MessageContentPart,
} from "../../src/domain/messages/messageContent";
import {
  fromStoredMessageRecord,
  getStoredMessageText,
  toStoredMessageRecord,
  type StoredChatMessageRecord,
} from "../../src/infrastructure/storage/messageRecord";
import type { Message } from "../../src/types";

const baseRecord = {
  id: "message-1",
  sessionId: "session-1",
  role: "user",
  createdAt: 1,
  turnIndex: 0,
  tags: [] as string[],
  extractSource: "none",
} as const;

describe("Message Content V2", () => {
  it("保留模型原生语音用途，同时让旧音频消息继续按普通附件解释", () => {
    expect(normalizeMessageContentParts([
      { type: "audio", assetId: "att_voice", purpose: "model-input" },
      { type: "audio", assetId: "att_music" },
    ])).toEqual([
      { type: "audio", assetId: "att_voice", purpose: "model-input", transcriptAssetId: undefined },
      { type: "audio", assetId: "att_music", purpose: undefined, transcriptAssetId: undefined },
    ]);
  });
  it("V1 消息没有 Content Parts 时附件引用集合为空", () => {
    expect(collectMessageAssetIds([])).toEqual([]);
  });
  it("把 V1 string 记录无损读取为旧文本消息", () => {
    const message = fromStoredMessageRecord({
      ...baseRecord,
      content: "旧消息",
    });

    expect(message.content).toBe("旧消息");
    expect(message.contentVersion).toBeUndefined();
    expect(message.parts).toBeUndefined();
  });

  it("把 V2 Content Parts 读取为权威 parts 和兼容文本投影", () => {
    const parts: MessageContentPart[] = [
      { type: "text", text: "观察这张图" },
      { type: "image", assetId: "att_image_1", alt: "山谷" },
      { type: "audio", assetId: "att_audio_1", transcriptAssetId: "att_text_1" },
      {
        type: "video",
        assetId: "att_video_1",
        transcriptAssetId: "att_text_2",
        frameAssetIds: ["att_frame_1", "att_frame_2"],
      },
    ];
    const record: StoredChatMessageRecord = {
      ...baseRecord,
      contentVersion: 2,
      content: parts,
    };

    const message = fromStoredMessageRecord(record);

    expect(message.content).toBe("观察这张图");
    expect(message.contentVersion).toBe(2);
    expect(message.parts).toEqual(parts);
    expect(getStoredMessageText(record)).toBe("观察这张图");
    expect(collectMessageAssetIds(parts)).toEqual([
      "att_image_1",
      "att_audio_1",
      "att_text_1",
      "att_video_1",
      "att_text_2",
      "att_frame_1",
      "att_frame_2",
    ]);
  });

  it("V2 写入只保存 Content Parts，不并列保存派生文本字段", () => {
    const message: Message = {
      id: "message-2",
      sender: "user",
      content: "修改后的说明",
      contentVersion: 2,
      parts: [
        { type: "text", text: "原说明" },
        { type: "image", assetId: "att_image_2" },
      ],
      timestamp: 2,
    };

    const stored = toStoredMessageRecord("session-1", message, 1);

    expect(stored.contentVersion).toBe(2);
    expect(stored.content).toEqual([
      { type: "text", text: "修改后的说明" },
      { type: "image", assetId: "att_image_2" },
    ]);
    expect(Object.prototype.hasOwnProperty.call(stored, "parts")).toBe(false);
    expect(getStoredMessageText(stored)).toBe("修改后的说明");
  });

  it("编辑文本时保留附件顺序并收口为单个文本 Part", () => {
    const original: MessageContentPart[] = [
      { type: "image", assetId: "att_image_1" },
      { type: "text", text: "第一段" },
      { type: "text", text: "第二段" },
      { type: "file", assetId: "att_file_1", displayName: "说明.pdf" },
    ];

    const updated = replaceMessageText(original, "新说明");

    expect(updated).toEqual([
      { type: "image", assetId: "att_image_1" },
      { type: "text", text: "新说明" },
      { type: "file", assetId: "att_file_1", displayName: "说明.pdf" },
    ]);
    expect(getMessageContentText(updated)).toBe("新说明");
  });

  it("拒绝非法或空的 V2 内容，避免不可重建引用进入存储", () => {
    expect(() => toStoredMessageRecord("session-1", {
      id: "message-invalid",
      sender: "user",
      content: "",
      contentVersion: 2,
      parts: [{ type: "image", assetId: "../escape" }],
      timestamp: 3,
    }, 2)).toThrow("MESSAGE_ATTACHMENT_ID_INVALID");

    expect(() => toStoredMessageRecord("session-1", {
      id: "message-empty",
      sender: "user",
      content: "",
      contentVersion: 2,
      parts: [],
      timestamp: 4,
    }, 3)).toThrow("MESSAGE_CONTENT_EMPTY");
  });
});
