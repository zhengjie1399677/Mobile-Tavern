import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AttachmentPicker } from "../../src/tabs/chat/attachment-composer/AttachmentPicker";
import {
  PendingAttachmentStrip,
  type PendingAttachment,
} from "../../src/tabs/chat/attachment-composer/PendingAttachmentStrip";
import { MessageAttachmentParts } from "../../src/tabs/chat/message-bubble/MessageAttachmentParts";
import { unifiedAppStore } from "../../src/UnifiedAppContext";
import type { IAttachmentService } from "../../src/application/serviceContracts";
import type { IKernelService } from "../../src/kernel/types";

describe("多模态附件输入", () => {
  it("从统一按钮展开图片、视频与音频三个独立入口", () => {
    const onSelect = vi.fn();
    render(<AttachmentPicker disabled={false} selectedCount={0} maxCount={4} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "添加附件" }));
    expect(screen.getByRole("menuitem", { name: /图片/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /视频/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /音频/ })).toBeInTheDocument();

    const file = new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("选择图片"), { target: { files: [file] } });
    expect(onSelect).toHaveBeenCalledWith([file]);
    expect(screen.queryByRole("menuitem", { name: /图片/ })).not.toBeInTheDocument();
  });

  it("以类型、名称、大小区分待发送媒体并支持单项移除", () => {
    const onRemove = vi.fn();
    const items: PendingAttachment[] = [
      createPending("att_image", "image", "cover.png", 2048),
      createPending("att_video", "video", "scene.mp4", 2 * 1024 * 1024),
      createPending("att_audio", "audio", "voice.mp3", 4096),
    ];
    render(<PendingAttachmentStrip items={items} maxCount={4} onRemove={onRemove} />);

    expect(screen.getByText("图片")).toBeInTheDocument();
    expect(screen.getByText("视频")).toBeInTheDocument();
    expect(screen.getAllByText("音频").length).toBeGreaterThan(0);
    expect(screen.getByText("cover.png")).toBeInTheDocument();
    expect(screen.getByText("2 KB")).toBeInTheDocument();
    expect(screen.getByText("2.0 MB")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "移除 scene.mp4" }));
    expect(onRemove).toHaveBeenCalledWith("att_video");
  });

  it("在已发送消息中保留图片、视频与音频的差异化呈现", async () => {
    const metadata = {
      att_image: createPending("att_image", "image", "cover.png", 2048).metadata,
      att_video: createPending("att_video", "video", "scene.mp4", 2 * 1024 * 1024).metadata,
      att_audio: createPending("att_audio", "audio", "voice.mp3", 4096).metadata,
    };
    const attachmentService = {
      name: "attachments",
      getObjectUrl: async (assetId: string) => `blob:${assetId}`,
      getMetadata: async (assetId: string) => metadata[assetId as keyof typeof metadata],
    } as unknown as IAttachmentService;
    unifiedAppStore.setRawState({
      ...unifiedAppStore.getState(),
      getKernelService: <T extends IKernelService,>() => attachmentService as unknown as T,
    });

    const { container } = render(<MessageAttachmentParts parts={[
      { type: "image", assetId: "att_image", alt: "封面" },
      { type: "video", assetId: "att_video" },
      { type: "audio", assetId: "att_audio" },
    ]} />);

    await waitFor(() => expect(screen.getByText("图片 · cover.png")).toBeInTheDocument());
    expect(screen.getByText("视频 · scene.mp4")).toBeInTheDocument();
    expect(screen.getByText("voice.mp3")).toBeInTheDocument();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:att_image");
    expect(container.querySelector("video")?.getAttribute("src")).toBe("blob:att_video");
    expect(container.querySelector("audio")?.getAttribute("src")).toBe("blob:att_audio");
  });
});

function createPending(
  id: string,
  kind: PendingAttachment["metadata"]["kind"],
  originalName: string,
  size: number,
): PendingAttachment {
  return {
    metadata: {
      id,
      kind,
      originalName,
      size,
      mimeType: kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg",
      state: "staging",
      referenceIds: [],
      createdAt: 1,
      updatedAt: 1,
    },
    previewUrl: `blob:${id}`,
  };
}
