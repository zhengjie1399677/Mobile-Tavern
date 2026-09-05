import { importThemeZipPackage, exportThemeZipPackage } from "../../src/application/useCases/themeZipPackage";
import { afterEach, describe, it, expect, vi } from "vitest";
import { zipSync } from "fflate";
import {
  unpackThemeZip,
  extractMediaFilesFromZip,
  validateZipEntryPath,
} from "../../src/domain/themes/themeZipPackage";
import type { ILocalResourceService } from "../../src/application/serviceContracts";
import type { CustomThemePackage } from "../../src/utils/themePackage";

describe("Theme & Media ZIP Package Engine", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("包含 CSS 图片和 MP3 的导出包保持合法 JSON，并能重新导入", async () => {
    const theme: CustomThemePackage = {
      schemaVersion: "1.1", name: "资源往返", version: "1.0.0", isDark: true,
      variables: { "--background": "var(--tavern-resource-r_image)" },
      customCss: '.hero { background: var(--tavern-resource-r_image); }',
      media: { music: { type: "audio", src: "tavern-resource://r_audio", loop: true, volume: 1, preload: "metadata" } },
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(
      new Blob(["media"], { type: url.includes("audio") ? "audio/mpeg" : "image/png" }),
    )));
    const resources = {
      getObjectUrl: vi.fn(async (id: string) => `blob:${id}`),
      importFile: vi.fn(async (file: File) => ({ id: file.type === "audio/mpeg" ? "r_new_audio" : "r_new_image" })),
      getResourceReference: (id: string) => `tavern-resource://${id}`,
      getCssReference: (id: string) => `var(--tavern-resource-${id})`,
      deleteResource: vi.fn(async () => undefined),
    } as unknown as ILocalResourceService;
    const exported = await exportThemeZipPackage(theme, resources);
    const unpacked = await unpackThemeZip(await exported.arrayBuffer());
    expect(() => JSON.parse(unpacked.rawThemeJson)).not.toThrow();
    expect(unpacked.mediaFiles.map(media => media.file.type)).toContain("audio/mpeg");
    const imported = await importThemeZipPackage(await exported.arrayBuffer(), resources);
    expect(imported.theme.variables["--background"]).toBe("var(--tavern-resource-r_new_image)");
    expect(imported.theme.media?.music.src).toBe("tavern-resource://r_new_audio");
  });

  it("主题验证失败时回收本次导入的资源，缺失导出资源时明确失败", async () => {
    const resources = {
      importFile: vi.fn(async () => ({ id: "r_new" })),
      deleteResource: vi.fn(async () => undefined),
      getObjectUrl: vi.fn(async () => ""),
    } as unknown as ILocalResourceService;
    const bytes = zipSync({ "theme.json": new TextEncoder().encode('{"name":"invalid"}'), "image.png": new Uint8Array([1]) });
    await expect(importThemeZipPackage(bytes, resources)).rejects.toThrow("THEME_VALIDATION_FAILED");
    expect(resources.deleteResource).toHaveBeenCalledWith("r_new");
    await expect(exportThemeZipPackage({
      schemaVersion: "1.1", name: "资源缺失", version: "1.0.0", isDark: true,
      variables: { "--background": "var(--tavern-resource-r_missing)" },
    }, resources)).rejects.toThrow("THEME_ZIP_RESOURCE_MISSING");
  });
  it("validateZipEntryPath 应该严格拦截危险的目录穿越与非法路径", () => {
    expect(() => validateZipEntryPath("../evil.sh")).toThrow("THEME_ZIP_UNSAFE_PATH");
    expect(() => validateZipEntryPath("sub/../../evil.sh")).toThrow("THEME_ZIP_UNSAFE_PATH");
    expect(() => validateZipEntryPath("/root/file.png")).toThrow("THEME_ZIP_UNSAFE_PATH");
    expect(() => validateZipEntryPath("C:\\Windows\\system32")).toThrow("THEME_ZIP_UNSAFE_PATH");
    expect(() => validateZipEntryPath("file\0bad.png")).toThrow("THEME_ZIP_UNSAFE_PATH");

    // 合法路径不应报错
    expect(() => validateZipEntryPath("theme.json")).not.toThrow();
    expect(() => validateZipEntryPath("assets/wallpaper.png")).not.toThrow();
    expect(() => validateZipEntryPath("videos/sub/bg.mp4")).not.toThrow();
  });

  it("extractMediaFilesFromZip 应该从任意 ZIP 中提取所有多媒体文件并识别正确 MIME", async () => {
    const mockFiles: Record<string, Uint8Array> = {
      "images/bg.png": new Uint8Array([1, 2, 3]),
      "images/photo.jpg": new Uint8Array([4, 5, 6]),
      "videos/intro.mp4": new Uint8Array([7, 8, 9]),
      "audio/bgm.mp3": new Uint8Array([10, 11, 12]),
      "notes.txt": new TextEncoder().encode("Hello world"), // 非多媒体文件
    };

    const zipBytes = zipSync(mockFiles);
    const mediaFiles = await extractMediaFilesFromZip(zipBytes);

    expect(mediaFiles).toHaveLength(4);
    const filenames = mediaFiles.map(f => f.name).sort();
    expect(filenames).toEqual(["bg.png", "bgm.mp3", "intro.mp4", "photo.jpg"]);

    const mp4 = mediaFiles.find(f => f.name === "intro.mp4");
    expect(mp4?.type).toBe("video/mp4");
    const mp3 = mediaFiles.find(f => f.name === "bgm.mp3");
    expect(mp3?.type).toBe("audio/mpeg");
    const png = mediaFiles.find(f => f.name === "bg.png");
    expect(png?.type).toBe("image/png");
  });

  it("unpackThemeZip 缺失 theme.json 时应该抛出明确错误", async () => {
    const mockFiles: Record<string, Uint8Array> = {
      "assets/bg.png": new Uint8Array([1, 2, 3]),
    };
    const zipBytes = zipSync(mockFiles);

    await expect(unpackThemeZip(zipBytes)).rejects.toThrow("THEME_ZIP_JSON_MISSING");
  });

  it("importThemeZipPackage 应该完整解压、自动入库并重映射图片、音视频相对路径", async () => {
    const rawTheme = {
      schemaVersion: "1.1",
      name: "Cyber Neon Space",
      version: "1.2.0",
      isDark: true,
      variables: {
        "--background": 'url("./assets/wallpaper.png")',
        "--foreground": "oklch(0.9 0.01 250)",
      },
      customCss: '.hero-banner { background-image: url("assets/wallpaper.png"); }',
      media: {
        "bg-video": {
          type: "video",
          src: "./videos/space.mp4",
          loop: true,
          muted: true,
          fit: "cover",
        },
        "click-sfx": {
          type: "audio",
          src: "audio/tap.mp3",
          loop: false,
          volume: 0.8,
        },
      },
    };

    const mockFiles: Record<string, Uint8Array> = {
      "theme.json": new TextEncoder().encode(JSON.stringify(rawTheme)),
      "assets/wallpaper.png": new Uint8Array([137, 80, 78, 71]),
      "videos/space.mp4": new Uint8Array([0, 0, 0, 24]),
      "audio/tap.mp3": new Uint8Array([73, 68, 51]),
    };

    const zipBytes = zipSync(mockFiles);

    // 模拟本地资源服务
    let idCounter = 1;
    const importedList: Array<{ name: string; id: string }> = [];
    const mockLocalResourceService: ILocalResourceService = {
      name: "localResources",
      isCritical: false,
      dependencies: [],
      init: vi.fn(),
      destroy: vi.fn(),
      listResources: vi.fn().mockResolvedValue([]),
      importFile: vi.fn().mockImplementation(async (file: File) => {
        const id = `r_mock_${idCounter++}_${file.name.replace(/[^a-zA-Z0-9]/g, "")}`;
        importedList.push({ name: file.name, id });
        return {
          id,
          name: file.name,
          kind: file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "image",
          mimeType: file.type,
          size: file.size,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      }),
      deleteResource: vi.fn(),
      getObjectUrl: vi.fn().mockResolvedValue("blob:http://localhost/test"),
      getResourceReference: vi.fn().mockImplementation((id: string) => `tavern-resource://${id}`),
      resolveResourceReference: vi.fn(),
      getCssReference: vi.fn().mockImplementation((id: string) => `var(--tavern-resource-${id})`),
    };

    const result = await importThemeZipPackage(zipBytes, mockLocalResourceService);

    expect(result.theme.name).toBe("Cyber Neon Space");
    expect(result.importedResourcesCount).toBe(3);
    expect(mockLocalResourceService.importFile).toHaveBeenCalledTimes(3);

    // 验证相对路径重映射：
    // 1. variables 中的 url("./assets/wallpaper.png") 应该被安全转换为 var(--tavern-resource-r_...)
    const wallpaperId = importedList.find(i => i.name === "wallpaper.png")?.id;
    expect(wallpaperId).toBeDefined();
    expect(result.theme.variables["--background"]).toBe(`var(--tavern-resource-${wallpaperId})`);

    // 2. customCss 中的 url("assets/wallpaper.png") 应该被重映射
    expect(result.theme.customCss).toContain(`var(--tavern-resource-${wallpaperId})`);

    // 3. media 中的 video 与 audio src 应该被重映射为 tavern-resource://r_...
    const videoId = importedList.find(i => i.name === "space.mp4")?.id;
    const audioId = importedList.find(i => i.name === "tap.mp3")?.id;
    expect(videoId).toBeDefined();
    expect(audioId).toBeDefined();

    expect(result.theme.media?.["bg-video"]?.src).toBe(`tavern-resource://${videoId}`);
    expect(result.theme.media?.["click-sfx"]?.src).toBe(`tavern-resource://${audioId}`);
  });

  it("exportThemeZipPackage 能够成功生成合法的 ZIP Blob 包含 theme.json", async () => {
    const theme: CustomThemePackage = {
      schemaVersion: "1.1",
      id: "custom_cyber_123456",
      name: "Cyber Neon Space",
      version: "1.0.0",
      isDark: true,
      variables: {
        "--background": "oklch(0.15 0.01 250)",
      },
    };

    const mockLocalResourceService = {} as ILocalResourceService;
    const zipBlob = await exportThemeZipPackage(theme, mockLocalResourceService);

    expect(zipBlob).toBeInstanceOf(Blob);
    expect(zipBlob.type).toBe("application/zip");

    const arrayBuffer = await zipBlob.arrayBuffer();
    const unpacked = await unpackThemeZip(arrayBuffer);
    expect(unpacked.themeJsonPath).toBe("theme.json");
    const parsed = JSON.parse(unpacked.rawThemeJson) as { name: string };
    expect(parsed.name).toBe("Cyber Neon Space");
  });
});
