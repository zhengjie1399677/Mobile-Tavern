import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentService } from "../../src/application/services/AttachmentService";
import { __attachmentStorageTest } from "../../src/infrastructure/attachments/attachmentStorage";
import type { IKernel } from "../../src/application/serviceContracts";

function pngFile(name = "scene.png"): File {
  return new File([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]),
  ], name, { type: "image/png" });
}

describe("消息附件服务", () => {
  beforeEach(async () => {
    await __attachmentStorageTest.reset();
  });

  afterEach(() => vi.restoreAllMocks());

  it("导入后把元数据与字节物理分轨，并保持 staging 状态", async () => {
    const service = new AttachmentService();
    await service.init({} as IKernel);

    const metadata = await service.stageFile(pngFile());

    expect(metadata).toMatchObject({
      kind: "image",
      mimeType: "image/png",
      originalName: "scene.png",
      state: "staging",
      referenceIds: [],
    });
    expect(await service.getBlob(metadata.id)).toBeInstanceOf(Blob);
    expect(await service.listAttachments()).toEqual([metadata]);
    await service.destroy();
  });

  it("以文件魔数为准拒绝伪造 MIME，不能只相信扩展名", async () => {
    const service = new AttachmentService();
    await service.init({} as IKernel);
    const fake = new File(["not an image"], "fake.png", { type: "image/png" });

    await expect(service.stageFile(fake)).rejects.toThrow("ATTACHMENT_SIGNATURE_INVALID");
    expect(await service.listAttachments()).toEqual([]);
    await service.destroy();
  });

  it("按消息引用提交附件，移除最后引用后进入 orphaned", async () => {
    const service = new AttachmentService();
    await service.init({} as IKernel);
    const metadata = await service.stageFile(pngFile());

    await service.reconcileReferences([
      { referenceId: "session-1/message-1", assetIds: [metadata.id, metadata.id] },
      { referenceId: "session-2/message-2", assetIds: [metadata.id] },
    ]);
    expect(await service.getMetadata(metadata.id)).toMatchObject({
      state: "committed",
      referenceIds: ["session-1/message-1", "session-2/message-2"],
    });

    await service.reconcileReferences([]);
    expect(await service.getMetadata(metadata.id)).toMatchObject({
      state: "orphaned",
      referenceIds: [],
    });
    await service.destroy();
  });

  it("垃圾回收删除过期 staging/orphaned 字节并回收 Blob URL", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const service = new AttachmentService();
    await service.init({} as IKernel);
    const metadata = await service.stageFile(pngFile());
    await service.getObjectUrl(metadata.id);

    const removed = await service.collectGarbage(Number.POSITIVE_INFINITY);

    expect(removed).toEqual([metadata.id]);
    expect(await service.getMetadata(metadata.id)).toBeNull();
    await expect(service.getBlob(metadata.id)).rejects.toThrow("ATTACHMENT_NOT_FOUND");
    expect(revoke).toHaveBeenCalledTimes(1);
    await service.destroy();
  });

  it("引用不存在的附件时整体拒绝，不产生半更新元数据", async () => {
    const service = new AttachmentService();
    await service.init({} as IKernel);
    const metadata = await service.stageFile(pngFile());

    await expect(service.reconcileReferences([
      { referenceId: "session-1/message-1", assetIds: [metadata.id, "att_missing"] },
    ])).rejects.toThrow("ATTACHMENT_NOT_FOUND");
    expect(await service.getMetadata(metadata.id)).toMatchObject({
      state: "staging",
      referenceIds: [],
    });
    await service.destroy();
  });

  it("增量更新单条消息引用时保留其他消息的反向引用", async () => {
    const service = new AttachmentService();
    await service.init({} as IKernel);
    const first = await service.stageFile(pngFile("first.png"));
    const second = await service.stageFile(pngFile("second.png"));
    await service.reconcileReferences([
      { referenceId: "session-1/message-1", assetIds: [first.id] },
      { referenceId: "session-1/message-2", assetIds: [first.id] },
    ]);

    await service.patchReferences([
      { referenceId: "session-1/message-1", assetIds: [second.id] },
    ]);

    expect(await service.getMetadata(first.id)).toMatchObject({
      state: "committed",
      referenceIds: ["session-1/message-2"],
    });
    expect(await service.getMetadata(second.id)).toMatchObject({
      state: "committed",
      referenceIds: ["session-1/message-1"],
    });
    await service.destroy();
  });

  it("附件字节可经 JSON 备份往返恢复，恢复后重新进入 staging", async () => {
    const service = new AttachmentService();
    await service.init({} as IKernel);
    const metadata = await service.stageFile(pngFile());
    const backup = await service.exportAttachments([metadata.id]);

    await __attachmentStorageTest.reset();
    await service.replaceAttachments(backup);

    expect(await service.getMetadata(metadata.id)).toMatchObject({
      state: "staging",
      referenceIds: [],
    });
    expect(Array.from(new Uint8Array(await (await service.getBlob(metadata.id)).arrayBuffer())).slice(0, 8))
      .toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    await service.destroy();
  });

  it("恢复时在同一附件事务内写入反向引用，不需要主库提交后的二次 reconcile", async () => {
    const service = new AttachmentService();
    await service.init({} as IKernel);
    const metadata = await service.stageFile(pngFile());
    const backup = await service.exportAttachments([metadata.id]);

    await service.replaceAttachments(backup, [
      { referenceId: "session-1/message-1", assetIds: [metadata.id] },
    ]);

    expect(await service.getMetadata(metadata.id)).toMatchObject({
      state: "committed",
      referenceIds: ["session-1/message-1"],
    });
    await service.destroy();
  });

  it("损坏的备份字节在清库前拒绝，保留已有附件", async () => {
    const service = new AttachmentService();
    await service.init({} as IKernel);
    const metadata = await service.stageFile(pngFile());
    const backup = await service.exportAttachments([metadata.id]);

    await expect(service.replaceAttachments([{ ...backup[0], dataBase64: "not-base64" }]))
      .rejects.toThrow("ATTACHMENT_BACKUP_BASE64_INVALID");
    expect(await service.getMetadata(metadata.id)).not.toBeNull();
    await service.destroy();
  });
});
