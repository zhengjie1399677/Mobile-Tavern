import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalResourceService } from "../../src/application/services/LocalResourceService";
import { __localResourceStorageTest } from "../../src/infrastructure/resources/localResourceStorage";
import type { IKernel } from "../../src/application/serviceContracts";

describe("本地界面资源服务", () => {
  beforeEach(async () => {
    await __localResourceStorageTest.reset();
    document.querySelector("style[data-tavern-local-resources]")?.remove();
  });
  afterEach(() => vi.restoreAllMocks());

  it("把文件字节与列表元数据物理分轨，并生成 CSS 安全引用", async () => {
    const service = new LocalResourceService();
    await service.init({} as IKernel);
    const resource = await service.importFile(new File([new Uint8Array([1, 2, 3])], "paper.png", { type: "image/png" }));

    expect(resource.kind).toBe("image");
    expect(resource.name).toBe("paper.png");
    expect(await service.listResources()).toEqual([resource]);
    const stableReference = service.getResourceReference(resource.id);
    expect(stableReference).toBe(`tavern-resource://${resource.id}`);
    expect(await service.resolveResourceReference(stableReference)).toMatch(/^blob:/);
    expect(service.getCssReference(resource.id)).toBe(`var(--tavern-resource-${resource.id})`);
    expect(document.querySelector("style[data-tavern-local-resources]")?.textContent)
      .toContain(`--tavern-resource-${resource.id}: url(`);

    await service.destroy();
  });

  it("支持图片、视频和音频，并拒绝其他文件", async () => {
    const service = new LocalResourceService();
    await service.init({} as IKernel);

    expect((await service.importFile(new File(["a"], "cover.webp", { type: "image/webp" }))).kind).toBe("image");
    expect((await service.importFile(new File(["a"], "scene.mp4", { type: "video/mp4" }))).kind).toBe("video");
    expect((await service.importFile(new File(["a"], "theme.mp3", { type: "audio/mpeg" }))).kind).toBe("audio");
    await expect(service.importFile(new File(["a"], "notes.txt", { type: "text/plain" })))
      .rejects.toThrow("LOCAL_RESOURCE_TYPE_UNSUPPORTED");
    await expect(service.importFile(new File(["<svg/ >"], "fake.png", { type: "image/svg+xml" })))
      .rejects.toThrow("LOCAL_RESOURCE_TYPE_UNSUPPORTED");

    await service.destroy();
  });

  it("删除资源会清除字节、CSS 变量并回收 Blob URL", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const service = new LocalResourceService();
    await service.init({} as IKernel);
    const resource = await service.importFile(new File(["a"], "cover.png", { type: "image/png" }));

    await service.deleteResource(resource.id);

    expect(await service.listResources()).toEqual([]);
    expect(document.querySelector("style[data-tavern-local-resources]")?.textContent ?? "")
      .not.toContain(`--tavern-resource-${resource.id}:`);
    expect(revoke).toHaveBeenCalled();
    await expect(service.getObjectUrl(resource.id)).rejects.toThrow("LOCAL_RESOURCE_NOT_FOUND");

    await service.destroy();
  });
});
