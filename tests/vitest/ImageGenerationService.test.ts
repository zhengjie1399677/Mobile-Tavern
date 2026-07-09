import { describe, it, expect, vi, beforeEach } from "vitest";
import { ImageGenerationService } from "../../src/kernel/services/ImageGenerationService";
import { ImageGenApiConfig } from "../../src/types";

describe("ImageGenerationService tests", () => {
  let service: ImageGenerationService;
  
  beforeEach(() => {
    service = new ImageGenerationService();
    vi.restoreAllMocks();
  });

  it("should initialize and destroy successfully", async () => {
    await service.init({} as any);
    expect(service.name).toBe("imageGen");
    await service.destroy({} as any);
  });

  it("should successfully call DALL-E endpoint and return base64", async () => {
    const mockConfig: ImageGenApiConfig = {
      enabled: true,
      type: "openai-dalle",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-api-key",
      modelName: "dall-e-3",
      promptPrefix: "anime: ",
      negativePrompt: "",
      width: 1024,
      height: 1024,
      steps: 20,
      cfgScale: 7.0,
      sampler: "Euler a",
    };

    const mockResponse = {
      data: [{ b64_json: "iVBORw0KGgoAAAANSUhEUgAAADIA..." }]
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
    global.fetch = fetchSpy;

    const result = await service.generateImage("a cute cat", mockConfig);
    expect(result).toBe("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIA...");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.openai.com/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Authorization": "Bearer test-api-key",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          model: "dall-e-3",
          prompt: "anime: a cute cat",
          n: 1,
          size: "1024x1024",
          response_format: "b64_json",
        }),
      })
    );
  });

  it("should successfully call Stable Diffusion WebUI and return base64", async () => {
    const mockConfig: ImageGenApiConfig = {
      enabled: true,
      type: "sd-webui",
      baseUrl: "http://127.0.0.1:7860",
      apiKey: "",
      modelName: "sd_checkpoint.ckpt",
      promptPrefix: "best quality, ",
      negativePrompt: "low quality",
      width: 512,
      height: 512,
      steps: 25,
      cfgScale: 7.5,
      sampler: "DPM++ 2M Karras",
    };

    const mockResponse = {
      images: ["iVBORw0KGgoAAAANSUhEUgAAADIA_SD..."]
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
    global.fetch = fetchSpy;

    const result = await service.generateImage("fantasy landscape", mockConfig);
    expect(result).toBe("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIA_SD...");
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:7860/sdapi/v1/txt2img",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          prompt: "best quality, fantasy landscape",
          negative_prompt: "low quality",
          steps: 25,
          cfg_scale: 7.5,
          width: 512,
          height: 512,
          sampler_name: "DPM++ 2M Karras",
          override_settings: {
            sd_model_checkpoint: "sd_checkpoint.ckpt",
          },
        }),
      })
    );
  });

  it("should successfully call NovelAI and convert binary buffer to base64", async () => {
    const mockConfig: ImageGenApiConfig = {
      enabled: true,
      type: "novelai",
      baseUrl: "https://image.novelai.net",
      apiKey: "novel-key",
      modelName: "anime-full",
      promptPrefix: "masterpiece, ",
      negativePrompt: "blurry",
      width: 512,
      height: 768,
      steps: 28,
      cfgScale: 11.0,
      sampler: "k_euler_ancestral",
    };

    const mockBinary = new Uint8Array([78, 79, 86, 69, 76, 65, 73]); // "NOVELAI"
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => mockBinary.buffer,
    });
    global.fetch = fetchSpy;

    const result = await service.generateImage("cyberpunk city", mockConfig);
    expect(result).toBe("data:image/png;base64,Tk9WRUxBSQ=="); // btoa("NOVELAI")
  });

  it("should respect AbortSignal during image generation", async () => {
    const mockConfig: ImageGenApiConfig = {
      enabled: true,
      type: "openai-dalle",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-api-key",
      modelName: "dall-e-3",
      promptPrefix: "",
      negativePrompt: "",
      width: 1024,
      height: 1024,
      steps: 20,
      cfgScale: 7.0,
      sampler: "Euler a",
    };

    const controller = new AbortController();
    controller.abort(); // Cancel before calling

    await expect(
      service.generateImage("cute dog", mockConfig, controller.signal)
    ).rejects.toThrow("Generation aborted before request started");
  });

  it("should fail and throw '未配置api' when config is not provided, not enabled, or lacks baseUrl", async () => {
    await service.init({} as any);

    // Scenario 1: config is null/undefined
    await expect(
      service.generateImage("cute dog", null as any)
    ).rejects.toThrow("未配置api");

    // Scenario 2: config is disabled
    await expect(
      service.generateImage("cute dog", { enabled: false, baseUrl: "http://example.com" } as any)
    ).rejects.toThrow("未配置api");

    // Scenario 3: config has no baseUrl or empty baseUrl
    await expect(
      service.generateImage("cute dog", { enabled: true, baseUrl: "  " } as any)
    ).rejects.toThrow("未配置api");
  });
});
