/**
 * imageCompressor 单元测试
 *
 * 覆盖 compressImage 的尺寸缩放、质量压缩、错误降级
 * 使用 Mock Canvas/Image 模拟浏览器环境
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { compressImage } from "../../src/utils/imageCompressor";

/**
 * Mock 图像对象结构：覆盖 compressImage 使用到的 onload/onerror 等字段。
 * onload/onerror 在初始化时为 null，运行时由测试代码注入回调。
 */
interface MockImage {
  width: number;
  height: number;
  src: string;
  onload: (() => void) | null;
  onerror: ((ev: Event) => void) | null;
}

/**
 * Mock FileReader 实例结构：仅在 File 输入路径中使用。
 * onload 在初始化时为 null，运行时由 compressImage 内部赋值。
 */
interface MockFileReaderInstance {
  onload: ((ev: { target: { result: string } }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  readAsDataURL: Mock<(file: File) => void>;
}

function mockImage(mockImg: MockImage): void {
  global.Image = vi.fn(function () {
    return mockImg;
  }) as unknown as typeof Image;
}

function mockCanvasElement(mockCanvas: unknown) {
  // 必须在 spy 之前捕获原始实现：spy 之后 `document.createElement` 已指向 mock，
  // 兜底分支再调用它会重新进入 mock 形成无限递归。
  const originalCreateElement = document.createElement;
  return vi.spyOn(document, "createElement").mockImplementation((tag: string, options?: ElementCreationOptions) => {
    if (tag === "canvas") return mockCanvas as HTMLCanvasElement;
    return originalCreateElement.call(document, tag, options);
  });
}

describe("compressImage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("从 base64 字符串压缩并返回 dataUrl", async () => {
    const mockImg: MockImage = {
      width: 800,
      height: 600,
      src: "",
      onload: null,
      onerror: null,
    };
    mockImage(mockImg);

    const drawImageSpy = vi.fn();
    const toDataURLSpy = vi.fn(() => "data:image/jpeg;base64,compressed");
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: drawImageSpy })),
      toDataURL: toDataURLSpy,
    };
    mockCanvasElement(mockCanvas);

    const promise = compressImage("data:image/png;base64,raw", 400, 300, 0.8);
    setTimeout(() => mockImg.onload!(), 0);

    const result = await promise;
    expect(result).toBe("data:image/jpeg;base64,compressed");
    expect(drawImageSpy).toHaveBeenCalledWith(mockImg, 0, 0, 400, 300);
    expect(toDataURLSpy).toHaveBeenCalledWith("image/jpeg", 0.8);
  });

  it("图片小于最大尺寸时不缩放", async () => {
    const mockImg: MockImage = {
      width: 200,
      height: 150,
      src: "",
      onload: null,
      onerror: null,
    };
    mockImage(mockImg);

    const drawImageSpy = vi.fn();
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: drawImageSpy })),
      toDataURL: vi.fn(() => "data:image/jpeg;base64,same"),
    };
    mockCanvasElement(mockCanvas);

    const promise = compressImage("data:image/png;base64,raw", 400, 300);
    setTimeout(() => mockImg.onload!(), 0);

    await promise;
    expect(drawImageSpy).toHaveBeenCalledWith(mockImg, 0, 0, 200, 150);
  });

  it("保持长宽比缩放", async () => {
    const mockImg: MockImage = {
      width: 1000,
      height: 500,
      src: "",
      onload: null,
      onerror: null,
    };
    mockImage(mockImg);

    const drawImageSpy = vi.fn();
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: drawImageSpy })),
      toDataURL: vi.fn(() => "data:image/jpeg;base64,resized"),
    };
    mockCanvasElement(mockCanvas);

    const promise = compressImage("data:image/png;base64,raw", 200, 200);
    setTimeout(() => mockImg.onload!(), 0);

    await promise;
    expect(drawImageSpy).toHaveBeenCalledWith(mockImg, 0, 0, 200, 100);
  });

  it("Canvas getContext 返回 null 时回退到原始字符串", async () => {
    const mockImg: MockImage = {
      width: 800,
      height: 600,
      src: "",
      onload: null,
      onerror: null,
    };
    mockImage(mockImg);

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => null),
      toDataURL: vi.fn(),
    };
    mockCanvasElement(mockCanvas);

    const promise = compressImage("data:image/png;base64,fallback", 400, 300);
    setTimeout(() => mockImg.onload!(), 0);

    const result = await promise;
    expect(result).toBe("data:image/png;base64,fallback");
  });

  it("图片加载失败时 reject", async () => {
    const mockImg: MockImage = {
      width: 0,
      height: 0,
      src: "",
      onload: null,
      onerror: null,
    };
    mockImage(mockImg);

    const promise = compressImage("invalid-data-url", 400, 300);
    setTimeout(() => mockImg.onerror!(new Event("error")), 0);

    await expect(promise).rejects.toThrow("图片加载失败");
  });

  it("从 File 对象读取并压缩", async () => {
    const mockImg: MockImage = {
      width: 800,
      height: 600,
      src: "",
      onload: null,
      onerror: null,
    };
    mockImage(mockImg);

    const drawImageSpy = vi.fn();
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: drawImageSpy })),
      toDataURL: vi.fn(() => "data:image/jpeg;base64,from-file"),
    };
    mockCanvasElement(mockCanvas);

    // 直接构造实例并由构造器返回，避免把 `this` 别名到外部变量（no-this-alias）。
    const fileReaderInstance: MockFileReaderInstance = {
      onload: null,
      onerror: null,
      readAsDataURL: vi.fn((_file: File) => {
        setTimeout(() => {
          if (fileReaderInstance.onload) {
            fileReaderInstance.onload({ target: { result: "data:image/png;base64,file-content" } });
          }
        }, 0);
      }),
    };
    global.FileReader = vi.fn(function () {
      return fileReaderInstance;
    }) as unknown as typeof FileReader;

    const mockFile = new File(["dummy"], "test.png", { type: "image/png" });
    const promise = compressImage(mockFile, 400, 300, 0.8);

    setTimeout(() => {
      if (mockImg.onload) mockImg.onload();
    }, 10);

    const result = await promise;
    expect(result).toBe("data:image/jpeg;base64,from-file");
    expect(fileReaderInstance.readAsDataURL).toHaveBeenCalledWith(mockFile);
  }, 10000);

  it("自定义输出类型", async () => {
    const mockImg: MockImage = {
      width: 200,
      height: 200,
      src: "",
      onload: null,
      onerror: null,
    };
    mockImage(mockImg);

    const drawImageSpy = vi.fn();
    const toDataURLSpy = vi.fn((type: string, _quality: number) => `data:${type};base64,webp`);
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: drawImageSpy })),
      toDataURL: toDataURLSpy,
    };
    mockCanvasElement(mockCanvas);

    const promise = compressImage("data:image/png;base64,raw", 400, 300, 0.9, "image/webp");
    setTimeout(() => mockImg.onload!(), 0);

    const result = await promise;
    expect(result).toBe("data:image/webp;base64,webp");
    expect(toDataURLSpy).toHaveBeenCalledWith("image/webp", 0.9);
  });
});
